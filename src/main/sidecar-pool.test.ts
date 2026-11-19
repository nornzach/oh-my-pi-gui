import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { BrowserWindow } from "electron";
import { describe, expect, it } from "vitest";
import { IPC_EVENTS, type IpcTabStatusPayload, type IpcTabWorktree } from "../shared/ipc-types";
import type { RpcCommand, RpcResponse, SessionInfoUpdateFrame, SidecarStatus } from "../shared/rpc-types";
import type { SidecarManager } from "./sidecar";
import { SidecarPool } from "./sidecar-pool";
import type { PersistedTabLayout } from "./tab-layout";

/** Minimal SidecarManager stand-in: an EventEmitter with lifecycle recording. */
class FakeSidecar extends EventEmitter {
	started = false;
	disposed = false;
	restartArgs: Array<{ cwd: string | undefined; sessionPath: string | undefined }> = [];
	/** Side-channel frames written via sendSideChannel (F-UI-ORIGIN assertions). */
	sentFrames: object[] = [];
	rpcCommands: RpcCommand[] = [];
	constructor(public cwd: string) {
		super();
	}
	adoptCwd(cwd: string): boolean {
		if (cwd === this.cwd) return false;
		this.cwd = cwd;
		return true;
	}
	get status(): SidecarStatus {
		return this.currentStatus;
	}
	/**
	 * A manager exists before any process does: `start()` is what reports
	 * `starting`, exactly like SidecarManager.
	 */
	currentStatus: SidecarStatus = "asleep";
	readonly rpcClient = {
		command: async (command: RpcCommand): Promise<RpcResponse> => {
			this.rpcCommands.push(command);
			return { type: "response", command: command.type, success: true, data: { cancelled: false } };
		},
	};
	start(): void {
		this.started = true;
		if (this.currentStatus === "asleep") this.emitStatus("starting");
	}
	restart(cwd?: string, sessionPath?: string): void {
		this.restartArgs.push({ cwd, sessionPath });
		if (this.currentStatus === "asleep") this.emitStatus("starting");
	}
	prewarmed = false;
	/** Session paths `adopt()` was handed, in call order. */
	adoptedWith: Array<string | undefined> = [];
	prewarm(): void {
		this.prewarmed = true;
		this.start();
	}
	adopt(sessionPath?: string): void {
		this.adoptedWith.push(sessionPath);
		this.emitStatus("starting");
	}
	kill(): void {}
	dispose(): void {
		this.disposed = true;
		this.removeAllListeners();
	}
	sendSideChannel(frame: object): void {
		this.sentFrames.push(frame);
	}
	emitStatus(status: SidecarStatus): void {
		this.currentStatus = status;
		this.emit("status", { status, cwd: this.cwd });
	}
	emitSessionInfo(frame: Omit<SessionInfoUpdateFrame, "type">): void {
		this.emit("sessionInfoUpdate", { type: "session_info_update", ...frame });
	}
	emitAgentEvents(types: string[]): void {
		this.emit(
			"events",
			types.map(type => ({ type })),
		);
	}
	emitExtensionUi(id: string): void {
		this.emit("extensionUi", {
			type: "extension_ui_request",
			id,
			method: "confirm",
			title: "Proceed?",
			message: "ok?",
		});
	}
	emitEditorText(id: string): void {
		this.emit("extensionUi", {
			type: "extension_ui_request",
			id,
			method: "set_editor_text",
			text: "restore me",
			prepend: true,
		});
	}
	emitHostToolCall(id: string): void {
		this.emit("hostToolCall", { type: "host_tool_call", id, name: "gui_tool", args: {} });
	}
	emitHostUriRequest(id: string): void {
		this.emit("hostUriRequest", { type: "host_uri_request", id, operation: "read", uri: "https://example.com" });
	}
}

interface FakeWindow {
	win: BrowserWindow;
	sent: Array<{ channel: string; data: unknown }>;
	close(): void;
	sentTo(channel: string): Array<{ channel: string; data: unknown }>;
}

/** Minimal BrowserWindow stand-in: captured sends + a triggerable "closed". */
function fakeWindow(id: number): FakeWindow {
	const emitter = new EventEmitter();
	const sent: Array<{ channel: string; data: unknown }> = [];
	let destroyed = false;
	const win = {
		webContents: {
			id,
			send: (channel: string, data: unknown) => {
				sent.push({ channel, data });
			},
		},
		isDestroyed: () => destroyed,
		once: (event: string, listener: () => void) => emitter.once(event, listener),
	} as unknown as BrowserWindow;
	return {
		win,
		sent,
		close: () => {
			destroyed = true;
			emitter.emit("closed");
		},
		sentTo: channel => sent.filter(entry => entry.channel === channel),
	};
}

function fakePool(): { pool: SidecarPool; sidecars: FakeSidecar[] } {
	const sidecars: FakeSidecar[] = [];
	const pool = new SidecarPool(cwd => {
		const sidecar = new FakeSidecar(cwd);
		sidecars.push(sidecar);
		return sidecar as unknown as SidecarManager;
	});
	return { pool, sidecars };
}

describe("SidecarPool session kind", () => {
	it("threads the spawn kind through the factory into TAB_STATUS payloads", () => {
		const kinds: Array<"agent" | "chat" | undefined> = [];
		const sidecars: FakeSidecar[] = [];
		const pool = new SidecarPool((cwd, kind) => {
			kinds.push(kind);
			const sidecar = new FakeSidecar(cwd);
			sidecars.push(sidecar);
			return sidecar as unknown as SidecarManager;
		});
		const fw = fakeWindow(1);

		pool.acquire("/a", fw.win, "tab-agent");
		pool.acquire("/b", fw.win, "tab-chat", undefined, "chat");
		// acquire defaults the kind to "agent" — the factory always sees a defined value.
		expect(kinds).toEqual(["agent", "chat"]);

		const [, chatSidecar] = sidecars;
		fw.sent.length = 0;
		chatSidecar?.emitStatus("ready");
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => s.data)).toEqual([
			{ kind: "chat", tabId: "tab-chat", cwd: "/b", status: "ready", placeholder: false, sessionPath: null },
		]);

		// GET_TABS exposes the immutable kind for every tab.
		expect(pool.tabsForWindow(fw.win).map(tab => tab.kind)).toEqual(["agent", "chat"]);
	});
});

describe("SidecarPool tabs", () => {
	it("binds two tabs to one window; the first is active", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		const a = pool.acquire("/a", fw.win, "tab-a");
		const b = pool.acquire("/b", fw.win, "tab-b");

		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(pool.size).toBe(2);
		expect(sidecars.map(s => s.started)).toEqual([true, true]);
		expect(pool.sidecarForWindow(fw.win)).toBe(a);
		expect(pool.sidecarForTab(fw.win, "tab-b")).toBe(b);
		expect(pool.sidecarForTab(fw.win, "nope")).toBeNull();
		expect(pool.activeTabForWindow(fw.win)).toBe("tab-a");
		expect(pool.tabsForWindow(fw.win)).toEqual([
			{
				kind: "agent",
				tabId: "tab-a",
				cwd: "/a",
				status: "starting",
				active: true,
				visible: true,
				placeholder: false,
				sessionPath: null,
			},
			{ kind: "agent", tabId: "tab-b", cwd: "/b", status: "starting", placeholder: false, sessionPath: null },
		]);
	});

	it("mints a snowflake tabId when none is given", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win);
		const tabs = pool.tabsForWindow(fw.win);
		expect(tabs[0]?.tabId).toMatch(/^[0-9a-f]{16}$/);
	});

	it("resumes a session on first start when sessionPath is given", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		const sidecar = pool.acquire("/a", fw.win, "tab-a", "/sessions/s.jsonl");
		expect(sidecar).not.toBeNull();
		expect(sidecars[0]?.started).toBe(false);
		expect(sidecars[0]?.restartArgs).toEqual([{ cwd: undefined, sessionPath: "/sessions/s.jsonl" }]);
		expect(pool.tabsForWindow(fw.win)[0]?.sessionPath).toBe("/sessions/s.jsonl");
	});

	it("forwards full channels only from the active tab, TAB_STATUS from every tab", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a, b] = sidecars;
		fw.sent.length = 0;

		a?.emitAgentEvents(["agent_start"]);
		b?.emitAgentEvents(["agent_start"]);
		// Only the active tab's batch reaches the full channel…
		expect(fw.sentTo(IPC_EVENTS.EVENTS_BATCH).map(entry => entry.data)).toEqual([
			{ tabId: "tab-a", payload: [{ type: "agent_start" }] },
		]);
		// …but both tabs pushed TAB_STATUS for their running transition.
		const statuses = fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => s.data as IpcTabStatusPayload);
		expect(statuses).toEqual([
			{ kind: "agent", tabId: "tab-a", cwd: "/a", status: "starting", placeholder: false, sessionPath: null },
			{ kind: "agent", tabId: "tab-b", cwd: "/b", status: "starting", placeholder: false, sessionPath: null },
		]);

		// Connection status is forwarded on the full channel for the active tab only.
		a?.emitStatus("ready");
		b?.emitStatus("ready");
		expect(fw.sentTo(IPC_EVENTS.SIDECAR_STATUS)).toHaveLength(1);
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS)).toHaveLength(4);

		// Background sidecar emits nothing on the remaining full channels.
		b?.emit("subagentFrame", { type: "subagent_lifecycle" });
		b?.emit("promptResult", { type: "prompt_result" });
		expect(fw.sentTo(IPC_EVENTS.SUBAGENT_FRAME)).toHaveLength(0);
		expect(fw.sentTo(IPC_EVENTS.PROMPT_RESULT)).toHaveLength(0);
		a?.emit("promptResult", { type: "prompt_result" });
		expect(fw.sentTo(IPC_EVENTS.PROMPT_RESULT).map(entry => entry.data)).toEqual([
			{ tabId: "tab-a", payload: { type: "prompt_result" } },
		]);
	});

	it("synthesizes running/ready per tab from the agent event stream", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a, b] = sidecars;
		a?.emitStatus("ready");
		b?.emitStatus("ready");
		fw.sent.length = 0;

		// Background tab starts a run: TAB_STATUS reports running without any
		// full-channel leak.
		b?.emitAgentEvents(["agent_start"]);
		expect(fw.sentTo(IPC_EVENTS.EVENTS_BATCH)).toHaveLength(0);
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => s.data)).toEqual([
			{ kind: "agent", tabId: "tab-b", cwd: "/b", status: "running", placeholder: false, sessionPath: null },
		]);
		expect(pool.tabsForWindow(fw.win)).toEqual([
			{
				kind: "agent",
				tabId: "tab-a",
				cwd: "/a",
				status: "ready",
				active: true,
				visible: true,
				placeholder: false,
				sessionPath: null,
			},
			{ kind: "agent", tabId: "tab-b", cwd: "/b", status: "running", placeholder: false, sessionPath: null },
		]);

		// Run settles → ready (the renderer's unreadDone signal for background tabs).
		fw.sent.length = 0;
		b?.emitAgentEvents(["agent_end"]);
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => s.data)).toEqual([
			{ kind: "agent", tabId: "tab-b", cwd: "/b", status: "ready", placeholder: false, sessionPath: null },
		]);

		// A restart mid-run clears the flag: no stale "running" after recovery.
		fw.sent.length = 0;
		b?.emitAgentEvents(["agent_start"]);
		b?.emitStatus("restarting");
		b?.emitStatus("ready");
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => (s.data as IpcTabStatusPayload).status)).toEqual([
			"running",
			"restarting",
			"ready",
		]);
		expect(pool.tabsForWindow(fw.win)[1]?.status).toBe("ready");
	});

	it("reports a background run's retry and failure outcome, and clears it on the next run", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const b = sidecars[1];
		b?.emitStatus("ready");
		fw.sent.length = 0;
		const outcomes = () =>
			fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => {
				const data = s.data as IpcTabStatusPayload;
				return [data.status, data.attention, data.attentionDetail, data.retry?.attempt ?? data.retry];
			});

		b?.emit("events", [
			{ type: "agent_start" },
			{ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: "overloaded" },
		]);
		// The retried attempt re-enters through agent_start: the saga is still on,
		// but its wait is over, so the retry row clears.
		b?.emit("events", [{ type: "agent_start" }]);
		b?.emit("events", [
			{ type: "auto_retry_end", success: false, attempt: 3, finalError: "overloaded" },
			{
				type: "agent_end",
				messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "overloaded (500)" }],
			},
		]);
		// The next run starts clean; a successful end keeps it clean.
		b?.emit("events", [{ type: "agent_start" }]);
		b?.emit("events", [{ type: "agent_end", messages: [{ role: "assistant", content: [], stopReason: "stop" }] }]);

		expect(outcomes()).toEqual([
			["running", "retrying", undefined, 1],
			["running", "retrying", undefined, null],
			["ready", "failed", "overloaded (500)", null],
			["running", null, undefined, null],
			["ready", null, undefined, null],
		]);
	});

	it("keeps a tab running until upstream background work settles", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		const sidecar = sidecars[0];
		sidecar?.emitStatus("ready");
		fw.sent.length = 0;

		sidecar?.emit("promptResult", {
			type: "prompt_result",
			agentInvoked: true,
			status: "completed",
			sessionSettled: false,
		});
		// EventBatcher can deliver agent_end after prompt_result; it must not
		// clear the running state while the session still awaits settlement.
		sidecar?.emitAgentEvents(["agent_start", "agent_end"]);
		expect((pool.tabsForWindow(fw.win)[0] as IpcTabStatusPayload).status).toBe("running");

		sidecar?.emit("sessionSettled", { type: "session_settled" });
		expect((pool.tabsForWindow(fw.win)[0] as IpcTabStatusPayload).status).toBe("ready");
	});

	it("re-wires forwarding on switch without duplicating listeners", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a, b] = sidecars;
		// Light wiring ("events" run-tracking) is always on; full wiring adds one more.
		expect(a?.listenerCount("events")).toBe(2);
		expect(b?.listenerCount("events")).toBe(1);

		expect(pool.setActiveTab(fw.win, "tab-b")).toBe(true);
		expect(a?.listenerCount("events")).toBe(1);
		expect(b?.listenerCount("events")).toBe(2);

		fw.sent.length = 0;
		a?.emitAgentEvents(["agent_start"]);
		b?.emitAgentEvents(["agent_start"]);
		expect(fw.sentTo(IPC_EVENTS.EVENTS_BATCH)).toHaveLength(1);
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS)).toHaveLength(2);

		// Switching back re-arms A exactly once (one batch per emit, not two).
		expect(pool.setActiveTab(fw.win, "tab-a")).toBe(true);
		expect(a?.listenerCount("events")).toBe(2);
		expect(b?.listenerCount("events")).toBe(1);
		fw.sent.length = 0;
		a?.emitAgentEvents(["agent_end"]);
		expect(fw.sentTo(IPC_EVENTS.EVENTS_BATCH)).toHaveLength(1);

		// Re-setting the already-active tab is a no-op.
		expect(pool.setActiveTab(fw.win, "tab-a")).toBe(true);
		expect(a?.listenerCount("events")).toBe(2);
		// Foreign/unknown tabs are refused.
		expect(pool.setActiveTab(fakeWindow(2).win, "tab-a")).toBe(false);
		expect(pool.setActiveTab(fw.win, "nope")).toBe(false);
	});

	it("forwards a shown pair's two sessions, keeps pairs in the background, and persists them all", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		for (const id of ["a", "b", "c", "d", "e"]) pool.acquire(`/${id}`, fw.win, `tab-${id}`);
		const [a, b, c] = sidecars;
		const shown = { axis: "columns" as const, firstTabId: "tab-a", secondTabId: "tab-b", ratio: 0.65 };
		const background = { axis: "rows" as const, firstTabId: "tab-c", secondTabId: "tab-d", ratio: 0.4 };

		expect(pool.setTabView(fw.win, "tab-b", ["tab-a", "tab-b"], [shown, background])).toBe(true);
		expect([a?.listenerCount("events"), b?.listenerCount("events"), c?.listenerCount("events")]).toEqual([2, 2, 1]);
		fw.sent.length = 0;
		a?.emitAgentEvents(["agent_start"]);
		b?.emitAgentEvents(["agent_start"]);
		c?.emitAgentEvents(["agent_start"]);
		expect(fw.sentTo(IPC_EVENTS.EVENTS_BATCH).map(entry => entry.data)).toEqual([
			{ tabId: "tab-a", payload: [{ type: "agent_start" }] },
			{ tabId: "tab-b", payload: [{ type: "agent_start" }] },
		]);
		expect(pool.tabsForWindow(fw.win).map(tab => tab.group)).toEqual([
			{ axis: "columns", index: 0, ratio: 0.65, partnerTabId: "tab-b" },
			{ axis: "columns", index: 1, ratio: 0.65, partnerTabId: "tab-a" },
			{ axis: "rows", index: 0, ratio: 0.4, partnerTabId: "tab-d" },
			{ axis: "rows", index: 1, ratio: 0.4, partnerTabId: "tab-c" },
			undefined,
		]);
		expect(pool.tabLayoutForWindow(fw.win)?.groups).toEqual([
			{ axis: "columns", firstIndex: 0, secondIndex: 1, ratio: 0.65 },
			{ axis: "rows", firstIndex: 2, secondIndex: 3, ratio: 0.4 },
		]);
		// Two panes are always one pair; three never show.
		expect(pool.setTabView(fw.win, "tab-b", ["tab-a", "tab-b", "tab-c"])).toBe(false);
		expect(pool.setTabView(fw.win, "tab-e", ["tab-a", "tab-e"])).toBe(false);

		// Showing a single tab keeps every pair for when either side is picked again.
		expect(pool.setActiveTab(fw.win, "tab-e")).toBe(true);
		expect(pool.tabLayoutForWindow(fw.win)?.groups).toHaveLength(2);
		expect(pool.setTabView(fw.win, "tab-c", ["tab-c", "tab-d"])).toBe(true);

		// A closed tab takes its pair with it; the partner stays a single tab.
		expect(pool.releaseTab("tab-c")).toBe(true);
		expect(pool.activeTabForWindow(fw.win)).toBe("tab-d");
		expect(pool.tabLayoutForWindow(fw.win)?.groups).toEqual([
			{ axis: "columns", firstIndex: 0, secondIndex: 1, ratio: 0.65 },
		]);
	});

	it("drops pairs that reuse a tab or name another window's tab", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		const other = fakeWindow(2);
		for (const id of ["a", "b", "c"]) pool.acquire(`/${id}`, fw.win, `tab-${id}`);
		pool.acquire("/x", other.win, "tab-x");

		expect(
			pool.setTabView(
				fw.win,
				"tab-a",
				["tab-a"],
				[
					{ axis: "columns", firstTabId: "tab-a", secondTabId: "tab-b", ratio: 0.5 },
					{ axis: "columns", firstTabId: "tab-b", secondTabId: "tab-c", ratio: 0.5 },
					{ axis: "rows", firstTabId: "tab-c", secondTabId: "tab-x", ratio: 0.5 },
				],
			),
		).toBe(true);
		expect(pool.tabsForWindow(fw.win).map(tab => tab.group?.partnerTabId)).toEqual(["tab-b", "tab-a", undefined]);
	});

	it("reorders one window's tabs for GET_TABS and the saved layout", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		const other = fakeWindow(2);
		const snapshots: Array<PersistedTabLayout | null> = [];
		for (const id of ["a", "b", "c"]) pool.acquire(`/${id}`, fw.win, `tab-${id}`);
		pool.acquire("/x", other.win, "tab-x");
		pool.onWindowTabsChanged = (_win, layout) => snapshots.push(layout);

		// A tab the list leaves out keeps its order after the listed ones.
		expect(pool.setTabOrder(fw.win, ["tab-c", "tab-a", "tab-x"])).toBe(true);
		expect(pool.tabsForWindow(fw.win).map(tab => tab.tabId)).toEqual(["tab-c", "tab-a", "tab-b"]);
		expect(snapshots.at(-1)?.tabs.map(tab => tab.cwd)).toEqual(["/c", "/a", "/b"]);
		expect(pool.tabsForWindow(other.win).map(tab => tab.tabId)).toEqual(["tab-x"]);
		expect(pool.setTabOrder(fakeWindow(3).win, ["tab-a"])).toBe(false);
	});

	it("caches session meta per tab and includes it in TAB_STATUS and GET_TABS", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [, b] = sidecars;
		fw.sent.length = 0;

		b?.emitSessionInfo({ title: "Fix flaky test", sessionId: "sess-1" });
		// Background session-info pushes a light snapshot and caches for later.
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => s.data)).toEqual([
			{
				kind: "agent",
				tabId: "tab-b",
				cwd: "/b",
				status: "starting",
				placeholder: false,
				sessionPath: null,
				sessionId: "sess-1",
				title: "Fix flaky test",
			},
		]);
		// No full-channel forward from a background tab.
		expect(fw.sentTo(IPC_EVENTS.SESSION_INFO_UPDATE)).toHaveLength(0);
		expect(pool.tabsForWindow(fw.win)[1]).toEqual({
			kind: "agent",
			tabId: "tab-b",
			cwd: "/b",
			status: "starting",
			placeholder: false,
			sessionPath: null,
			sessionId: "sess-1",
			title: "Fix flaky test",
		});

		// Subsequent status pushes keep carrying the cached meta.
		fw.sent.length = 0;
		b?.emitStatus("ready");
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => s.data)).toEqual([
			{
				kind: "agent",
				tabId: "tab-b",
				cwd: "/b",
				status: "ready",
				placeholder: false,
				sessionPath: null,
				sessionId: "sess-1",
				title: "Fix flaky test",
			},
		]);
	});

	it("spawns only the tabs a restored layout shows, then wakes a sleeping tab on demand", () => {
		const sidecars: FakeSidecar[] = [];
		const pool = new SidecarPool(cwd => {
			const sidecar = new FakeSidecar(cwd);
			sidecars.push(sidecar);
			return sidecar as unknown as SidecarManager;
		});
		const fw = fakeWindow(1);
		pool.restoreLayout(fw.win, {
			version: 1,
			activeIndex: 2,
			tabs: [
				{ cwd: "/a", kind: "agent", sessionPath: "/sessions/a.jsonl" },
				{ cwd: "/b", kind: "agent" },
				{ cwd: "/c", kind: "agent" },
			],
		});

		// A sidecar holds ~200 MB of private memory, so a restored background tab
		// is an entry — not a process — until it is rendered.
		expect(sidecars.map(sidecar => sidecar.started)).toEqual([false, false, true]);
		expect(sidecars[0]?.restartArgs).toEqual([]);
		const tabs = pool.tabsForWindow(fw.win);
		expect(tabs.map(tab => tab.status)).toEqual(["asleep", "asleep", "starting"]);

		// Showing it spawns it, resuming the session its layout saved.
		const [sleeping] = tabs;
		fw.sent.length = 0;
		expect(pool.setActiveTab(fw.win, sleeping!.tabId)).toBe(true);
		expect(sidecars[0]?.restartArgs).toEqual([{ cwd: undefined, sessionPath: "/sessions/a.jsonl" }]);
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).map(entry => (entry.data as IpcTabStatusPayload).status)).toEqual([
			"starting",
		]);

		// Hiding and re-showing it does not spawn a second process.
		pool.setActiveTab(fw.win, tabs[1]!.tabId);
		pool.setActiveTab(fw.win, sleeping!.tabId);
		expect(sidecars[0]?.restartArgs).toHaveLength(1);
	});

	it("labels a sleeping tab with the title its session last had", () => {
		const pool = new SidecarPool(cwd => new FakeSidecar(cwd) as unknown as SidecarManager);
		const fw = fakeWindow(1);
		pool.restoreLayout(fw.win, {
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/a", kind: "agent", sessionPath: "/sessions/a.jsonl", title: "Fix races" },
				{ cwd: "/b", kind: "agent", title: "Audit report" },
			],
		});

		// With the process deferred, the saved title is the only thing the chip
		// can say besides the folder name — so it must survive the round trip.
		expect(pool.tabsForWindow(fw.win).map(tab => tab.title)).toEqual(["Fix races", "Audit report"]);
		expect(pool.tabLayoutForWindow(fw.win)?.tabs[0]).toEqual({
			cwd: "/a",
			kind: "agent",
			sessionPath: "/sessions/a.jsonl",
			title: "Fix races",
		});
	});

	it("restores tab order, sessions, kinds, and the persisted active tab", () => {
		const factoryCalls: Array<{ cwd: string; kind: "agent" | "chat"; fresh: boolean }> = [];
		const sidecars: FakeSidecar[] = [];
		const pool = new SidecarPool((cwd, kind, fresh) => {
			factoryCalls.push({ cwd, kind, fresh });
			const sidecar = new FakeSidecar(cwd);
			sidecars.push(sidecar);
			return sidecar as unknown as SidecarManager;
		});
		const fw = fakeWindow(1);

		const restored = pool.restoreLayout(fw.win, {
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/agent", kind: "agent", sessionPath: "/sessions/a.jsonl" },
				{ cwd: "/chat", kind: "chat" },
			],
			groups: [{ axis: "rows", firstIndex: 0, secondIndex: 1, ratio: 0.6 }],
		});

		expect(restored).toBe(2);
		expect(factoryCalls).toEqual([
			{ cwd: "/agent", kind: "agent", fresh: false },
			{ cwd: "/chat", kind: "chat", fresh: true },
		]);
		expect(sidecars[0]?.restartArgs).toEqual([{ cwd: undefined, sessionPath: "/sessions/a.jsonl" }]);
		expect(sidecars[1]?.started).toBe(true);
		expect(pool.tabsForWindow(fw.win).map(tab => tab.active ?? false)).toEqual([false, true]);
		// The active tab's pair comes back on screen with it.
		expect(pool.tabsForWindow(fw.win).map(tab => tab.visible ?? false)).toEqual([true, true]);
		expect(pool.tabsForWindow(fw.win).map(tab => tab.group?.partnerTabId)).toEqual([
			pool.tabsForWindow(fw.win)[1]?.tabId,
			pool.tabsForWindow(fw.win)[0]?.tabId,
		]);
		expect(pool.tabLayoutForWindow(fw.win)).toEqual({
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/agent", kind: "agent", sessionPath: "/sessions/a.jsonl" },
				{ cwd: "/chat", kind: "chat" },
			],
			groups: [{ axis: "rows", firstIndex: 0, secondIndex: 1, ratio: 0.6 }],
		});
	});

	it("publishes durable layout changes after tab, session, cwd, and active mutations", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		const snapshots: Array<PersistedTabLayout | null> = [];
		pool.onWindowTabsChanged = (_win, layout) => snapshots.push(layout);

		pool.acquire("/a", fw.win, "tab-a", "/sessions/a.jsonl");
		pool.acquire("/b", fw.win, "tab-b", undefined, "chat");
		pool.setActiveTab(fw.win, "tab-b");
		pool.noteSessionFile("tab-b", "/sessions/b.jsonl");
		pool.adoptSessionCwd("tab-b", "/moved");

		expect(snapshots.at(-1)).toEqual({
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/a", kind: "agent", sessionPath: "/sessions/a.jsonl" },
				{ cwd: "/moved", kind: "chat", sessionPath: "/sessions/b.jsonl" },
			],
		});

		pool.releaseTab("tab-b");
		expect(snapshots.at(-1)).toEqual({
			version: 1,
			activeIndex: 0,
			tabs: [{ cwd: "/a", kind: "agent", sessionPath: "/sessions/a.jsonl" }],
		});
	});

	it("marks only the untargeted startup tab as disposable and clears it on first run", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		const snapshots: Array<PersistedTabLayout | null> = [];
		pool.onWindowTabsChanged = (_win, layout) => snapshots.push(layout);

		pool.acquire("/neutral", fw.win, "tab-idle", undefined, "chat", undefined, true, true);
		expect(pool.tabsForWindow(fw.win)[0]).toMatchObject({ tabId: "tab-idle", placeholder: true });
		expect(pool.tabLayoutForWindow(fw.win)?.tabs[0]).toMatchObject({ placeholder: true });

		sidecars[0]?.emitAgentEvents(["agent_start"]);

		expect(pool.tabsForWindow(fw.win)[0]).toMatchObject({ tabId: "tab-idle", placeholder: false });
		expect(pool.tabLayoutForWindow(fw.win)?.tabs[0]).not.toHaveProperty("placeholder");
		expect(snapshots.at(-1)?.tabs[0]).not.toHaveProperty("placeholder");
	});

	it("releases a tab: disposed, pool shrinks, active falls back to a sibling", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a, b] = sidecars;

		// Closing the ACTIVE tab releases it and activates the remaining one.
		expect(pool.releaseTab("tab-a")).toBe(true);
		expect(a?.disposed).toBe(true);
		expect(pool.size).toBe(1);
		expect(pool.sidecarForWindow(fw.win)).toBe(b);
		expect(pool.activeTabForWindow(fw.win)).toBe("tab-b");
		expect(b?.listenerCount("events")).toBe(2);

		// Unknown tab is a no-op; closing the last tab leaves the window tab-less.
		expect(pool.releaseTab("tab-a")).toBe(false);
		expect(pool.releaseTab("tab-b")).toBe(true);
		expect(b?.disposed).toBe(true);
		expect(pool.size).toBe(0);
		expect(pool.sidecarForWindow(fw.win)).toBeNull();
		expect(pool.activeTabForWindow(fw.win)).toBeNull();
		expect(pool.tabsForWindow(fw.win)).toEqual([]);
	});

	it("has no tab cap across windows", () => {
		const { pool } = fakePool();
		const fw1 = fakeWindow(1);
		const fw2 = fakeWindow(2);
		for (let index = 0; index < 12; index++) {
			expect(pool.acquire(`/a-${index}`, fw1.win, `tab-a-${index}`)).not.toBeNull();
		}
		expect(pool.acquire("/b", fw2.win, "tab-b")).not.toBeNull();
		expect(pool.size).toBe(13);
	});

	it("returns null and holds no entry when the sidecar factory throws", () => {
		const pool = new SidecarPool(() => {
			throw new Error("spawn failed");
		});
		expect(pool.acquire("/a", fakeWindow(1).win, "tab-a")).toBeNull();
		expect(pool.size).toBe(0);
	});

	it("releases every tab of a closed window", () => {
		const { pool, sidecars } = fakePool();
		const fw1 = fakeWindow(1);
		const fw2 = fakeWindow(2);
		pool.acquire("/a", fw1.win, "tab-a");
		pool.acquire("/b", fw1.win, "tab-b");
		pool.acquire("/c", fw2.win, "tab-c");

		fw1.close();
		expect(sidecars[0]?.disposed).toBe(true);
		expect(sidecars[1]?.disposed).toBe(true);
		expect(sidecars[2]?.disposed).toBe(false);
		expect(pool.size).toBe(1);
		expect(pool.activeTabForWindow(fw2.win)).toBe("tab-c");
		expect(pool.sidecarForWindow(fw2.win)).toBe(sidecars[2]);

		// Late events from the surviving window still forward normally.
		sidecars[2]?.emitStatus("ready");
		expect(fw2.sentTo(IPC_EVENTS.SIDECAR_STATUS)).toHaveLength(1);
	});
});

describe("SidecarPool session ownership (F-OWN)", () => {
	it("routes session mutations only to an idle attached tab", async () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a", "/sessions/s.jsonl");
		const [sidecar] = sidecars;
		sidecar?.emitStatus("ready");

		const response = await pool.commandForIdleSession("/sessions/s.jsonl", {
			type: "set_session_name",
			name: "Renamed",
			sessionPath: "/sessions/s.jsonl",
		});
		expect(response?.success).toBe(true);
		expect(sidecar?.rpcCommands).toEqual([
			{ type: "set_session_name", name: "Renamed", sessionPath: "/sessions/s.jsonl" },
		]);

		sidecar?.emitAgentEvents(["agent_start"]);
		expect(await pool.commandForIdleSession("/sessions/s.jsonl", { type: "drop_session" })).toBeNull();
	});

	it("blocks session mutations while automatic compaction is in flight", async () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a", "/sessions/s.jsonl");
		const [sidecar] = sidecars;
		sidecar?.emitStatus("ready");
		sidecar?.emitAgentEvents(["auto_compaction_start"]);

		expect(pool.tabsForWindow(fw.win)[0]?.compacting).toBe(true);
		expect(await pool.commandForIdleSession("/sessions/s.jsonl", { type: "drop_session" })).toBeNull();

		sidecar?.emitAgentEvents(["auto_compaction_end"]);
		expect(pool.tabsForWindow(fw.win)[0]?.compacting).toBe(false);
		expect(await pool.commandForIdleSession("/sessions/s.jsonl", { type: "drop_session" })).toMatchObject({
			success: true,
		});
	});

	it("reports a session as live only while some process holds it", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.restoreLayout(fw.win, {
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/a", kind: "agent", sessionPath: "/sessions/s.jsonl" },
				{ cwd: "/b", kind: "agent" },
			],
		});
		const owner = pool.sessionOwner("/sessions/s.jsonl");
		if (!owner) throw new Error("expected the restored tab to own the session");
		const sidecar = sidecars[0];

		// Unowned paths are never live, and neither is an asleep owner — ipc.ts
		// deletes or renames those straight on disk instead of asking a
		// drop_session that has nobody to answer, rather than refusing with
		// "Session is currently running".
		expect(pool.sessionOwnerIsLive("/sessions/other.jsonl")).toBe(false);
		expect(pool.sessionOwnerIsLive("/sessions/s.jsonl")).toBe(false);

		// Showing the tab spawns it, and a spawn in flight counts as live: it is
		// about to read the file.
		expect(pool.setActiveTab(fw.win, owner.tabId)).toBe(true);
		expect(sidecar?.status).toBe("starting");
		expect(pool.sessionOwnerIsLive("/sessions/s.jsonl")).toBe(true);

		sidecar?.emitStatus("ready");
		expect(pool.sessionOwnerIsLive("/sessions/s.jsonl")).toBe(true);
		sidecar?.emitStatus("restarting");
		expect(pool.sessionOwnerIsLive("/sessions/s.jsonl")).toBe(true);

		// A dead process holds nothing.
		sidecar?.emitStatus("exited");
		expect(pool.sessionOwnerIsLive("/sessions/s.jsonl")).toBe(false);
		sidecar?.emitStatus("error");
		expect(pool.sessionOwnerIsLive("/sessions/s.jsonl")).toBe(false);
	});

	it("registers the owner at acquire-with-sessionPath and unregisters on release", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a", "/sessions/s.jsonl");

		// A duplicate attach consults this: SPAWN_TAB maps it to
		// { tabId: null, ownerTabId, ownerWinId } instead of acquiring.
		expect(pool.sessionOwner("/sessions/s.jsonl")).toEqual({ tabId: "tab-a", winId: 1 });
		expect(pool.sessionOwner("/sessions/other.jsonl")).toBeNull();

		expect(pool.releaseTab("tab-a")).toBe(true);
		expect(pool.sessionOwner("/sessions/s.jsonl")).toBeNull();
	});

	it("learns the file from noteSessionFile (get_state / switch_session reports)", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		expect(pool.sessionOwner("/sessions/s.jsonl")).toBeNull();

		pool.noteSessionFile("tab-a", "/sessions/s.jsonl");
		expect(pool.sessionOwner("/sessions/s.jsonl")).toEqual({ tabId: "tab-a", winId: 1 });
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).at(-1)?.data).toMatchObject({
			tabId: "tab-a",
			sessionPath: "/sessions/s.jsonl",
		});

		// A switch moves the entry: the old file is freed, the new one owned.
		pool.noteSessionFile("tab-a", "/sessions/s2.jsonl");
		expect(pool.sessionOwner("/sessions/s.jsonl")).toBeNull();
		expect(pool.sessionOwner("/sessions/s2.jsonl")).toEqual({ tabId: "tab-a", winId: 1 });

		// get_state with sessionFile null (fresh unsaved session) unregisters.
		pool.noteSessionFile("tab-a", null);
		expect(pool.sessionOwner("/sessions/s2.jsonl")).toBeNull();
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).at(-1)?.data).toMatchObject({ tabId: "tab-a", sessionPath: null });

		// Unknown tabs are a no-op.
		pool.noteSessionFile("nope", "/sessions/x.jsonl");
		expect(pool.sessionOwner("/sessions/x.jsonl")).toBeNull();
	});

	it("keeps the acquire-time registration through first attach but drops it on a sessionId change", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a", "/sessions/s.jsonl");
		const [a] = sidecars;

		// First attach: the resumed session reports its id — registration kept
		// (this is what lets a background --session tab stay guarded).
		a?.emitSessionInfo({ sessionId: "sess-1", title: "Resumed" });
		expect(pool.sessionOwner("/sessions/s.jsonl")).toEqual({ tabId: "tab-a", winId: 1 });

		// Title-only updates don't touch ownership either.
		a?.emitSessionInfo({ title: "Renamed" });
		expect(pool.sessionOwner("/sessions/s.jsonl")).not.toBeNull();

		// The session under the tab changed (crash-restart into a fresh
		// session, an unobserved switch): the cached file mapping is stale.
		a?.emitSessionInfo({ sessionId: "sess-2" });
		expect(pool.sessionOwner("/sessions/s.jsonl")).toBeNull();
		// …and the renderer's hydrate re-registers the file now attached.
		pool.noteSessionFile("tab-a", "/sessions/s.jsonl");
		expect(pool.sessionOwner("/sessions/s.jsonl")).toEqual({ tabId: "tab-a", winId: 1 });
	});

	it("only the current owner clears a mapping", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a", "/sessions/s.jsonl");
		pool.acquire("/b", fw.win, "tab-b");

		// Last writer wins if two tabs ever report the same file…
		pool.noteSessionFile("tab-b", "/sessions/s.jsonl");
		expect(pool.sessionOwner("/sessions/s.jsonl")).toEqual({ tabId: "tab-b", winId: 1 });

		// …so releasing the FORMER owner must not drop the new registration.
		expect(pool.releaseTab("tab-a")).toBe(true);
		expect(pool.sessionOwner("/sessions/s.jsonl")).toEqual({ tabId: "tab-b", winId: 1 });
	});

	it("foreignSessionOwner blocks only foreign attaches", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a", "/sessions/s.jsonl");
		pool.acquire("/b", fw.win, "tab-b");

		// A different tab's switch_session is blocked — with the owner info the
		// refusal carries for routing.
		expect(pool.foreignSessionOwner("tab-b", "/sessions/s.jsonl")).toEqual({ tabId: "tab-a", winId: 1 });
		// The owner itself re-attaches freely (switch_session onto its own file).
		expect(pool.foreignSessionOwner("tab-a", "/sessions/s.jsonl")).toBeNull();
		// Unowned files are free (first attach).
		expect(pool.foreignSessionOwner("tab-b", "/sessions/other.jsonl")).toBeNull();
		// An untracked issuer is blocked by any owner — the safe direction.
		expect(pool.foreignSessionOwner(null, "/sessions/s.jsonl")).toEqual({ tabId: "tab-a", winId: 1 });
		// Re-attach after release: the mapping is gone, the path is free.
		expect(pool.releaseTab("tab-a")).toBe(true);
		expect(pool.foreignSessionOwner("tab-b", "/sessions/s.jsonl")).toBeNull();
	});

	it("unregisters owners when a window closes", () => {
		const { pool } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a", "/sessions/s.jsonl");
		expect(pool.sessionOwner("/sessions/s.jsonl")).not.toBeNull();
		fw.close();
		expect(pool.sessionOwner("/sessions/s.jsonl")).toBeNull();
	});
});

describe("SidecarPool session cwd tracking", () => {
	it("adoptSessionCwd re-roots the tab and pushes the live cwd over TAB_STATUS", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/spawn-a", fw.win, "tab-a");
		fw.sent.length = 0;

		// switch_session re-roots the agent silently; the get_state report moves
		// the tab off its spawn cwd…
		expect(pool.adoptSessionCwd("tab-a", "/live-b")).toBe(true);
		expect(sidecars[0]?.cwd).toBe("/live-b");

		// …and the pushed TAB_STATUS carries the NEW cwd so the renderer's chip
		// stops showing the spawn workspace.
		const pushes = fw.sentTo(IPC_EVENTS.TAB_STATUS);
		expect(pushes).toHaveLength(1);
		expect((pushes[0]!.data as IpcTabStatusPayload).cwd).toBe("/live-b");

		// Same cwd / unknown tab / empty cwd are no-ops (no push, no mutation).
		expect(pool.adoptSessionCwd("tab-a", "/live-b")).toBe(false);
		expect(pool.adoptSessionCwd("nope", "/elsewhere")).toBe(false);
		expect(pool.adoptSessionCwd("tab-a", "")).toBe(false);
		expect(sidecars[0]?.cwd).toBe("/live-b");
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS)).toHaveLength(1);
	});
});

describe("SidecarPool request-origin routing (F-UI-ORIGIN)", () => {
	it("does not retain fire-and-forget extension UI updates", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");

		sidecars[0]?.emitEditorText("update-1");
		expect(fw.sentTo(IPC_EVENTS.EXTENSION_UI)).toHaveLength(1);
		expect(pool.routeSideChannel("update-1", { type: "extension_ui_response", id: "update-1" }, true)).toBe(false);
	});

	it("routes an extension-ui response to the raising sidecar even after a tab switch", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a, b] = sidecars;

		// Tab A raises the request while active; the dialog is forwarded…
		a?.emitExtensionUi("req-1");
		expect(fw.sentTo(IPC_EVENTS.EXTENSION_UI).map(item => item.data)).toEqual([
			{
				tabId: "tab-a",
				request: {
					type: "extension_ui_request",
					id: "req-1",
					method: "confirm",
					title: "Proceed?",
					message: "ok?",
				},
			},
		]);

		// …the user switches to tab B, THEN the response arrives. It must go to
		// A's sidecar — B never saw the request and would drop/misroute it.
		expect(pool.setActiveTab(fw.win, "tab-b")).toBe(true);
		const response = { type: "extension_ui_response", id: "req-1", confirmed: true };
		expect(pool.routeSideChannel("req-1", response, true)).toBe(true);
		expect(a?.sentFrames).toEqual([response]);
		expect(b?.sentFrames).toEqual([]);

		// Final responses consume the route — a repeat id falls back to the caller.
		expect(pool.routeSideChannel("req-1", response, true)).toBe(false);
	});

	it("still forwards request channels raised while the tab is in the background", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a] = sidecars;

		pool.setActiveTab(fw.win, "tab-b");
		const before = fw.sentTo(IPC_EVENTS.EXTENSION_UI).length;

		// A background tab's sidecar keeps running; an approval raised while it
		// is parked must still reach the renderer or the agent blocks forever.
		a?.emitExtensionUi("req-bg");
		expect(
			fw
				.sentTo(IPC_EVENTS.EXTENSION_UI)
				.slice(before)
				.map(item => item.data),
		).toEqual([
			{
				tabId: "tab-a",
				request: {
					type: "extension_ui_request",
					id: "req-bg",
					method: "confirm",
					title: "Proceed?",
					message: "ok?",
				},
			},
		]);
		a?.emitHostUriRequest("uri-bg");
		expect(fw.sentTo(IPC_EVENTS.HOST_URI_REQUEST).map(item => item.data)).toEqual([
			{ request: { type: "host_uri_request", id: "uri-bg", operation: "read", uri: "https://example.com" } },
		]);
		// The response route registered even though the tab was parked.
		const response = { type: "extension_ui_response", id: "req-bg", confirmed: true };
		expect(pool.routeSideChannel("req-bg", response, true)).toBe(true);
		expect(a?.sentFrames).toContainEqual(response);
	});

	it("routes host-uri results to the origin sidecar", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a, b] = sidecars;

		a?.emitHostUriRequest("uri-1");
		expect(fw.sentTo(IPC_EVENTS.HOST_URI_REQUEST)).toHaveLength(1);
		pool.setActiveTab(fw.win, "tab-b");

		const result = { type: "host_uri_result", id: "uri-1", content: "data" };
		expect(pool.routeSideChannel("uri-1", result, true)).toBe(true);
		expect(a?.sentFrames).toEqual([result]);
		expect(b?.sentFrames).toEqual([]);
	});

	it("keeps the route across non-final host-tool updates and consumes it on the result", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a, b] = sidecars;
		// Unknown tool → forwarded to the renderer (executor returns false).
		pool.hostToolExecutor = () => false;

		a?.emitHostToolCall("tool-1");
		expect(fw.sentTo(IPC_EVENTS.HOST_TOOL_CALL)).toHaveLength(0); // fake executor sends nothing
		pool.setActiveTab(fw.win, "tab-b");

		const update = { type: "host_tool_update", id: "tool-1", update: "working…" };
		expect(pool.routeSideChannel("tool-1", update, false)).toBe(true);
		// Still registered: the result follows the update stream.
		const result = { type: "host_tool_result", id: "tool-1", result: "done" };
		expect(pool.routeSideChannel("tool-1", result, true)).toBe(true);
		expect(a?.sentFrames).toEqual([update, result]);
		expect(b?.sentFrames).toEqual([]);
		expect(pool.routeSideChannel("tool-1", result, true)).toBe(false);
	});

	it("does not track host tools answered inline", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		const [a] = sidecars;
		// GUI-registered tool: the executor answers on the spot, nothing is
		// forwarded to the renderer, so no response will ever arrive to route.
		pool.hostToolExecutor = (sidecar, request) => {
			sidecar.sendSideChannel({ type: "host_tool_result", id: request.id, result: "inline" });
			return true;
		};

		a?.emitHostToolCall("tool-inline");
		expect(a?.sentFrames).toEqual([{ type: "host_tool_result", id: "tool-inline", result: "inline" }]);
		expect(pool.routeSideChannel("tool-inline", { type: "host_tool_result", id: "tool-inline" }, true)).toBe(false);
	});

	it("drops pending routes when the owning tab is released", () => {
		const { pool, sidecars } = fakePool();
		const fw = fakeWindow(1);
		pool.acquire("/a", fw.win, "tab-a");
		pool.acquire("/b", fw.win, "tab-b");
		const [a, b] = sidecars;

		a?.emitExtensionUi("req-doomed");
		expect(pool.releaseTab("tab-a")).toBe(true);
		// A late response falls back instead of writing to a disposed sidecar.
		expect(pool.routeSideChannel("req-doomed", { type: "extension_ui_response", id: "req-doomed" }, true)).toBe(
			false,
		);
		expect(a?.sentFrames).toEqual([]);
		expect(b?.sentFrames).toEqual([]);
	});
});

describe("SidecarPool quit inventory", () => {
	it("reports a background handoff without marking the tab as streaming or blocking compaction", () => {
		const { pool, sidecars } = fakePool();
		const window = fakeWindow(1);
		pool.acquire("/a", window.win, "tab-a");
		const sidecar = sidecars[0];
		sidecar?.emit("events", [{ type: "manual_compaction_start", mode: "handoff" }]);
		expect(pool.tabInventory()).toEqual([{ windowId: 1, tabId: "tab-a", inFlight: true }]);
		expect(pool.tabsForWindow(window.win)).toEqual([
			expect.objectContaining({ backgroundCompacting: true, compacting: false }),
		]);
		sidecar?.emit("events", [{ type: "manual_compaction_end", aborted: true }]);
		expect(pool.tabInventory()).toEqual([{ windowId: 1, tabId: "tab-a", inFlight: false }]);
		expect(pool.tabsForWindow(window.win)).toEqual([
			expect.objectContaining({ backgroundCompacting: false, compacting: false }),
		]);
	});

	it("reports every live tab's in-flight run across windows and drops released tabs", () => {
		const { pool, sidecars } = fakePool();
		const first = fakeWindow(1);
		const second = fakeWindow(2);
		pool.acquire("/a", first.win, "tab-a");
		pool.acquire("/b", second.win, "tab-b");
		pool.acquire("/c", second.win, "tab-c");
		const [a, b, c] = sidecars;

		// Nothing running yet: ⌘Q must not ask.
		expect(pool.tabInventory()).toEqual([
			{ windowId: 1, tabId: "tab-a", inFlight: false },
			{ windowId: 2, tabId: "tab-b", inFlight: false },
			{ windowId: 2, tabId: "tab-c", inFlight: false },
		]);

		// A background window's run counts the same as the active one's, and an
		// automatic compaction is work too.
		a?.emitAgentEvents(["agent_start"]);
		c?.emitAgentEvents(["auto_compaction_start"]);
		expect(pool.tabInventory().filter(entry => entry.inFlight)).toEqual([
			{ windowId: 1, tabId: "tab-a", inFlight: true },
			{ windowId: 2, tabId: "tab-c", inFlight: true },
		]);

		// A closed tab leaves the inventory; the guard must not ask about work
		// that no longer exists.
		b?.emitAgentEvents(["agent_end"]);
		expect(pool.releaseTab("tab-b")).toBe(true);
		expect(pool.tabInventory().map(entry => entry.tabId)).toEqual(["tab-a", "tab-c"]);
	});
});

describe("SidecarPool warm spare", () => {
	function sparePool(): {
		pool: SidecarPool;
		sidecars: FakeSidecar[];
		spawns: Array<{ cwd: string; kind: "agent" | "chat"; fresh: boolean }>;
	} {
		const sidecars: FakeSidecar[] = [];
		const spawns: Array<{ cwd: string; kind: "agent" | "chat"; fresh: boolean }> = [];
		const pool = new SidecarPool((cwd, kind, fresh) => {
			spawns.push({ cwd, kind, fresh });
			const sidecar = new FakeSidecar(cwd);
			sidecars.push(sidecar);
			return sidecar as unknown as SidecarManager;
		});
		pool.warmSpareDelayMs = 0;
		return { pool, sidecars, spawns };
	}

	/** First tab in `/repo` comes up, then its spare boots and goes idle. */
	async function warmUp(pool: SidecarPool, sidecars: FakeSidecar[], fw: FakeWindow): Promise<FakeSidecar> {
		pool.acquire("/repo", fw.win, "tab-first");
		sidecars[0]?.emitStatus("ready");
		await delay(0);
		const spare = sidecars[1];
		if (!spare?.prewarmed) throw new Error("no spare booted");
		spare.emitStatus("ready");
		return spare;
	}

	it("hands the idle spare to the next session tab in its workspace instead of spawning", async () => {
		const { pool, sidecars, spawns } = sparePool();
		const fw = fakeWindow(1);
		const spare = await warmUp(pool, sidecars, fw);
		// The spare is a fresh agent in the tab's workspace, and is no tab itself.
		expect(spawns[1]).toEqual({ cwd: "/repo", kind: "agent", fresh: true });
		expect(pool.tabsForWindow(fw.win).map(tab => tab.tabId)).toEqual(["tab-first"]);

		const returned = pool.acquire("/repo", fw.win, "tab-session", "/repo/s.jsonl");
		const asleep = sidecars[2];
		expect(asleep?.disposed).toBe(true);
		expect(asleep?.started).toBe(false);
		expect(asleep?.restartArgs).toEqual([]);
		expect(spare.adoptedWith).toEqual(["/repo/s.jsonl"]);
		expect(returned).toBe(spare as unknown as SidecarManager);
		expect(pool.sidecarForTab(fw.win, "tab-session")).toBe(spare as unknown as SidecarManager);

		// The adopted process reports as the tab, through the tab's light wiring.
		fw.sent.length = 0;
		spare.emitStatus("ready");
		expect(fw.sentTo(IPC_EVENTS.TAB_STATUS).map(s => s.data)).toEqual([
			expect.objectContaining({ tabId: "tab-session", status: "ready", sessionPath: "/repo/s.jsonl" }),
		]);
		pool.disposeAll();
	});

	it("cold-starts tabs the spare cannot serve: another workspace, a chat, a worktree", async () => {
		const { pool, sidecars } = sparePool();
		const fw = fakeWindow(1);
		const spare = await warmUp(pool, sidecars, fw);

		pool.acquire("/other", fw.win, "tab-other", "/other/s.jsonl");
		pool.acquire("/repo", fw.win, "tab-chat", undefined, "chat");
		const worktree: IpcTabWorktree = { name: "wt", branch: "wt", baseCwd: "/repo" };
		pool.acquire("/repo", fw.win, "tab-wt", undefined, "agent", worktree);

		expect(spare.adoptedWith).toEqual([]);
		expect(spare.disposed).toBe(false);
		expect(sidecars[2]?.restartArgs).toEqual([{ cwd: undefined, sessionPath: "/other/s.jsonl" }]);
		expect(sidecars[3]?.started).toBe(true);
		expect(sidecars[4]?.started).toBe(true);
	});

	it("replaces the spare after a settings change so the next tab boots under the new settings", async () => {
		const { pool, sidecars } = sparePool();
		const fw = fakeWindow(1);
		const spare = await warmUp(pool, sidecars, fw);

		sidecars[0]?.emit("configUpdate", { type: "config_update" });
		expect(spare.disposed).toBe(true);
		await delay(0);
		expect(sidecars[2]?.prewarmed).toBe(true);
		expect(sidecars[2]?.cwd).toBe("/repo");
	});

	it("hands over a spare that is still booting, but never one that crashed", async () => {
		const { pool, sidecars } = sparePool();
		const fw = fakeWindow(1);
		pool.acquire("/repo", fw.win, "tab-first");
		sidecars[0]?.emitStatus("ready");
		await delay(0);
		const booting = sidecars[1];

		pool.acquire("/repo", fw.win, "tab-early", "/repo/a.jsonl");
		expect(booting?.adoptedWith).toEqual(["/repo/a.jsonl"]);
		expect(sidecars[2]?.disposed).toBe(true);
		expect(sidecars[2]?.restartArgs).toEqual([]);

		booting?.emitStatus("ready");
		await delay(0);
		const crashed = sidecars[3];
		expect(crashed?.prewarmed).toBe(true);
		crashed?.emitStatus("restarting");
		expect(crashed?.disposed).toBe(true);
		pool.acquire("/repo", fw.win, "tab-late", "/repo/b.jsonl");
		expect(sidecars[4]?.restartArgs).toEqual([{ cwd: undefined, sessionPath: "/repo/b.jsonl" }]);
		expect(crashed?.adoptedWith).toEqual([]);
	});

	it("drops the spare when the last tab closes", async () => {
		const { pool, sidecars } = sparePool();
		const fw = fakeWindow(1);
		const spare = await warmUp(pool, sidecars, fw);

		pool.releaseTab("tab-first");
		expect(spare.disposed).toBe(true);
	});
});
