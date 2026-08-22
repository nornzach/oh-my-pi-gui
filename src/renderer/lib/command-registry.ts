/**
 * Declarative command registry: maps every known slash command to a typed
 * UI affordance so the GUI can present them as first-class menu actions
 * instead of injecting "/command" text into the composer.
 *
 * Affordance kinds:
 * - `action`      — fire an RPC command or store action immediately
 * - `toggle`      — boolean state toggle with live on/off status
 * - `picker`      — open a picker dialog (model, thinking level)
 * - `window`      — open a dedicated window (usage, providers, settings)
 * - `submenu`     — expand into subcommands (mcp, marketplace, security…)
 * - `prompt`      — send the command text as a prompt (text-mode fallback)
 * - `unavailable` — non-text command lacking a native GUI affordance
 */

import type { AvailableCommand, CopyTarget, RpcResponse } from "../../shared/rpc-types";
import { hydrateSession } from "../hooks/use-rpc-events";
import { newSessionNow } from "../hooks/use-session-switch";
import { openHandoffDialog } from "../stores/fork-handoff";
import { useModelStore } from "../stores/model";
import { useSessionStore } from "../stores/session";
import { useSettingsStore } from "../stores/settings";
import { useTabsStore } from "../stores/tabs";
import { toast } from "../stores/toast";
import { useTodoStore } from "../stores/todo";
import { type DockCardId, useUiStore } from "../stores/ui";
import { exportSessionHtml } from "./export-session";
import { copyText } from "./format";
import { translate } from "./i18n";
import { clearSessionContext, retryLastTurn as retryLastTurnShared } from "./messages";
import {
	capturePluginActivationOrigin,
	handlePluginActivation,
	isPluginActivationOriginActive,
} from "./plugin-activation";
import { copyTodosToClipboard, dumpTranscriptToClipboard, exportTodos, importTodosFromFile } from "./transcript-copy";
import { addWorkspaceDirectory, moveSessionTo, pickWorkspaceDirectory } from "./workspace-dirs";

export type CommandAffordance =
	| { kind: "action"; run: (args?: string) => unknown; status?: string }
	| { kind: "toggle"; get: () => boolean; set: (enabled: boolean) => unknown }
	| { kind: "picker"; open: () => void }
	| { kind: "window"; open: () => void }
	| { kind: "submenu"; items: CommandMenuItem[] }
	| { kind: "prompt"; text: string; hint?: string }
	| { kind: "unavailable"; reason: string };

export interface CommandMenuItem {
	name: string;
	label: string;
	description?: string;
	category: CommandCategory;
	affordance: CommandAffordance;
	shortcut?: string;
	aliases?: string[];
}

export type CommandCategory =
	| "session"
	| "model"
	| "context"
	| "tools"
	| "providers"
	| "extensions"
	| "modes"
	| "view"
	| "workspace"
	| "other";

export interface CommandRegistryContext {
	/**
	 * Translator for built-in labels/descriptions. Components pass their
	 * reactive `useT()` so the memoized menu rebuilds on locale switch;
	 * non-component callers pass the module-scope `translate()`.
	 */
	t: (key: string, params?: Record<string, string | number>) => string;
	isStreaming: boolean;
	fastModeEnabled: boolean;
	autoCompaction: boolean;
	autoRetry: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	interruptMode: "immediate" | "wait";
	planModeEnabled: boolean;
	prewalkArmed: boolean;
	availableCommands: AvailableCommand[];
	openModelPicker: () => void;
	openSettings: (tab?: string) => void;
	openUsage: () => void;
	openProviders: () => void;
	openCommandPalette: () => void;
	openModelRoles: () => void;
	openStatsDashboard: () => void;
	openRenameDialog: () => void;
	openSessionPicker: () => void;
	openBranchPicker: () => void;
	openSessionTree: () => void;
	openSessionInfo: () => void;
	openModelCompare: () => void;
	openBenchmark: () => void;
	openHandoffDialog: () => void;
	openExtensions: (tab?: "hooks" | "mcp" | "commands") => void;
	openInventory: (tab?: "plugins" | "marketplaces" | "templates" | "memory") => void;
	openThemePicker: () => void;
	openModes: (tab?: "vibe" | "goal" | "loop") => void;
	openAgentHub: (tab?: "definitions" | "hub") => void;
	openPrCenter: () => void;
	openHotkeys: () => void;
	openImportDialog: () => void;
	openProviderConfig: () => void;
	/** Deep-link a center-dock card (todo/plan/agents): expand + flash. */
	focusDockCard: (id: DockCardId) => void;
	/** Retry the last failed turn server-side (retry RPC). */
	retryTurn: () => Promise<unknown>;
	/** Re-send the most recent user message (abortAndPrompt while streaming). */
	retryLastTurn: () => Promise<unknown>;
	/** Clone the whole session at head (true /fork) into a new session. */
	forkSession: () => Promise<unknown>;
	/** Refresh session state after a mutation (compact, fork, etc). */
	hydrateSession: () => Promise<void>;
	rpc: {
		setFastMode: (enabled: boolean) => Promise<RpcResponse>;
		setAutoCompaction: (enabled: boolean) => Promise<RpcResponse>;
		setAutoRetry: (enabled: boolean) => Promise<RpcResponse>;
		setSteeringMode: (mode: "all" | "one-at-a-time") => Promise<unknown>;
		setFollowUpMode: (mode: "all" | "one-at-a-time") => Promise<unknown>;
		setInterruptMode: (mode: "immediate" | "wait") => Promise<unknown>;
		compact: (instructions?: string) => Promise<RpcResponse>;
		newSession: () => Promise<unknown>;
		handoff: () => Promise<unknown>;
		prompt: (message: string) => Promise<unknown>;
		setPlanMode: (enabled: boolean) => Promise<RpcResponse>;
		setPrewalk: (enabled: boolean) => Promise<RpcResponse>;
		exportHtml: (path?: string) => Promise<unknown>;
		setSessionName: (name: string) => Promise<unknown>;
		cycleModel: () => Promise<unknown>;
		cycleThinkingLevel: () => Promise<unknown>;
	};
}

/**
 * Commands left as kind:"prompt" forward `/cmd` text to the agent, which
 * runs the logic agent-side and replies with TUI-rendered text. Nativizing
 * them needs a dedicated RPC per command (structured result instead of text)
 * — tracked as P1: security, session delete, session pin.
 */

/** Helper to build a prompt affordance. */
const p = (text: string, hint?: string): CommandAffordance => ({ kind: "prompt", text, hint });

/**
 * Locale key stem for a command name: hyphens camelCase, spaces become dots
 * ("model cycle" → "cmd.model.cycle", "mcp smithery-search" → "cmd.mcp.smitherySearch").
 */
const keyOf = (name: string): string =>
	name.replace(/-(\w)/g, (_hyphen, ch: string) => ch.toUpperCase()).replace(/ /g, ".");

/**
 * Runtime toggle applier (mirrors SettingsWindow's apply* pattern): toast on
 * RPC failure, otherwise apply the returned state to the owning store so the
 * UI reflects the server truth immediately instead of waiting for a push.
 */
async function applyToggle(
	promise: Promise<RpcResponse>,
	title: string,
	apply: (data: unknown) => void,
): Promise<void> {
	const res = await promise;
	if (res.success) apply(res.data);
	else toast({ variant: "error", title, message: res.error });
}

export function buildCommandMenu(ctx: CommandRegistryContext): CommandMenuItem[] {
	const { t } = ctx;
	const items: CommandMenuItem[] = [];
	const seen = new Set<string>();

	const add = (item: CommandMenuItem) => {
		if (seen.has(item.name)) return;
		seen.add(item.name);
		items.push(item);
	};

	/** Helper to build a submenu item; the label resolves through the ctx translator. */
	const sub = (name: string, text: string, hint?: string): CommandMenuItem => ({
		name,
		label: t(`cmd.${keyOf(name)}`),
		category: "extensions",
		affordance: p(text, hint),
	});

	/** Helper to build a submenu item executing a native action (RPC/store) instead of prompt text. */
	const subAction = (name: string, run: (args?: string) => unknown): CommandMenuItem => ({
		name,
		label: t(`cmd.${keyOf(name)}`),
		category: "extensions",
		affordance: { kind: "action", run },
	});

	/** Helper to build a submenu item opening a native surface (panel/tab/dialog). */
	const subWindow = (name: string, open: () => void): CommandMenuItem => ({
		name,
		label: t(`cmd.${keyOf(name)}`),
		category: "extensions",
		affordance: { kind: "window", open },
	});

	/** Helper to build a disabled submenu item whose reason replaces the prompt affordance. */
	const subUnavailable = (name: string, reason: string): CommandMenuItem => ({
		name,
		label: t(`cmd.${keyOf(name)}`),
		category: "extensions",
		affordance: { kind: "unavailable", reason },
	});

	/** Read a single setting for status toasts; RPC failures throw for the palette to surface. */
	const readSetting = async (path: string): Promise<unknown> => {
		const res = await window.omp.rpc.getSettings([path]);
		if (!res.success) throw new Error(res.error);
		return (res.data as { values?: Record<string, unknown> } | undefined)?.values?.[path];
	};

	/**
	 * Persist a settings mutation via the same set_setting RPC the SettingsWindow
	 * toggles use (the agent live-applies runtime keys) and toast the result.
	 */
	const writeSetting = async (path: string, value: unknown, message: string): Promise<void> => {
		const res = await window.omp.rpc.setSetting(path, value);
		if (!res.success) throw new Error(res.error);
		toast({ variant: "success", message });
	};

	/** /advisor on|off — set_setting live-applies advisor.enabled and reports activation state. */
	const setAdvisor = async (enabled: boolean): Promise<void> => {
		const res = await window.omp.rpc.setSetting("advisor.enabled", enabled);
		if (!res.success) throw new Error(res.error);
		const data = res.data as { advisorEnabled?: boolean; advisorActive?: boolean } | undefined;
		if (enabled && data?.advisorEnabled === true && data.advisorActive !== true) {
			toast({ variant: "info", message: t("advisor.noModel") });
			return;
		}
		toast({ variant: "success", message: t(enabled ? "advisor.enabled" : "advisor.disabled") });
	};

	/** /mcp enable|disable|remove|reconnect <name>; a bare invocation opens the native MCP tab. */
	const runMcpAction = async (verb: "enable" | "disable" | "reconnect" | "remove", args?: string): Promise<void> => {
		const name = args?.trim();
		if (!name) {
			ctx.openSettings("mcp");
			return;
		}
		const res = await window.omp.rpc.mcpAction(name, verb);
		if (!res.success) throw new Error(res.error);
		await ctx.hydrateSession();
		toast({ variant: "success", message: t(`mcpAction.${verb}`, { name }) });
	};

	/**
	 * /marketplace mutations via marketplace_action. Install intentionally opens
	 * Inventory so the trust confirmation is the only executable-code entry.
	 */
	const runMarketplaceAction = async (
		verb: "add" | "remove" | "update" | "uninstall" | "upgrade",
		args?: string,
	): Promise<void> => {
		const input = args?.trim() ?? "";
		if (!input && verb !== "update") {
			ctx.openSettings(verb === "uninstall" ? "resources:plugins" : "resources:marketplaces");
			return;
		}
		const origin = verb === "uninstall" || verb === "upgrade" ? capturePluginActivationOrigin() : null;
		if ((verb === "uninstall" || verb === "upgrade") && !origin) {
			throw new Error(t("pluginActivation.routePending"));
		}
		const payload: { action: typeof verb; marketplace?: string; plugin?: string; source?: string } = {
			action: verb,
		};
		if (verb === "add") payload.source = input;
		else if (verb === "remove" || verb === "update") {
			if (input) payload.marketplace = input;
		} else {
			// uninstall/upgrade address plugins as name@marketplace (TUI arg form).
			const at = input.lastIndexOf("@");
			if (at <= 0 || at === input.length - 1) throw new Error(t("marketplaceAction.badId", { id: input }));
			payload.plugin = input.slice(0, at);
			payload.marketplace = input.slice(at + 1);
		}
		const res = await window.omp.rpc.marketplaceAction(payload);
		if (!res.success) throw new Error(res.error);
		const data = res.data as { ok?: boolean; error?: string; activation?: string } | undefined;
		if (data?.ok === false) throw new Error(data.error ?? t("marketplaceAction.failed"));
		if (origin) {
			await handlePluginActivation(
				data?.activation,
				{ pluginId: input, expected: verb === "uninstall" ? "disabled" : "enabled" },
				origin,
			);
			if (!isPluginActivationOriginActive(origin)) return;
		}
		await ctx.hydrateSession();
		toast({ variant: "success", message: t(`marketplaceAction.${verb}`, { name: input }) });
	};

	/** /plugins enable|disable <name@marketplace>; a bare invocation opens the installed-plugins tab. */
	const runPluginEnabled = async (enabled: boolean, args?: string): Promise<void> => {
		const id = args?.trim();
		if (!id) {
			ctx.openSettings("resources:plugins");
			return;
		}
		const origin = capturePluginActivationOrigin();
		if (!origin) throw new Error(t("pluginActivation.routePending"));
		const res = await window.omp.rpc.setPluginEnabled(id, enabled);
		if (!res.success) throw new Error(res.error);
		const data = res.data as { activation?: string } | undefined;
		await handlePluginActivation(
			data?.activation,
			{ pluginId: id, expected: enabled ? "enabled" : "disabled" },
			origin,
		);
		if (isPluginActivationOriginActive(origin)) {
			await ctx.hydrateSession();
			toast({
				variant: "success",
				message: t(enabled ? "pluginAction.enabled" : "pluginAction.disabled", { name: id }),
			});
		}
	};

	// ═══════════════════════════════════════════════════════════════════
	// SESSION
	// ═══════════════════════════════════════════════════════════════════
	// /new and /clear replace the session server-side and would silently abort
	// an in-flight run — block while busy, same guard as the menu/deep-link
	// paths and the WorkspaceDialog actions.
	const newSessionGuarded = (): Promise<unknown> | undefined => {
		const { isStreaming, isCompacting } = useSessionStore.getState();
		if (isStreaming || isCompacting) {
			toast({ variant: "warning", message: t("sessionSwitch.busyBlocked") });
			return undefined;
		}
		return ctx.rpc.newSession();
	};
	// /clear drops context in place (clear_context RPC) — the server refuses
	// while streaming; guard client-side with the same busy toast.
	const clearContextGuarded = (): Promise<boolean> | undefined => {
		const { isStreaming, isCompacting } = useSessionStore.getState();
		if (isStreaming || isCompacting) {
			toast({ variant: "warning", message: t("sessionSwitch.busyBlocked") });
			return undefined;
		}
		return clearSessionContext();
	};
	// /fresh rotates provider stream state (fresh RPC) — same busy boundary as
	// /clear, so it gets the same client-side guard.
	const freshGuarded = (): Promise<void> | undefined => {
		const { isStreaming, isCompacting } = useSessionStore.getState();
		if (isStreaming || isCompacting) {
			toast({ variant: "warning", message: t("sessionSwitch.busyBlocked") });
			return undefined;
		}
		return freshProviderStateFromGui();
	};
	add({
		name: "new",
		label: t("cmd.new"),
		description: t("cmd.new.desc"),
		category: "session",
		shortcut: "⌘N",
		affordance: { kind: "action", run: () => newSessionGuarded() },
	});
	add({
		name: "new-tab",
		label: t("cmd.newTab"),
		description: t("cmd.newTab.desc"),
		category: "session",
		shortcut: "⌘T",
		affordance: { kind: "action", run: () => useTabsStore.getState().openTab() },
	});
	add({
		name: "new-chat-tab",
		label: t("cmd.newChatTab"),
		description: t("cmd.newChatTab.desc"),
		category: "session",
		shortcut: "⇧⌘T",
		affordance: { kind: "action", run: () => useTabsStore.getState().openTab({ kind: "chat" }) },
	});
	add({
		name: "clear",
		label: t("cmd.clear"),
		description: t("cmd.clear.desc"),
		category: "session",
		affordance: { kind: "action", run: () => clearContextGuarded() },
	});
	add({
		name: "resume",
		label: t("cmd.resume"),
		description: t("cmd.resume.desc"),
		category: "session",
		affordance: { kind: "picker", open: ctx.openSessionPicker },
	});
	add({
		name: "import",
		label: t("cmd.import"),
		description: t("cmd.import.desc"),
		category: "session",
		affordance: { kind: "window", open: () => ctx.openImportDialog() },
	});
	add({
		name: "session",
		label: t("cmd.session"),
		description: t("cmd.session.desc"),
		category: "session",
		affordance: {
			kind: "submenu",
			items: [
				{
					name: "session info",
					label: t("cmd.session.info"),
					category: "extensions",
					affordance: { kind: "window", open: ctx.openSessionInfo },
				},
				// /session delete + /session pin stay forwarded — need dedicated RPC (P1).
				sub("session delete", "/session delete"),
				sub("session pin", "/session pin ", "[account]"),
			],
		},
	});
	add({
		name: "rename",
		label: t("cmd.rename"),
		description: t("cmd.rename.desc"),
		category: "session",
		affordance: { kind: "picker", open: ctx.openRenameDialog },
	});
	add({
		name: "handoff",
		label: t("cmd.handoff"),
		description: t("cmd.handoff.desc"),
		category: "session",
		affordance: { kind: "picker", open: ctx.openHandoffDialog },
	});
	add({
		name: "export",
		label: t("cmd.export"),
		description: t("cmd.export.desc"),
		category: "session",
		affordance: { kind: "action", run: () => exportSessionHtml() },
	});
	add({
		name: "share",
		label: t("cmd.share"),
		description: t("cmd.share.desc"),
		category: "session",
		affordance: { kind: "window", open: () => useUiStore.getState().openShareSession() },
	});
	add({
		name: "dump",
		label: t("cmd.dump"),
		description: t("cmd.dump.desc"),
		category: "session",
		affordance: { kind: "action", run: () => dumpTranscriptToClipboard() },
	});
	add({
		name: "branch",
		label: t("cmd.branch"),
		description: t("cmd.branch.desc"),
		category: "session",
		affordance: { kind: "picker", open: ctx.openBranchPicker },
	});
	add({
		name: "fork",
		label: t("cmd.fork"),
		description: t("cmd.fork.desc"),
		category: "session",
		affordance: { kind: "action", run: () => ctx.forkSession() },
	});
	add({
		name: "tree",
		label: t("cmd.tree"),
		description: t("cmd.tree.desc"),
		category: "session",
		affordance: { kind: "window", open: ctx.openSessionTree },
	});
	add({
		name: "drop",
		label: t("cmd.drop"),
		description: t("cmd.drop.desc"),
		category: "session",
		affordance: { kind: "action", run: dropSessionFromGui },
	});
	add({
		name: "quit",
		aliases: ["exit"],
		label: t("cmd.quit"),
		description: t("cmd.quit.desc"),
		category: "session",
		affordance: { kind: "action", run: () => window.close() },
	});
	add({
		name: "retry",
		label: t("cmd.retry"),
		description: t("cmd.retry.desc"),
		category: "session",
		shortcut: "⌥R",
		affordance: { kind: "action", run: () => ctx.retryTurn() },
	});
	add({
		name: "resend",
		label: t("cmd.resend"),
		description: t("cmd.resend.desc"),
		category: "session",
		affordance: { kind: "action", run: () => ctx.retryLastTurn() },
	});
	// /queue focuses the composer prefilled with the yield-queue shorthand
	// ("-> ") via the same omp:fill-composer channel the starter cards and the
	// session-tree draft restore use — the composer submits the queue over RPC.
	add({
		name: "queue",
		label: t("cmd.queue"),
		description: t("cmd.queue.desc"),
		category: "session",
		affordance: { kind: "action", run: () => prefillQueueShorthand() },
	});

	// ═══════════════════════════════════════════════════════════════════
	// MODEL
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "model",
		label: t("cmd.model"),
		description: t("cmd.model.desc"),
		category: "model",
		aliases: ["models"],
		affordance: { kind: "picker", open: ctx.openModelPicker },
	});
	add({
		name: "switch",
		label: t("cmd.switch"),
		description: t("cmd.switch.desc"),
		category: "model",
		affordance: { kind: "picker", open: ctx.openModelPicker },
	});
	add({
		name: "model cycle",
		label: t("cmd.model.cycle"),
		description: t("cmd.model.cycle.desc"),
		category: "model",
		shortcut: "⌃P",
		affordance: { kind: "action", run: () => ctx.rpc.cycleModel() },
	});
	add({
		name: "thinking cycle",
		label: t("cmd.thinking.cycle"),
		description: t("cmd.thinking.cycle.desc"),
		category: "model",
		shortcut: "⇧Tab",
		affordance: { kind: "action", run: () => ctx.rpc.cycleThinkingLevel() },
	});
	add({
		name: "fast",
		label: t("cmd.fast"),
		description: t("cmd.fast.desc"),
		category: "model",
		affordance: {
			kind: "toggle",
			get: () => ctx.fastModeEnabled,
			set: e =>
				applyToggle(ctx.rpc.setFastMode(e), "Fast mode", data => {
					const d = data as { enabled?: boolean; active?: boolean } | undefined;
					useModelStore.setState({ fastModeEnabled: d?.enabled ?? e, fastModeActive: d?.active ?? false });
				}),
		},
	});
	add({
		name: "prewalk",
		label: t("cmd.prewalk"),
		description: t("cmd.prewalk.desc"),
		category: "model",
		affordance: {
			kind: "toggle",
			get: () => ctx.prewalkArmed,
			set: e =>
				applyToggle(ctx.rpc.setPrewalk(e), t("cmd.prewalk"), data => {
					const d = data as { enabled?: boolean } | undefined;
					useSessionStore.setState({ prewalkArmed: d?.enabled ?? e });
				}),
		},
	});
	add({
		name: "advisor",
		label: t("cmd.advisor"),
		description: t("cmd.advisor.desc"),
		category: "model",
		affordance: {
			kind: "submenu",
			items: [
				subAction("advisor on", () => setAdvisor(true)),
				subAction("advisor off", () => setAdvisor(false)),
				// Text reports stay forwarded until a structured RPC exists (contract).
				sub("advisor status", "/advisor status"),
				sub("advisor dump", "/advisor dump"),
			],
		},
	});
	add({
		name: "model-roles",
		label: t("cmd.modelRoles"),
		description: t("cmd.modelRoles.desc"),
		category: "model",
		affordance: { kind: "window", open: ctx.openModelRoles },
	});
	add({
		name: "model-compare",
		label: t("cmd.modelCompare"),
		description: t("cmd.modelCompare.desc"),
		category: "model",
		aliases: ["compare"],
		affordance: { kind: "window", open: ctx.openModelCompare },
	});
	add({
		name: "benchmark",
		label: t("cmd.benchmark"),
		description: t("cmd.benchmark.desc"),
		category: "model",
		aliases: ["bench", "performance"],
		affordance: { kind: "window", open: ctx.openBenchmark },
	});

	// ═══════════════════════════════════════════════════════════════════
	// CONTEXT
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "compact",
		label: t("cmd.compact"),
		description: t("cmd.compact.desc"),
		category: "context",
		affordance: {
			kind: "action",
			run: async () => {
				const res = await ctx.rpc.compact();
				if (!res.success) throw new Error(res.error);
				await ctx.hydrateSession();
				toast({ variant: "success", title: t("command.compactedTitle"), message: t("command.compactedMessage") });
			},
		},
	});
	add({
		name: "shake",
		label: t("cmd.shake"),
		description: t("cmd.shake.desc"),
		category: "context",
		affordance: {
			kind: "submenu",
			items: [
				{
					name: "shake elide",
					label: t("cmd.shake.elide"),
					category: "extensions",
					affordance: { kind: "action", run: () => shakeContextFromGui("elide") },
				},
				{
					name: "shake images",
					label: t("cmd.shake.images"),
					category: "extensions",
					affordance: { kind: "action", run: () => shakeContextFromGui("images") },
				},
				{
					name: "shake thinking",
					label: t("cmd.shake.thinking"),
					category: "extensions",
					affordance: { kind: "action", run: () => shakeContextFromGui("thinking") },
				},
			],
		},
	});
	add({
		name: "context",
		label: t("cmd.context"),
		description: t("cmd.context.desc"),
		category: "context",
		affordance: { kind: "window", open: () => useUiStore.getState().openContextReport() },
	});
	add({
		name: "auto-compact",
		label: t("cmd.autoCompact"),
		description: t("cmd.autoCompact.desc"),
		category: "context",
		affordance: {
			kind: "toggle",
			get: () => ctx.autoCompaction,
			set: e =>
				applyToggle(ctx.rpc.setAutoCompaction(e), "Auto-compaction", () =>
					useSettingsStore.getState().update({ autoCompaction: e }),
				),
		},
	});
	add({
		name: "auto-retry",
		label: t("cmd.autoRetry"),
		description: t("cmd.autoRetry.desc"),
		category: "context",
		affordance: {
			kind: "toggle",
			get: () => ctx.autoRetry,
			set: e =>
				applyToggle(ctx.rpc.setAutoRetry(e), "Auto-retry", () =>
					useSettingsStore.getState().update({ autoRetry: e }),
				),
		},
	});
	add({
		name: "fresh",
		label: t("cmd.fresh"),
		description: t("cmd.fresh.desc"),
		category: "context",
		affordance: { kind: "action", run: () => freshGuarded() },
	});

	// ═══════════════════════════════════════════════════════════════════
	// TOOLS
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "tools",
		label: t("cmd.tools"),
		description: t("cmd.tools.desc"),
		category: "tools",
		affordance: { kind: "window", open: () => useUiStore.getState().openActiveTools() },
	});
	add({
		name: "computer",
		label: t("cmd.computer"),
		description: t("cmd.computer.desc"),
		category: "tools",
		affordance: {
			kind: "submenu",
			items: [
				// Same set_setting mutation the SettingsWindow computer.enabled toggle uses.
				subAction("computer on", () => writeSetting("computer.enabled", true, t("computer.on"))),
				subAction("computer off", () => writeSetting("computer.enabled", false, t("computer.off"))),
				subAction("computer status", async () => {
					const value = await readSetting("computer.enabled");
					toast({
						variant: "info",
						title: t("cmd.computer"),
						message: t(value === true ? "computer.on" : "computer.off"),
					});
				}),
			],
		},
	});
	add({
		name: "vision",
		label: t("cmd.vision"),
		description: t("cmd.vision.desc"),
		category: "tools",
		affordance: {
			kind: "submenu",
			items: [
				// Same set_setting mutation the SettingsWindow inspect_image.mode selector uses.
				subAction("vision on", () => writeSetting("inspect_image.mode", "on", t("vision.on"))),
				subAction("vision off", () => writeSetting("inspect_image.mode", "off", t("vision.off"))),
				subAction("vision auto", () => writeSetting("inspect_image.mode", "auto", t("vision.auto"))),
				subAction("vision status", async () => {
					const value = await readSetting("inspect_image.mode");
					const mode = value === "on" || value === "off" ? value : "auto";
					toast({ variant: "info", title: t("cmd.vision"), message: t(`vision.${mode}`) });
				}),
			],
		},
	});
	add({
		name: "browser",
		label: t("cmd.browser"),
		description: t("cmd.browser.desc"),
		category: "tools",
		affordance: {
			kind: "submenu",
			// Same set_setting mutation the SettingsWindow browser.headless toggle uses.
			items: [
				subAction("browser headless", () => writeSetting("browser.headless", true, t("browser.headlessOn"))),
				subAction("browser visible", () => writeSetting("browser.headless", false, t("browser.visibleOn"))),
			],
		},
	});
	add({
		name: "force",
		label: t("cmd.force"),
		description: t("cmd.force.desc"),
		category: "tools",
		affordance: { kind: "picker", open: () => useUiStore.getState().openForceTool() },
	});
	add({
		name: "todo",
		label: t("cmd.todo"),
		description: t("cmd.todo.desc"),
		category: "tools",
		affordance: {
			kind: "submenu",
			items: [
				subAction("todo edit", () => {
					// The dock card self-hides with no todos — say so instead of no-oping.
					const hasTodos = useTodoStore.getState().phases.some(phase => phase.tasks.length > 0);
					if (!hasTodos) {
						toast({ variant: "info", message: translate("todoPanel.empty") });
						return;
					}
					ctx.focusDockCard("todo");
				}),
				subAction("todo copy", () => copyTodosToClipboard()),
				subAction("todo export", () => exportTodos()),
				subAction("todo import", () => importTodosFromFile()),
			],
		},
	});

	// ═══════════════════════════════════════════════════════════════════
	// PROVIDERS
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "providers",
		label: t("cmd.providers"),
		description: t("cmd.providers.desc"),
		category: "providers",
		affordance: { kind: "window", open: ctx.openProviders },
	});
	add({
		name: "add-provider",
		label: t("cmd.addProvider"),
		description: t("cmd.addProvider.desc"),
		category: "providers",
		aliases: ["provider-config", "custom-provider"],
		affordance: { kind: "window", open: ctx.openProviderConfig },
	});
	add({
		name: "usage",
		label: t("cmd.usage"),
		description: t("cmd.usage.desc"),
		category: "providers",
		affordance: { kind: "window", open: ctx.openUsage },
	});
	add({
		name: "login",
		label: t("cmd.login"),
		description: t("cmd.login.desc"),
		category: "providers",
		affordance: { kind: "window", open: ctx.openProviders },
	});
	add({
		name: "logout",
		label: t("cmd.logout"),
		description: t("cmd.logout.desc"),
		category: "providers",
		affordance: { kind: "window", open: ctx.openProviders },
	});

	// ═══════════════════════════════════════════════════════════════════
	// EXTENSIONS
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "skills",
		label: t("cmd.skills"),
		description: t("cmd.skills.desc"),
		category: "extensions",
		affordance: { kind: "window", open: () => ctx.openSettings("skills") },
	});
	add({
		name: "hooks",
		label: t("cmd.hooks"),
		description: t("cmd.hooks.desc"),
		category: "extensions",
		affordance: { kind: "window", open: () => ctx.openSettings("hooks") },
	});
	add({
		name: "commands",
		label: t("cmd.commands"),
		description: t("cmd.commands.desc"),
		category: "extensions",
		affordance: { kind: "window", open: () => ctx.openSettings("commands") },
	});
	add({
		name: "mcp",
		label: t("cmd.mcp"),
		description: t("cmd.mcp.desc"),
		category: "extensions",
		affordance: {
			kind: "submenu",
			items: [
				{
					name: "mcp panel",
					label: t("cmd.mcp.panel"),
					description: t("cmd.mcp.panel.desc"),
					category: "extensions",
					affordance: { kind: "window", open: () => ctx.openSettings("mcp") },
				},
				{
					name: "mcp list",
					label: t("cmd.mcp.list"),
					description: t("cmd.mcp.list.desc"),
					category: "extensions",
					affordance: { kind: "window", open: () => ctx.openSettings("mcp") },
				},
				// add/test/reauth are covered natively by the MCP tab (wizard + cards).
				subWindow("mcp add", () => ctx.openSettings("mcp")),
				subAction("mcp remove", args => runMcpAction("remove", args)),
				subWindow("mcp test", () => ctx.openSettings("mcp")),
				subAction("mcp enable", args => runMcpAction("enable", args)),
				subAction("mcp disable", args => runMcpAction("disable", args)),
				subWindow("mcp reauth", () => ctx.openSettings("mcp")),
				sub("mcp unauth", "/mcp unauth ", "<name>"),
				subAction("mcp reconnect", args => runMcpAction("reconnect", args)),
				sub("mcp reload", "/mcp reload"),
				sub("mcp resources", "/mcp resources"),
				sub("mcp prompts", "/mcp prompts"),
				sub("mcp notifications", "/mcp notifications"),
				sub("mcp smithery-search", "/mcp smithery-search ", "<keyword>"),
				sub("mcp smithery-login", "/mcp smithery-login"),
				sub("mcp smithery-logout", "/mcp smithery-logout"),
				sub("mcp help", "/mcp help"),
			],
		},
	});
	add({
		name: "marketplace",
		label: t("cmd.marketplace"),
		description: t("cmd.marketplace.desc"),
		category: "extensions",
		affordance: {
			kind: "submenu",
			items: [
				{
					name: "marketplace panel",
					label: t("cmd.marketplace.panel"),
					description: t("cmd.marketplace.panel.desc"),
					category: "extensions",
					affordance: { kind: "window", open: () => ctx.openSettings("resources:marketplaces") },
				},
				{
					name: "marketplace list",
					label: t("cmd.marketplace.list"),
					description: t("cmd.marketplace.list.desc"),
					category: "extensions",
					affordance: { kind: "window", open: () => ctx.openSettings("resources:marketplaces") },
				},
				subAction("marketplace add", args => runMarketplaceAction("add", args)),
				subAction("marketplace remove", args => runMarketplaceAction("remove", args)),
				subAction("marketplace update", args => runMarketplaceAction("update", args)),
				subWindow("marketplace discover", () => ctx.openSettings("resources:marketplaces")),
				subWindow("marketplace install", () => ctx.openSettings("resources:marketplaces")),
				subAction("marketplace uninstall", args => runMarketplaceAction("uninstall", args)),
				{
					name: "marketplace installed",
					label: t("cmd.marketplace.installed"),
					description: t("cmd.marketplace.installed.desc"),
					category: "extensions",
					affordance: { kind: "window", open: () => ctx.openSettings("resources:plugins") },
				},
				subAction("marketplace upgrade", args => runMarketplaceAction("upgrade", args)),
				sub("marketplace help", "/marketplace help"),
			],
		},
	});
	add({
		name: "plugins",
		label: t("cmd.plugins"),
		description: t("cmd.plugins.desc"),
		category: "extensions",
		affordance: {
			kind: "submenu",
			items: [
				{
					name: "plugins panel",
					label: t("cmd.plugins.panel"),
					description: t("cmd.plugins.panel.desc"),
					category: "extensions",
					affordance: { kind: "window", open: () => ctx.openSettings("resources:plugins") },
				},
				sub("plugins list", "/plugins list"),
				subAction("plugins enable", args => runPluginEnabled(true, args)),
				subAction("plugins disable", args => runPluginEnabled(false, args)),
			],
		},
	});
	add({
		name: "reload-plugins",
		label: t("cmd.reloadPlugins"),
		description: t("cmd.reloadPlugins.desc"),
		category: "extensions",
		affordance: { kind: "action", run: () => reloadPluginsFromGui(ctx.hydrateSession) },
	});
	add({
		name: "memory",
		label: t("cmd.memory"),
		description: t("cmd.memory.desc"),
		category: "extensions",
		affordance: {
			kind: "submenu",
			items: [
				{
					name: "memory panel",
					label: t("cmd.memory.panel"),
					description: t("cmd.memory.panel.desc"),
					category: "extensions",
					affordance: { kind: "window", open: () => ctx.openSettings("resources:memory") },
				},
				// The Inventory memory tab covers view/stats/diagnose natively.
				subWindow("memory view", () => ctx.openSettings("resources:memory")),
				subWindow("memory stats", () => ctx.openSettings("resources:memory")),
				subWindow("memory diagnose", () => ctx.openSettings("resources:memory")),
				sub("memory clear", "/memory clear"),
				sub("memory enqueue", "/memory enqueue"),
			],
		},
	});
	add({
		name: "security",
		label: t("cmd.security"),
		description: t("cmd.security.desc"),
		category: "extensions",
		affordance: {
			kind: "submenu",
			items: [
				sub("security plan", "/security plan"),
				sub("security scan", "/security scan"),
				sub("security status", "/security status"),
				sub("security cancel", "/security cancel"),
				sub("security scans", "/security scans"),
				sub("security show", "/security show ", "<id>"),
				sub("security import", "/security import ", "<path>"),
				sub("security export", "/security export"),
				sub("security validate", "/security validate ", "<id>"),
				sub("security compare", "/security compare"),
				sub("security disposition", "/security disposition"),
			],
		},
	});
	add({
		name: "templates",
		label: t("cmd.templates"),
		description: t("cmd.templates.desc"),
		category: "extensions",
		aliases: ["prompt-templates"],
		affordance: { kind: "window", open: () => ctx.openSettings("resources:templates") },
	});
	add({
		name: "ssh",
		label: t("cmd.ssh"),
		description: t("cmd.ssh.desc"),
		category: "extensions",
		affordance: {
			kind: "submenu",
			items: [
				// No native SSH hosts surface exists in the GUI (hosts live in
				// ssh.json capability files; no RPC or fs-write bridge), so these
				// show disabled-with-reason instead of faking a prompt round-trip.
				subUnavailable("ssh list", t("ssh.noSurface")),
				subUnavailable("ssh add", t("ssh.noSurface")),
				subUnavailable("ssh remove", t("ssh.noSurface")),
				sub("ssh help", "/ssh help"),
			],
		},
	});

	// ═══════════════════════════════════════════════════════════════════
	// MODES
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "plan",
		label: t("cmd.plan"),
		description: t("cmd.plan.desc"),
		category: "modes",
		shortcut: "⌥⇧P",
		affordance: {
			kind: "toggle",
			get: () => ctx.planModeEnabled,
			set: e =>
				applyToggle(ctx.rpc.setPlanMode(e), "Plan mode", data => {
					const d = data as { enabled?: boolean } | undefined;
					useSessionStore.setState({ planModeEnabled: d?.enabled ?? e });
				}),
		},
	});
	add({
		name: "vibe",
		label: t("cmd.vibe"),
		description: t("cmd.vibe.desc"),
		category: "modes",
		affordance: { kind: "window", open: () => ctx.openModes("vibe") },
	});
	add({
		name: "goal",
		label: t("cmd.goal"),
		description: t("cmd.goal.desc"),
		category: "modes",
		affordance: { kind: "window", open: () => ctx.openModes("goal") },
	});
	add({
		name: "loop",
		label: t("cmd.loop"),
		description: t("cmd.loop.desc"),
		category: "modes",
		affordance: { kind: "window", open: () => ctx.openModes("loop") },
	});

	// ═══════════════════════════════════════════════════════════════════
	// WORKSPACE
	// ═══════════════════════════════════════════════════════════════════
	// /dirs and /remove-dir open the workspace-directories dialog (it lists the
	// roots and confirms removals inline); /add-dir and /move go straight to
	// the native directory picker + RPC, with the same client-side busy guard
	// as /new and /clear (the server also refuses with the "busy" code).
	const workspaceMutationBusy = (): boolean => {
		const { isStreaming, isCompacting } = useSessionStore.getState();
		if (isStreaming || isCompacting) {
			toast({ variant: "warning", message: t("sessionSwitch.busyBlocked") });
			return true;
		}
		return false;
	};
	const pickAndAdd = async (): Promise<void> => {
		if (workspaceMutationBusy()) return;
		const path = await pickWorkspaceDirectory();
		if (path) await addWorkspaceDirectory(path);
	};
	const pickAndMove = async (): Promise<void> => {
		if (workspaceMutationBusy()) return;
		const path = await pickWorkspaceDirectory();
		if (path) await moveSessionTo(path);
	};
	add({
		name: "move",
		label: t("cmd.move"),
		description: t("cmd.move.desc"),
		category: "workspace",
		affordance: { kind: "picker", open: () => void pickAndMove() },
	});
	add({
		name: "add-dir",
		label: t("cmd.addDir"),
		description: t("cmd.addDir.desc"),
		category: "workspace",
		affordance: { kind: "picker", open: () => void pickAndAdd() },
	});
	add({
		name: "remove-dir",
		label: t("cmd.removeDir"),
		description: t("cmd.removeDir.desc"),
		category: "workspace",
		affordance: { kind: "window", open: () => useUiStore.getState().openWorkspaceDirs() },
	});
	add({
		name: "dirs",
		label: t("cmd.dirs"),
		description: t("cmd.dirs.desc"),
		category: "workspace",
		affordance: { kind: "window", open: () => useUiStore.getState().openWorkspaceDirs() },
	});

	// ═══════════════════════════════════════════════════════════════════
	// VIEW
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "theme",
		label: t("cmd.theme"),
		description: t("cmd.theme.desc"),
		category: "view",
		affordance: { kind: "picker", open: ctx.openThemePicker },
	});
	add({
		name: "settings",
		label: t("cmd.settings"),
		description: t("cmd.settings.desc"),
		category: "view",
		shortcut: "⌘,",
		affordance: { kind: "window", open: ctx.openSettings },
	});
	add({
		name: "stats",
		label: t("cmd.stats"),
		description: t("cmd.stats.desc"),
		category: "view",
		affordance: { kind: "window", open: ctx.openStatsDashboard },
	});
	add({
		name: "jobs",
		label: t("cmd.jobs"),
		description: t("cmd.jobs.desc"),
		category: "view",
		affordance: { kind: "window", open: () => useUiStore.getState().openJobs() },
	});
	add({
		name: "changelog",
		label: t("cmd.changelog"),
		description: t("cmd.changelog.desc"),
		category: "view",
		affordance: { kind: "window", open: () => useUiStore.getState().openChangelog() },
	});
	add({
		name: "copy",
		label: t("cmd.copy"),
		description: t("cmd.copy.desc"),
		category: "view",
		affordance: { kind: "action", run: args => copyFromChat(args) },
	});
	add({
		name: "hotkeys",
		label: t("cmd.hotkeys"),
		description: t("cmd.hotkeys.desc"),
		category: "view",
		affordance: { kind: "window", open: () => ctx.openHotkeys() },
	});
	add({
		name: "extensions",
		label: t("cmd.extensions"),
		description: t("cmd.extensions.desc"),
		category: "view",
		aliases: ["status"],
		affordance: { kind: "window", open: () => ctx.openSettings("skills") },
	});
	add({
		name: "agents",
		label: t("cmd.agents"),
		description: t("cmd.agents.desc"),
		category: "view",
		affordance: { kind: "window", open: () => ctx.openAgentHub() },
	});
	add({
		name: "prs",
		label: t("cmd.prCenter"),
		description: t("cmd.prCenter.desc"),
		category: "view",
		affordance: { kind: "window", open: () => ctx.openPrCenter() },
	});

	// ═══════════════════════════════════════════════════════════════════
	// LIVE COLLABORATION
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "collab",
		label: t("cmd.collab"),
		description: t("cmd.collab.desc"),
		category: "other",
		affordance: { kind: "action", run: args => runCollabCommand(args) },
	});
	add({
		name: "join",
		label: t("cmd.join"),
		description: t("cmd.join.desc"),
		category: "other",
		affordance: { kind: "action", run: link => joinCollab(link) },
	});
	add({
		name: "leave",
		label: t("cmd.leave"),
		description: t("cmd.leave.desc"),
		category: "other",
		affordance: { kind: "action", run: () => leaveCollab() },
	});

	// ═══════════════════════════════════════════════════════════════════
	// NATIVE INTERACTIVE SURFACES
	// ═══════════════════════════════════════════════════════════════════
	add({
		name: "btw",
		label: t("cmd.btw"),
		description: t("cmd.btw.desc"),
		category: "other",
		affordance: {
			kind: "action",
			run: question => {
				const trimmed = question?.trim();
				if (!trimmed) {
					toast({ variant: "info", message: translate("btw.usage") });
					return;
				}
				useUiStore.getState().openBtw(trimmed);
			},
		},
	});
	add({
		name: "tan",
		label: t("cmd.tan"),
		description: t("cmd.tan.desc"),
		category: "other",
		affordance: { kind: "action", run: work => dispatchTan(work) },
	});
	add({
		name: "omfg",
		label: t("cmd.omfg"),
		description: t("cmd.omfg.desc"),
		category: "other",
		affordance: { kind: "action", run: complaint => forgeTtsrRule(complaint) },
	});
	add({
		name: "debug",
		label: t("cmd.debug"),
		description: t("cmd.debug.desc"),
		category: "other",
		affordance: { kind: "window", open: () => useUiStore.getState().openDebug() },
	});
	add({
		name: "live",
		label: t("cmd.live"),
		description: t("cmd.live.desc"),
		category: "other",
		affordance: { kind: "window", open: () => useUiStore.getState().openLive() },
	});
	add({
		name: "pause",
		label: t("cmd.pause"),
		description: t("cmd.pause.desc"),
		category: "other",
		affordance: {
			kind: "toggle",
			get: () => useSessionStore.getState().agentsPaused,
			set: async enabled => {
				const response = await window.omp.rpc.setAgentsPaused(enabled);
				if (!response.success) throw new Error(response.error);
				const data = response.data as { paused: boolean; pausedAt?: number } | undefined;
				useSessionStore.setState({
					agentsPaused: data?.paused ?? enabled,
					agentsPausedAt: data?.pausedAt ?? null,
				});
			},
		},
	});
	add({
		name: "plan-review",
		label: t("cmd.planReview"),
		description: t("cmd.planReview.desc"),
		category: "other",
		affordance: {
			kind: "action",
			run: () => {
				// The dock card only renders while plan mode is on — point at the toggle otherwise.
				if (!useSessionStore.getState().planModeEnabled) {
					toast({ variant: "info", message: translate("planPanel.statusOff") });
					return;
				}
				ctx.focusDockCard("plan");
			},
		},
	});
	add({
		name: "guided-goal",
		label: t("cmd.guidedGoal"),
		description: t("cmd.guidedGoal.desc"),
		category: "other",
		affordance: {
			kind: "action",
			run: async initial => {
				const response = await window.omp.rpc.guidedGoal(initial);
				if (!response.success) throw new Error(response.error);
			},
		},
	});

	// Merge sidecar-advertised commands not already covered.
	for (const cmd of ctx.availableCommands) {
		if (seen.has(cmd.name)) continue;
		if (cmd.textModeExecutable === false) {
			add({
				name: cmd.name,
				label: `/${cmd.name}`,
				description: cmd.description,
				category: "other",
				affordance: { kind: "unavailable", reason: t("unavailable.tuiOnly") },
			});
			continue;
		}
		add({
			name: cmd.name,

			label: `/${cmd.name}`,
			description: cmd.description,
			category: "other",
			affordance: p(`/${cmd.name}${cmd.input?.hint ? " " : ""}`, cmd.input?.hint),
		});
	}

	return items;
}

/** /queue prefill: focus the composer with the yield-queue shorthand ("-> "),
 *  reusing the omp:fill-composer channel (starter cards, session-tree restore). */
function prefillQueueShorthand(): void {
	window.dispatchEvent(new CustomEvent("omp:fill-composer", { detail: { text: "-> " } }));
}

/** /shake elide|images|thinking: confirm, then drop context via shake_context RPC;
 *  the toast carries the agent's removed summary. */
async function shakeContextFromGui(mode: "elide" | "images" | "thinking"): Promise<void> {
	const confirmKey =
		mode === "images" ? "shake.confirmImages" : mode === "thinking" ? "shake.confirmThinking" : "shake.confirmElide";
	if (!window.confirm(translate(confirmKey))) return;
	const response = await window.omp.rpc.shakeContext(mode);
	if (!response.success) {
		toast({ variant: "error", title: translate("cmd.shake"), message: response.error });
		return;
	}
	const removed = (response.data as { removed?: string } | undefined)?.removed;
	toast({ variant: "success", title: translate("cmd.shake"), message: removed ?? translate("shake.success") });
}

/** /fresh: rotate provider stream state via the fresh RPC; the server's busy
 *  refusal (mid-stream) rides a warning toast instead of failing hard. */
async function freshProviderStateFromGui(): Promise<void> {
	const response = await window.omp.rpc.fresh();
	if (!response.success) {
		toast({ variant: "warning", message: response.error });
		return;
	}
	toast({ variant: "success", message: translate("fresh.success") });
}

/** /reload-plugins: reload plugin state via the reload_plugins RPC, toast the
 *  post-reload counts, and rehydrate so the extensions inventory refreshes. */
async function reloadPluginsFromGui(hydrate: () => Promise<void>): Promise<void> {
	const response = await window.omp.rpc.reloadPlugins();
	if (!response.success) {
		toast({ variant: "error", title: translate("cmd.reloadPlugins"), message: response.error });
		return;
	}
	const counts = (response.data as { plugins?: number; skills?: number; commands?: number } | undefined) ?? {};
	toast({
		variant: "success",
		title: translate("cmd.reloadPlugins"),
		message: translate("reloadPlugins.success", {
			plugins: counts.plugins ?? 0,
			skills: counts.skills ?? 0,
			commands: counts.commands ?? 0,
		}),
	});
	await hydrate();
}

async function runCollabCommand(args?: string): Promise<void> {
	const input = args?.trim() ?? "";
	if (!input) {
		useUiStore.getState().openCollab();
		return;
	}
	const [verb, ...rest] = input.split(/\s+/);
	if (verb === "stop") {
		await leaveCollab();
		return;
	}
	if (verb === "status") {
		useUiStore.getState().openCollab();
		return;
	}
	const knownVerb = verb === "start" || verb === "view";
	const relayUrl = knownVerb ? rest.join(" ").trim() : input;
	const response = await window.omp.rpc.collabStart(relayUrl || undefined, verb === "view");
	if (!response.success) throw new Error(response.error);
	useUiStore.getState().openCollab();
}

async function joinCollab(link?: string): Promise<void> {
	const trimmed = link?.trim();
	if (!trimmed) {
		toast({ variant: "info", message: translate("collab.joinUsage") });
		return;
	}
	useUiStore.getState().openCollab(trimmed);
}

async function leaveCollab(): Promise<void> {
	const response = await window.omp.rpc.collabLeave();
	if (!response.success) throw new Error(response.error);
	await hydrateSession();
	toast({ variant: "success", message: translate("collab.left") });
}

async function copyFromChat(args?: string): Promise<void> {
	const kind = args?.trim().toLowerCase();
	if (!kind) {
		useUiStore.getState().openCopySelector();
		return;
	}
	if (kind !== "code" && kind !== "cmd" && kind !== "command") {
		toast({ variant: "info", message: translate("copySelector.usage") });
		return;
	}
	const response = await window.omp.rpc.getCopyTargets();
	if (!response.success) throw new Error(response.error);
	const targets = (response.data as { targets?: CopyTarget[] } | undefined)?.targets ?? [];
	let target: CopyTarget | undefined;
	if (kind === "code") {
		for (const root of targets) {
			const blocks = root.children?.filter(child => child.id.includes(":code:"));
			if (blocks?.length) {
				target = blocks[blocks.length - 1];
				break;
			}
		}
	} else {
		target = targets.find(candidate => candidate.id.startsWith("cmd:"));
	}
	if (target?.content === undefined) {
		toast({
			variant: "info",
			message: translate(kind === "code" ? "copySelector.noCode" : "copySelector.noCommand"),
		});
		return;
	}
	if (!(await copyText(target.content))) throw new Error(translate("copySelector.failed"));
	toast({ variant: "success", message: target.copyMessage ?? translate("copySelector.copied") });
}

async function dispatchTan(work?: string): Promise<void> {
	const trimmed = work?.trim();
	if (!trimmed) {
		toast({ variant: "info", message: translate("tan.usage") });
		return;
	}
	const response = await window.omp.rpc.tan(trimmed);
	if (!response.success) throw new Error(response.error);
	const data = response.data as { jobId?: string } | undefined;
	toast({ variant: "success", message: translate("tan.dispatched", { id: data?.jobId ?? "" }) });
	await hydrateSession();
}

async function forgeTtsrRule(complaint?: string): Promise<void> {
	const trimmed = complaint?.trim();
	if (!trimmed) {
		toast({ variant: "info", message: translate("omfg.usage") });
		return;
	}
	const response = await window.omp.rpc.omfg(trimmed);
	if (!response.success) throw new Error(response.error);
	const data = response.data as { state?: "saved" | "rejected" | "aborted"; savedPath?: string } | undefined;
	if (data?.state === "saved") {
		toast({ variant: "success", message: translate("omfg.saved", { path: data.savedPath ?? "" }) });
	} else {
		toast({ variant: "info", message: translate(data?.state === "rejected" ? "omfg.rejected" : "omfg.aborted") });
	}
}

async function retryFailedTurn(): Promise<void> {
	const response = await window.omp.rpc.retry();
	if (!response.success) throw new Error(response.error);
	const data = response.data as { retried?: boolean } | undefined;
	if (!data?.retried) {
		toast({
			variant: "warning",
			title: translate("palette.retryNothing"),
			message: translate("palette.retryNothingDesc"),
		});
	}
}

export async function dropSessionFromGui(): Promise<void> {
	if (!window.confirm(translate("drop.confirm"))) return;
	const response = await window.omp.rpc.dropSession();
	if (!response.success) throw new Error(response.error);
	const data = response.data as { cancelled?: boolean } | undefined;
	if (data?.cancelled) {
		toast({ variant: "info", message: translate("drop.cancelled") });
		return;
	}
	await hydrateSession();
	toast({ variant: "success", message: translate("drop.success") });
}

export async function forkSessionFromGui(): Promise<void> {
	const response = await window.omp.rpc.fork();
	if (!response.success) throw new Error(response.error);
	const data = response.data as { cancelled?: boolean } | undefined;
	if (data?.cancelled) {
		toast({ variant: "info", message: translate("fork.cancelled") });
		return;
	}
	await hydrateSession();
	toast({ variant: "success", message: translate("fork.success") });
}

/**
 * Build the same canonical affordance list used by CommandPalette from the
 * live stores. Non-component submit paths use this to execute GUI-native
 * builtins instead of forwarding TUI-only command text to the model.
 */
export function buildCurrentCommandMenu(availableCommands: AvailableCommand[]): CommandMenuItem[] {
	const session = useSessionStore.getState();
	const model = useModelStore.getState();
	const settings = useSettingsStore.getState();
	const ui = useUiStore.getState();
	return buildCommandMenu({
		t: translate,
		isStreaming: session.isStreaming,
		fastModeEnabled: model.fastModeEnabled,
		autoCompaction: settings.autoCompaction,
		autoRetry: settings.autoRetry,
		steeringMode: settings.steeringMode,
		followUpMode: settings.followUpMode,
		interruptMode: settings.interruptMode,
		planModeEnabled: session.planModeEnabled,
		prewalkArmed: session.prewalkArmed,
		availableCommands,
		openModelPicker: ui.openModelPicker,
		openSettings: ui.openSettings,
		openUsage: ui.openUsage,
		openProviders: ui.openProviders,
		openCommandPalette: ui.openCommandPalette,
		openModelRoles: ui.openModelRoles,
		openStatsDashboard: ui.openStatsDashboard,
		openRenameDialog: ui.openRenameDialog,
		openSessionPicker: ui.openSessionPicker,
		openBranchPicker: ui.openBranchPicker,
		openSessionTree: ui.openSessionTree,
		openSessionInfo: ui.openSessionInfo,
		openModelCompare: ui.openModelCompare,
		openBenchmark: ui.openBenchmark,
		openHandoffDialog,
		openExtensions: ui.openExtensions,
		openInventory: ui.openInventory,
		openThemePicker: ui.openThemePicker,
		openModes: ui.openModes,
		openAgentHub: ui.openAgentHub,
		openPrCenter: ui.openPrCenter,
		openHotkeys: ui.openHotkeys,
		openImportDialog: ui.openImportDialog,
		openProviderConfig: ui.openProviderConfig,
		focusDockCard: ui.focusDockCard,
		retryTurn: retryFailedTurn,
		retryLastTurn: () =>
			retryLastTurnShared(() =>
				toast({
					variant: "warning",
					title: translate("palette.retryNothing"),
					message: translate("palette.retryNothingDesc"),
				}),
			),
		forkSession: forkSessionFromGui,
		hydrateSession,
		rpc: {
			setFastMode: enabled => window.omp.rpc.setFastMode(enabled),
			setAutoCompaction: enabled => window.omp.rpc.setAutoCompaction(enabled),
			setAutoRetry: enabled => window.omp.rpc.setAutoRetry(enabled),
			setSteeringMode: mode => window.omp.rpc.setSteeringMode(mode),
			setFollowUpMode: mode => window.omp.rpc.setFollowUpMode(mode),
			setInterruptMode: mode => window.omp.rpc.setInterruptMode(mode),
			compact: instructions => window.omp.rpc.compact(instructions),
			newSession: async () => {
				return newSessionNow();
			},
			handoff: () => window.omp.rpc.handoff(),
			prompt: message => window.omp.rpc.prompt(message),
			setPlanMode: enabled => window.omp.rpc.setPlanMode(enabled),
			setPrewalk: enabled => window.omp.rpc.setPrewalk(enabled),
			exportHtml: path => window.omp.rpc.exportHtml(path),
			setSessionName: name => window.omp.rpc.setSessionName(name),
			cycleModel: () => window.omp.rpc.cycleModel(),
			cycleThinkingLevel: () => window.omp.rpc.cycleThinkingLevel(),
		},
	});
}

export function groupByCategory(items: CommandMenuItem[]): Map<CommandCategory, CommandMenuItem[]> {
	const groups = new Map<CommandCategory, CommandMenuItem[]>();
	for (const item of items) {
		const list = groups.get(item.category) ?? [];
		list.push(item);
		groups.set(item.category, list);
	}
	return groups;
}
