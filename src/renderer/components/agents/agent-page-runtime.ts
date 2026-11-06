/**
 * The runtime a subagent page renders under (plan/24 §6.1).
 *
 * The page reuses the conversation's own transcript component, which reads
 * the session's stores through the runtime context. This runtime keeps the
 * parent tab's id and its subagent, graph, settings and model stores, but
 * owns private messages, tools and session stores filled from the agent's
 * transcript file, so a subagent's tool entries never reach the parent's
 * transcript. It is never registered: window-level lookups by tab id still
 * find the parent. Commands reach the parent's sidecar only when they read.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { AgentMessage, RpcCommand, RpcResponse, SubagentSnapshot } from "../../../shared/rpc-types";
import { describeError } from "../../lib/errors";
import { useAgentPagesStore } from "../../stores/agent-pages";
import { createBtwStore } from "../../stores/btw";
import { createComposerStore } from "../../stores/composer";
import { createExtensionUiStore } from "../../stores/extension-ui";
import { createMessagesStore, type MessagesStore } from "../../stores/messages";
import { createPlanApprovalStore } from "../../stores/plan-approval";
import { createQueueStore } from "../../stores/queue";
import { createSessionStore, type SessionStore } from "../../stores/session";
import {
	addRuntimeStore,
	type RuntimeStoreKey,
	type SessionRuntime,
	type TabCommand,
	withSessionRuntime,
} from "../../stores/session-runtime-context";
import { createTodoStore } from "../../stores/todo";
import { createToolsStore, type ToolsStore } from "../../stores/tools";
import { registerTranscriptToolCalls } from "../panels/subagent-graph";
import { subagentActivity } from "./agent-activity";

/** Poll cadence for a shown page while its agent works (plan/24 §6.2). */
export const AGENT_PAGE_POLL_MS = 1000;

const SHARED_STORES: RuntimeStoreKey[] = ["subagents", "subagentGraph", "settings", "model"];

/** Reads pass through to the parent's sidecar; anything that would act on the session is refused. */
function readOnlyCommand(parent: TabCommand): TabCommand {
	return async (command: RpcCommand, timeoutMs?: number): Promise<RpcResponse> => {
		if (command.type.startsWith("get_")) return parent(command, timeoutMs);
		return {
			type: "response",
			command: command.type,
			success: false,
			error: "A subagent's page is read-only.",
		};
	};
}

export function createAgentPageRuntime(parent: SessionRuntime, agentId: string): SessionRuntime {
	const command = readOnlyCommand(parent.command);
	const runtime: SessionRuntime = { tabId: parent.tabId, command, stores: new Map() };
	for (const key of SHARED_STORES) {
		const store = parent.stores.get(key);
		if (store) runtime.stores.set(key, store);
	}
	const session = createSessionStore();
	const parentSession = parent.stores.get("session")?.getState() as SessionStore | undefined;
	session.setState({ sessionId: `subagent:${agentId}`, cwd: parentSession?.cwd ?? "", status: "starting" });
	addRuntimeStore(runtime, "session", session);
	addRuntimeStore(runtime, "messages", createMessagesStore());
	addRuntimeStore(runtime, "tools", createToolsStore());
	addRuntimeStore(runtime, "queue", createQueueStore(command));
	addRuntimeStore(runtime, "todo", createTodoStore());
	addRuntimeStore(runtime, "composer", createComposerStore());
	addRuntimeStore(runtime, "btw", createBtwStore(command));
	addRuntimeStore(runtime, "planApproval", createPlanApprovalStore());
	addRuntimeStore(runtime, "extensionUi", createExtensionUiStore());
	return runtime;
}

/**
 * One runtime per open page, so switching between a page and its conversation
 * keeps the page's scroll and messages. A replaced session runtime (restart,
 * new session) gets fresh page runtimes.
 */
const pageRuntimes = new Map<string, { parent: SessionRuntime; runtime: SessionRuntime }>();

export function agentPageRuntime(parent: SessionRuntime, agentId: string): SessionRuntime {
	const key = agentPageKey(parent.tabId, agentId);
	const cached = pageRuntimes.get(key);
	if (cached?.parent === parent) return cached.runtime;
	const runtime = createAgentPageRuntime(parent, agentId);
	pageRuntimes.set(key, { parent, runtime });
	return runtime;
}

export function agentPageKey(tabId: string, agentId: string): string {
	return `${tabId}\u0000${agentId}`;
}

/** Forget runtimes of pages that are no longer open. */
export function pruneAgentPageRuntimes(open: ReadonlySet<string>): void {
	for (const key of pageRuntimes.keys()) if (!open.has(key)) pageRuntimes.delete(key);
}

useAgentPagesStore.subscribe((state, previous) => {
	if (state.pages === previous.pages) return;
	const open = new Set<string>();
	for (const [tabId, pages] of Object.entries(state.pages)) {
		for (const page of pages) open.add(agentPageKey(tabId, page.agentId));
	}
	pruneAgentPageRuntimes(open);
});

interface TranscriptRead {
	messages?: AgentMessage[];
	nextByte?: number;
	reset?: boolean;
}

function storeOf<T>(runtime: SessionRuntime, key: RuntimeStoreKey): StoreApi<T> {
	return runtime.stores.get(key) as StoreApi<T>;
}

/** Byte offset after the last read, per page runtime. */
const readCursors = new WeakMap<SessionRuntime, number>();

export interface AgentTranscriptState {
	loaded: boolean;
	error: string | null;
	retry: () => void;
}

/**
 * Fill the page runtime from the agent's transcript file and keep it live:
 * every second while the agent works and the window is visible, read the
 * bytes after the last read. One more read runs when the agent stops.
 */
export function useAgentTranscript(
	runtime: SessionRuntime,
	agent: SubagentSnapshot | undefined,
	pollMs = AGENT_PAGE_POLL_MS,
): AgentTranscriptState {
	const agentId = agent?.id;
	const sessionFile = agent?.sessionFile;
	const working = agent ? subagentActivity(agent) === "working" : false;
	const workingRef = useRef(working);
	workingRef.current = working;
	const inFlight = useRef(false);
	const generation = useRef(0);
	const [loaded, setLoaded] = useState(() => storeOf<SessionStore>(runtime, "session").getState().status === "ready");
	const [error, setError] = useState<string | null>(null);

	const read = useCallback(
		async (fromByte: number) => {
			if (!agentId || inFlight.current) return;
			inFlight.current = true;
			const version = generation.current;
			try {
				const response = await runtime.command({
					type: "get_subagent_messages",
					subagentId: agentId,
					sessionFile,
					fromByte,
				});
				if (version !== generation.current) return;
				if (!response.success) {
					setError(describeError(response.error));
					return;
				}
				const data = (response.data ?? {}) as TranscriptRead;
				const incoming = data.messages ?? [];
				const messagesStore = storeOf<MessagesStore>(runtime, "messages");
				const fresh = data.reset === true || fromByte === 0;
				readCursors.set(runtime, data.nextByte ?? fromByte);
				if (incoming.length > 0 || fresh) {
					const messages = fresh ? incoming : [...messagesStore.getState().messages, ...incoming];
					messagesStore.setState({ messages, totalMessages: messages.length });
					storeOf<ToolsStore>(runtime, "tools")
						.getState()
						.hydrateMessages(messages, { turnIsLive: workingRef.current });
					withSessionRuntime(runtime.tabId, () => registerTranscriptToolCalls(agentId, incoming));
				}
				storeOf<SessionStore>(runtime, "session").setState({ status: "ready" });
				setError(null);
				setLoaded(true);
			} catch (cause) {
				if (version === generation.current) setError(describeError(cause));
			} finally {
				if (version === generation.current) inFlight.current = false;
			}
		},
		[agentId, runtime, sessionFile],
	);

	// The first read takes the whole file in one response; a page shown again
	// reads only what arrived while its conversation was on screen.
	useEffect(() => {
		generation.current++;
		inFlight.current = false;
		void read(readCursors.get(runtime) ?? 0);
		return () => {
			generation.current++;
			inFlight.current = false;
		};
	}, [read, runtime]);

	useEffect(() => {
		if (!working) {
			// The terminal frame: one last read, then settle any running cards.
			const version = generation.current;
			void read(readCursors.get(runtime) ?? 0).then(() => {
				if (version !== generation.current) return;
				const { messages } = storeOf<MessagesStore>(runtime, "messages").getState();
				storeOf<ToolsStore>(runtime, "tools").getState().hydrateMessages(messages, { turnIsLive: false });
			});
			return;
		}
		let timer: number | null = null;
		const start = () => {
			if (timer === null && document.visibilityState !== "hidden") {
				timer = window.setInterval(() => void read(readCursors.get(runtime) ?? 0), pollMs);
			}
		};
		const stop = () => {
			if (timer !== null) window.clearInterval(timer);
			timer = null;
		};
		const onVisibility = () => (document.visibilityState === "hidden" ? stop() : start());
		start();
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [pollMs, read, runtime, working]);

	const retry = useCallback(() => {
		readCursors.delete(runtime);
		void read(0);
	}, [read, runtime]);
	return { loaded, error, retry };
}
