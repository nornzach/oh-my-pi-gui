/**
 * Overview drawer tab against the wire: changed files read as their porcelain
 * code, MCP servers as their connection state, live work as counts with the
 * overflow folded away, and a tool-free chat tab neither shows nor reads the
 * git and MCP cards. Same linkedom harness as the other panels.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BtwHistoryRecord, RpcResponse, SubagentSnapshot } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useBtwStore } from "../../stores/btw";
import { useSessionStore } from "../../stores/session";
import { useSubagentsStore } from "../../stores/subagents";
import { useTabsStore } from "../../stores/tabs";
import { useTodoStore } from "../../stores/todo";
import { useUiStore } from "../../stores/ui";
import { OverviewPanel } from "./OverviewPanel";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
Object.assign(globalThis as Record<string, unknown>, {
	document,
	window,
	Event,
	HTMLElement,
	Element,
	Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const ok = (command: string, data: unknown): RpcResponse => ({ type: "response", command, success: true, data });

const rpc = {
	getContextReport: vi.fn(async () => ok("get_context_report", { contextWindow: 0, model: "" })),
	getSettings: vi.fn(async () => ok("get_settings", { values: {} })),
	getGitStatus: vi.fn(async () =>
		ok("get_git_status", { isRepo: true, branch: "main", staged: 0, unstaged: 0, untracked: 0 }),
	),
	getGitChanges: vi.fn(async () =>
		ok("get_git_changes", {
			isRepo: true,
			root: "/work",
			base: null,
			truncated: false,
			files: [
				{ path: "src/new.ts", status: "??" },
				{ path: "src/app.ts", status: " M" },
				{ path: "old.md", status: "D " },
				{ path: "src/b.ts", status: "M " },
				{ path: "src/c.ts", status: "M " },
				{ path: "src/d.ts", status: "M " },
				{ path: "src/e.ts", status: "M " },
				{ path: "src/f.ts", status: "M " },
			],
		}),
	),
	getMcpServers: vi.fn(async () =>
		ok("get_mcp_servers", {
			servers: [
				{ name: "github", transport: "http", status: "connected", toolCount: 12, enabled: true, authed: true },
				{
					name: "slack",
					transport: "http",
					status: "disconnected",
					toolCount: 0,
					enabled: true,
					authed: false,
					lastError: "401 Unauthorized",
				},
				{ name: "local", transport: "stdio", status: "disconnected", toolCount: 0, enabled: false, authed: false },
			],
		}),
	),
};
(window as unknown as Record<string, unknown>).omp = { rpc, events: { onConfigUpdate: () => () => {} } };

let container: InstanceType<typeof HTMLElement>;
let root: Root;

async function mount(kind: "agent" | "chat"): Promise<void> {
	useTabsStore.setState({
		tabs: [{ id: "t0", cwd: "/work", status: "ready", kind, unreadDone: false }],
		activeTabId: "t0",
		bundles: new Map(),
	});
	useSessionStore.setState({ status: "ready", cwd: "/Users/someone/work", sessionId: "s1" });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<OverviewPanel />
			</I18nProvider>,
		);
	});
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

const card = (name: string) => container.querySelector(`section[aria-label="${name}"]`);
const rows = (name: string) => [...(card(name)?.querySelectorAll("li") ?? [])].map(row => row.textContent);

function agent(id: string, index: number, status: string): SubagentSnapshot {
	return { id, index, agent: "explore", description: `task ${id}`, status, lastUpdate: 1 };
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	vi.clearAllMocks();
	useTabsStore.getState().reset();
	useSessionStore.getState().reset();
	useSubagentsStore.getState().reset();
	useTodoStore.getState().reset();
	useBtwStore.getState().reset();
	useUiStore.setState({ panelTab: "overview", panelVisible: false });
});

describe("OverviewPanel", () => {
	it("lists changed files by porcelain code and MCP servers by connection state", async () => {
		await mount("agent");

		expect(card("Changes")?.textContent).toContain("8 uncommitted files");
		// Untracked "??" reads as U; the first non-blank side of XY is the code.
		// Each row is name then folder; a root file has no folder, so its name is not repeated.
		expect(rows("Changes")).toEqual(["Unew.tssrc", "Mapp.tssrc", "Dold.md", "Mb.tssrc", "Mc.tssrc", "Md.tssrc"]);
		expect(card("Changes")?.textContent).toContain("+2 more");

		// A server with a last error is an error even while it reports "disconnected";
		// a disabled one is off, not merely disconnected.
		expect(rows("MCP servers")).toEqual(["github12 toolsConnected", "slackError", "localOff"]);

		const review = [...(card("Changes")?.querySelectorAll("button") ?? [])].find(b => b.textContent === "Review");
		await act(async () => review?.click());
		expect(useUiStore.getState()).toMatchObject({ panelTab: "diff", panelVisible: true });
	});

	it("leaves the git and MCP cards out of a tool-free chat tab without reading them", async () => {
		await mount("chat");

		const titles = [...container.querySelectorAll("section")].map(section => section.getAttribute("aria-label"));
		expect(titles).toEqual(["Context", "Workspace", "Running"]);
		expect(rpc.getGitChanges).not.toHaveBeenCalled();
		expect(rpc.getGitStatus).not.toHaveBeenCalled();
		expect(rpc.getMcpServers).not.toHaveBeenCalled();
	});

	it("counts live work, folds extra subagents away, and opens a running side question", async () => {
		useSubagentsStore.setState({
			subagents: new Map(
				["a", "b", "c", "d"]
					.map((id, index) => agent(id, index, "running"))
					.concat(agent("done", 9, "completed"))
					.map(snapshot => [snapshot.id, snapshot]),
			),
		});
		useTodoStore.getState().setPhases([
			{
				name: "Build",
				tasks: [
					{ content: "Write the store", status: "completed" },
					{ content: "Render the cards", status: "in_progress" },
					{ content: "Ship it", status: "pending" },
				],
			},
		]);
		const running: BtwHistoryRecord = {
			id: "q1",
			leafId: null,
			question: "why is the sky blue?",
			answer: "",
			status: "running",
			createdAt: 1,
			updatedAt: 1,
		};
		useBtwStore.setState({ records: [running] });
		await mount("chat");

		const text = card("Running")?.textContent ?? "";
		expect(text).toContain("4 subagents running");
		expect(text).toContain("+1 more");
		expect(text).not.toContain("task done");
		expect(text).toContain("Todos 1/3 done");
		expect(text).toContain("Render the cards");

		const question = [...(card("Running")?.querySelectorAll("button") ?? [])].find(b =>
			b.textContent?.includes("why is the sky blue?"),
		);
		await act(async () => question?.click());
		expect(useUiStore.getState()).toMatchObject({ panelTab: "btw", panelVisible: true });
		expect(useBtwStore.getState().selectedId).toBe("q1");
	});
});
