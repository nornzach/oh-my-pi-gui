/**
 * Wiring tests for the one-shot action nativization: /prewalk (toggle),
 * /fresh, /shake elide|images|thinking, /reload-plugins, /queue (composer prefill) and
 * /force (dialog picker) must drive their RPC/native affordance — never
 * inject "/cmd" prompt text — and surface the result as a toast or dialog.
 * Exercises buildCommandMenu directly with a mocked window.omp.rpc.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { useSessionStore } from "../stores/session";
import { useToastStore } from "../stores/toast";
import { useUiStore } from "../stores/ui";
import { buildCommandMenu, type CommandAffordance, type CommandRegistryContext } from "./command-registry";
import { translate } from "./i18n";

const ok = (data?: unknown) => ({ type: "response" as const, command: "x", success: true as const, data });

const baseCtx: CommandRegistryContext = {
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
		setFastMode: async () => ok(),
		setAutoCompaction: async () => ok(),
		setAutoRetry: async () => ok(),
		setSteeringMode: async () => {},
		setFollowUpMode: async () => {},
		setInterruptMode: async () => {},
		compact: async () => ok(),
		newSession: async () => {},
		handoff: async () => {},
		prompt: async () => {},
		setPlanMode: async () => ok(),
		setPrewalk: async () => ok({ enabled: true }),
		exportHtml: async () => {},
		setSessionName: async () => {},
		cycleModel: async () => {},
		cycleThinkingLevel: async () => {},
	},
};

const lastToast = () => useToastStore.getState().toasts.at(-1);

let rpc: Record<string, Mock>;
let confirmMock: Mock;
let dispatchMock: Mock;
let hydrateSession: Mock;
let ctx: CommandRegistryContext;

beforeEach(() => {
	rpc = {
		setPrewalk: vi.fn(async () => ok({ enabled: true })),
		fresh: vi.fn(async () => ok({})),
		shakeContext: vi.fn(async () => ok({ removed: "Shook 2 tool results (~1200 tokens freed)." })),
		reloadPlugins: vi.fn(async () => ok({ plugins: 3, skills: 5, commands: 42 })),
	};
	confirmMock = vi.fn(() => true);
	dispatchMock = vi.fn();
	(globalThis as Record<string, unknown>).window = {
		omp: { rpc },
		confirm: confirmMock,
		dispatchEvent: dispatchMock,
	};
	hydrateSession = vi.fn(async () => {});
	ctx = { ...baseCtx, hydrateSession, rpc: { ...baseCtx.rpc, setPrewalk: rpc.setPrewalk } };
	useToastStore.setState({ toasts: [] });
	useSessionStore.setState({ isStreaming: false, isCompacting: false, prewalkArmed: false });
	useUiStore.setState({ forceToolOpen: false });
});

afterEach(() => {
	delete (globalThis as Record<string, unknown>).window;
});

const wired = (name: string): CommandAffordance => {
	const items = buildCommandMenu(ctx);
	const [top, sub] = name.split(" ");
	const topItem = items.find(item => item.name === top);
	if (!topItem) throw new Error(`missing menu item: ${top}`);
	if (sub === undefined) return topItem.affordance;
	if (topItem.affordance.kind !== "submenu") throw new Error(`${top} is not a submenu`);
	const item = topItem.affordance.items.find(candidate => candidate.name === name);
	if (!item) throw new Error(`missing submenu item: ${name}`);
	return item.affordance;
};

describe("one-shot action wiring", () => {
	it("prewalk toggle arms via set_prewalk and mirrors the server state into the store", async () => {
		const affordance = wired("prewalk");
		if (affordance.kind !== "toggle") throw new Error("expected toggle");
		expect(affordance.get()).toBe(false);
		await affordance.set(true);
		expect(rpc.setPrewalk).toHaveBeenCalledWith(true);
		expect(useSessionStore.getState().prewalkArmed).toBe(true);
	});

	it("shake elide confirms, calls shake_context, and toasts the removed summary", async () => {
		const affordance = wired("shake elide");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(confirmMock).toHaveBeenCalled();
		expect(rpc.shakeContext).toHaveBeenCalledWith("elide");
		expect(lastToast()?.variant).toBe("success");
		expect(lastToast()?.message).toContain("Shook 2 tool results");
	});

	it("shake images does nothing when the confirm is declined", async () => {
		confirmMock.mockReturnValueOnce(false);
		const affordance = wired("shake images");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.shakeContext).not.toHaveBeenCalled();
	});

	it("shake thinking uses the structured context RPC", async () => {
		const affordance = wired("shake thinking");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.shakeContext).toHaveBeenCalledWith("thinking");
		expect(lastToast()?.variant).toBe("success");
	});

	it("fresh calls the fresh RPC and toasts success", async () => {
		const affordance = wired("fresh");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.fresh).toHaveBeenCalled();
		expect(lastToast()?.variant).toBe("success");
	});

	it("fresh is blocked while streaming with the busy warning, no RPC", async () => {
		useSessionStore.setState({ isStreaming: true });
		const affordance = wired("fresh");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.fresh).not.toHaveBeenCalled();
		expect(lastToast()?.variant).toBe("warning");
	});

	it("fresh surfaces the server busy refusal as a warning toast", async () => {
		rpc.fresh.mockResolvedValueOnce({
			type: "response",
			command: "fresh",
			success: false,
			error: "Session is busy (streaming or foreground execution in flight)",
		});
		const affordance = wired("fresh");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(lastToast()?.variant).toBe("warning");
	});

	it("reload-plugins toasts the counts and rehydrates the inventory", async () => {
		const affordance = wired("reload-plugins");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(rpc.reloadPlugins).toHaveBeenCalled();
		expect(lastToast()?.variant).toBe("success");
		expect(lastToast()?.message).toContain("3");
		expect(lastToast()?.message).toContain("5");
		expect(lastToast()?.message).toContain("42");
		expect(hydrateSession).toHaveBeenCalled();
	});

	it("reload-plugins failure toasts the error and skips the rehydrate", async () => {
		rpc.reloadPlugins.mockResolvedValueOnce({
			type: "response",
			command: "reload_plugins",
			success: false,
			error: "boom",
		});
		const affordance = wired("reload-plugins");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(lastToast()?.variant).toBe("error");
		expect(hydrateSession).not.toHaveBeenCalled();
	});

	it("queue dispatches the composer prefill with the yield-queue shorthand", async () => {
		const affordance = wired("queue");
		if (affordance.kind !== "action") throw new Error("expected action");
		await affordance.run();
		expect(dispatchMock).toHaveBeenCalledTimes(1);
		const event = dispatchMock.mock.calls[0]?.[0] as CustomEvent<{ text?: string }>;
		expect(event.type).toBe("omp:fill-composer");
		expect(event.detail.text).toBe("-> ");
	});

	it("force opens the ForceToolDialog via the ui store", () => {
		const affordance = wired("force");
		if (affordance.kind !== "picker") throw new Error("expected picker");
		affordance.open();
		expect(useUiStore.getState().forceToolOpen).toBe(true);
	});
});
