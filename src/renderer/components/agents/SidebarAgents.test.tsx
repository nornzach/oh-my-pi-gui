/**
 * Agents under their session in the sidebar. A regression here drops a
 * session's agents from the sidebar once a later turn spawns none, leaving no
 * way back to them short of the drawer.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage, SubagentSnapshot } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import type { MessagesStore } from "../../stores/messages";
import { deleteSessionRuntime, sessionRuntimeStore } from "../../stores/session-runtime-context";
import type { SubagentsStore } from "../../stores/subagents";
import { createTabRuntime } from "../../stores/tab-runtime";
import { SessionAgentsScope, type SidebarAgentsInfo } from "./SidebarAgents";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

interface TestElement {
	textContent: string | null;
	remove: () => void;
	querySelectorAll: (selector: string) => TestElement[];
}

let container: TestElement;
let root: Root;
let info: SidebarAgentsInfo | null = null;

function user(text: string): AgentMessage {
	return { role: "user", content: text } as AgentMessage;
}

function task(callId: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: callId, name: "task", arguments: {} }],
	} as AgentMessage;
}

type SeededAgent = { id: string; callId: string; status?: SubagentSnapshot["status"] };

function setAgents(tabId: string, agents: SeededAgent[]): void {
	sessionRuntimeStore<SubagentsStore>(tabId, "subagents")!
		.getState()
		.setSnapshots(
			agents.map(({ id, callId, status = "completed" }, index) => ({
				id,
				index,
				agent: "task",
				description: `Essay ${id}`,
				status,
				lastUpdate: 1,
				parentToolCallId: callId,
			})),
		);
}

/** A session open in tab `tabId` whose transcript and roster are given. */
function seed(tabId: string, messages: AgentMessage[], agents: SeededAgent[]): void {
	createTabRuntime(tabId);
	sessionRuntimeStore<MessagesStore>(tabId, "messages")!.setState({ messages });
	setAgents(tabId, agents);
}

async function mount(tabId: string, sessionKey: string): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<SessionAgentsScope sessionKey={sessionKey} tabId={tabId}>
					{value => {
						info = value;
						return null;
					}}
				</SessionAgentsScope>
			</I18nProvider>,
		);
	});
}

const agentRows = () => container.querySelectorAll(".omp-sidebar-agent-row").map(row => row.textContent);

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	info = null;
	deleteSessionRuntime("t1");
});

describe("SessionAgentsScope", () => {
	it("lists this turn's agents open while they work and folds them when they finish", async () => {
		seed("t1", [user("write essays"), task("c1")], [{ id: "Rain", callId: "c1", status: "running" }]);
		await mount("t1", "/sessions/open.jsonl");

		expect(info).toMatchObject({ count: 1, expanded: true });
		expect(agentRows()).toEqual(["Essay Rain"]);

		await act(async () => {
			setAgents("t1", [{ id: "Rain", callId: "c1" }]);
		});

		expect(info).toMatchObject({ count: 1, expanded: false });
		expect(agentRows()).toEqual([]);
	});

	it("keeps finished agents open once the arrow opened them", async () => {
		seed("t1", [user("write essays"), task("c1")], [{ id: "Rain", callId: "c1" }]);
		await mount("t1", "/sessions/kept.jsonl");
		expect(agentRows()).toEqual([]);

		await act(async () => {
			info?.toggle();
		});

		expect(agentRows()).toEqual(["Essay Rain"]);
	});

	it("keeps earlier agents behind a closed arrow once a later turn spawns none", async () => {
		seed(
			"t1",
			[user("write essays"), task("c1"), user("thanks")],
			[
				{ id: "Rain", callId: "c1" },
				{ id: "Field", callId: "c1" },
			],
		);
		await mount("t1", "/sessions/earlier.jsonl");

		expect(info).toMatchObject({ count: 2, expanded: false });
		expect(agentRows()).toEqual([]);

		await act(async () => {
			info?.toggle();
		});
		expect(agentRows()).toEqual(["Essay Rain", "Essay Field"]);
	});
});
