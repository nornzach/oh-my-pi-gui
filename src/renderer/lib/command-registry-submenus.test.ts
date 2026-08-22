/**
 * Nativization contract guard: the prompt-passthrough commands that gained
 * native GUI affordances (RPC actions, panels, dialogs) must never regress
 * to kind:"prompt", and the verbs covered by the contract's non-goals must
 * stay prompt. Exercises buildCommandMenu directly — no stores or RPC.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { useToastStore } from "../stores/toast";
import {
	buildCommandMenu,
	type CommandAffordance,
	type CommandMenuItem,
	type CommandRegistryContext,
} from "./command-registry";
import { translate } from "./i18n";

const ctx: CommandRegistryContext = {
	t: translate,
	isStreaming: false,
	fastModeEnabled: false,
	autoCompaction: false,
	autoRetry: false,
	steeringMode: "all",
	followUpMode: "all",
	interruptMode: "immediate",
	planModeEnabled: false,
	prewalkArmed: false,
	availableCommands: [],
	openModelPicker: () => {},
	openSettings: () => {},
	openUsage: () => {},
	openProviders: () => {},
	openCommandPalette: () => {},
	openModelRoles: () => {},
	openStatsDashboard: () => {},
	openRenameDialog: () => {},
	openSessionPicker: () => {},
	openBranchPicker: () => {},
	openSessionTree: () => {},
	openSessionInfo: () => {},
	openModelCompare: () => {},
	openBenchmark: () => {},
	openHandoffDialog: () => {},
	openExtensions: () => {},
	openInventory: () => {},
	openThemePicker: () => {},
	openModes: () => {},
	openAgentHub: () => {},
	openPrCenter: () => {},
	openHotkeys: () => {},
	openImportDialog: () => {},
	openProviderConfig: () => {},
	focusDockCard: () => {},
	retryTurn: async () => {},
	retryLastTurn: async () => {},
	forkSession: async () => {},
	hydrateSession: async () => {},
	rpc: {
		setFastMode: async () => ({ type: "response", command: "set_fast_mode", success: true }),
		setAutoCompaction: async () => ({ type: "response", command: "set_auto_compaction", success: true }),
		setAutoRetry: async () => ({ type: "response", command: "set_auto_retry", success: true }),
		setSteeringMode: async () => {},
		setFollowUpMode: async () => {},
		setInterruptMode: async () => {},
		compact: async () => ({ type: "response", command: "compact", success: true }),
		newSession: async () => {},
		handoff: async () => {},
		prompt: async () => {},
		setPlanMode: async () => ({ type: "response", command: "set_plan_mode", success: true }),
		setPrewalk: async () => ({ type: "response", command: "set_prewalk", success: true }),
		exportHtml: async () => {},
		setSessionName: async () => {},
		cycleModel: async () => {},
		cycleThinkingLevel: async () => {},
	},
};

function affordanceOf(name: string): CommandAffordance {
	const items = buildCommandMenu(ctx);
	const [top, sub] = name.split(" ");
	const topItem = items.find(item => item.name === top);
	if (!topItem) throw new Error(`missing menu item: ${top}`);
	if (sub === undefined) return topItem.affordance;
	if (topItem.affordance.kind !== "submenu") throw new Error(`${top} is not a submenu`);
	const subItem = topItem.affordance.items.find((item: CommandMenuItem) => item.name === name);
	if (!subItem) throw new Error(`missing submenu item: ${name}`);
	return subItem.affordance;
}

describe("nativized command affordances", () => {
	it.each([
		["dump", "action"],
		["changelog", "window"],
		["skills", "window"],
		["queue", "action"],
		["prewalk", "toggle"],
		["shake elide", "action"],
		["shake images", "action"],
		["fresh", "action"],
		["force", "picker"],
		["reload-plugins", "action"],
		["advisor on", "action"],
		["advisor off", "action"],
		["computer on", "action"],
		["computer off", "action"],
		["computer status", "action"],
		["vision on", "action"],
		["vision off", "action"],
		["vision auto", "action"],
		["vision status", "action"],
		["browser headless", "action"],
		["browser visible", "action"],
		["todo edit", "action"],
		["todo copy", "action"],
		["todo export", "action"],
		["todo import", "action"],
		["mcp enable", "action"],
		["mcp disable", "action"],
		["mcp remove", "action"],
		["mcp reconnect", "action"],
		["mcp add", "window"],
		["mcp test", "window"],
		["mcp reauth", "window"],
		["marketplace add", "action"],
		["marketplace remove", "action"],
		["marketplace update", "action"],
		["marketplace install", "window"],
		["marketplace uninstall", "action"],
		["marketplace upgrade", "action"],
		["marketplace discover", "window"],
		["plugins enable", "action"],
		["plugins disable", "action"],
		["memory view", "window"],
		["memory stats", "window"],
		["memory diagnose", "window"],
	] as const)("%s is %s, never prompt", (name, kind) => {
		const affordance = affordanceOf(name);
		expect(affordance.kind).toBe(kind);
	});

	it.each(["ssh list", "ssh add", "ssh remove"] as const)("%s is unavailable with a reason", name => {
		const affordance = affordanceOf(name);
		expect(affordance.kind).toBe("unavailable");
		if (affordance.kind === "unavailable") expect(affordance.reason.length).toBeGreaterThan(0);
	});

	it.each([
		"advisor status",
		"advisor dump",
		"mcp unauth",
		"mcp reload",
		"mcp resources",
		"mcp prompts",
		"mcp notifications",
		"mcp help",
		"marketplace help",
		"plugins list",
		"memory clear",
		"memory enqueue",
		"ssh help",
	] as const)("%s stays prompt per contract non-goals", name => {
		expect(affordanceOf(name).kind).toBe("prompt");
	});
});

describe("nativized action wiring", () => {
	const ok = (data?: unknown) => ({ type: "response" as const, command: "x", success: true as const, data });
	let rpc: Record<string, Mock>;
	let openSettings: Mock;
	let openExtensions: Mock;
	let openInventory: Mock;
	let hydrateSession: Mock;
	let wiredCtx: CommandRegistryContext;

	const wired = (name: string): CommandAffordance => {
		const [top, sub] = name.split(" ");
		const topItem = buildCommandMenu(wiredCtx).find(item => item.name === top);
		if (!topItem) throw new Error(`missing menu item: ${top}`);
		if (sub === undefined) return topItem.affordance;
		if (topItem.affordance.kind !== "submenu") throw new Error(`${top} is not a submenu`);
		const item = topItem.affordance.items.find((candidate: CommandMenuItem) => candidate.name === name);
		if (!item) throw new Error(`missing submenu item: ${name}`);
		return item.affordance;
	};

	const lastToast = () => useToastStore.getState().toasts.at(-1);

	beforeEach(() => {
		rpc = {
			setSetting: vi.fn(async () => ok({ advisorEnabled: true, advisorActive: true })),
			getSettings: vi.fn(async () => ok({ values: { "computer.enabled": true } })),
			mcpAction: vi.fn(async () => ok({ name: "srv", action: "enable", status: "connected" })),
			marketplaceAction: vi.fn(async () => ok({ ok: true })),
			setPluginEnabled: vi.fn(async () => ok({})),
		};
		(globalThis as Record<string, unknown>).window = { omp: { rpc } };
		openSettings = vi.fn();
		openExtensions = vi.fn();
		openInventory = vi.fn();
		hydrateSession = vi.fn(async () => {});
		wiredCtx = {
			...ctx,
			openSettings,
			openExtensions,
			openInventory,
			hydrateSession,
		};
		useToastStore.setState({ toasts: [] });
	});

	it("skills opens the first-class Settings page instead of Extensions", () => {
		const affordance = wired("skills");
		if (affordance.kind !== "window") throw new Error("expected window");
		affordance.open();
		expect(openSettings).toHaveBeenCalledWith("skills");
		expect(openExtensions).not.toHaveBeenCalled();
	});

	it.each([
		["hooks", "hooks"],
		["commands", "commands"],
		["mcp panel", "mcp"],
		["marketplace panel", "resources:marketplaces"],
		["plugins panel", "resources:plugins"],
		["memory panel", "resources:memory"],
		["templates", "resources:templates"],
		["extensions", "skills"],
	] as const)("%s deep-links to Settings route %s", (name, route) => {
		const affordance = wired(name);
		if (affordance.kind !== "window") throw new Error("expected window");
		affordance.open();
		expect(openSettings).toHaveBeenCalledWith(route);
		expect(openExtensions).not.toHaveBeenCalled();
		expect(openInventory).not.toHaveBeenCalled();
	});

	afterEach(() => {
		delete (globalThis as Record<string, unknown>).window;
	});

	it("mcp enable with a name calls mcp_action, toasts, and refreshes", async () => {
		const affordance = wired("mcp enable");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run("srv");
		expect(rpc.mcpAction).toHaveBeenCalledWith("srv", "enable");
		expect(hydrateSession).toHaveBeenCalled();
		expect(lastToast()?.variant).toBe("success");
	});

	it("mcp enable without a name opens the first-class MCP Settings page", async () => {
		const affordance = wired("mcp enable");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.mcpAction).not.toHaveBeenCalled();
		expect(openSettings).toHaveBeenCalledWith("mcp");
		expect(openExtensions).not.toHaveBeenCalled();
	});

	it("advisor on writes advisor.enabled and reports activation state", async () => {
		const affordance = wired("advisor on");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.setSetting).toHaveBeenCalledWith("advisor.enabled", true);
		expect(lastToast()?.variant).toBe("success");
		rpc.setSetting.mockResolvedValueOnce(ok({ advisorEnabled: true, advisorActive: false }));
		await affordance.run();
		expect(lastToast()?.variant).toBe("info");
	});

	it("marketplace update remains an action while install opens the confirming UI", async () => {
		const update = wired("marketplace update");
		if (update.kind !== "action") throw new Error("expected action");
		await update.run();
		expect(rpc.marketplaceAction).toHaveBeenCalledWith({ action: "update" });
		const install = wired("marketplace install");
		if (install.kind !== "window") throw new Error("expected window");
		install.open();
		expect(rpc.marketplaceAction).not.toHaveBeenCalledWith(expect.objectContaining({ action: "install" }));
		expect(openSettings).toHaveBeenCalledWith("resources:marketplaces");
	});

	it("plugins enable without an id opens the installed-plugins Settings route", async () => {
		const affordance = wired("plugins enable");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.setPluginEnabled).not.toHaveBeenCalled();
		expect(openSettings).toHaveBeenCalledWith("resources:plugins");
		expect(openInventory).not.toHaveBeenCalled();
	});

	it("computer status toasts the current setting value", async () => {
		const affordance = wired("computer status");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.getSettings).toHaveBeenCalledWith(["computer.enabled"]);
		expect(lastToast()?.variant).toBe("info");
		expect(lastToast()?.message).toContain("on");
	});
});
