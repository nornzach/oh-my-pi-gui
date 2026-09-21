/**
 * Composer message submission policy. Text-mode slash commands execute
 * server-side through the prompt RPC. Builtins that require an interactive
 * surface are resolved through the same GUI affordance registry as the
 * command palette, so they can never leak into model context as literal text.
 * Session-replacing commands are blocked while a turn runs. Local-only
 * server commands rehydrate after settlement so transcript/context state
 * reflects the mutation.
 */

import type { AvailableCommand, ImageContent, RpcResponse } from "../../shared/rpc-types";
import { hydrateSession } from "../hooks/use-rpc-events";
import { toast } from "../stores/toast";
import { buildCurrentCommandMenu, type CommandAffordance } from "./command-registry";
import { translate } from "./i18n";
import type { TabRpc } from "./tab-rpc";

export type ComposerSendMode = "prompt" | "steer" | "followUp";

/** Builtin slash commands that replace the session server-side. */
const SESSION_REPLACING_COMMANDS: Record<string, true> = { new: true, clear: true };
// The desktop requires a visible preview/start step even when Core exposes a
// directly executable text command, or command discovery has not completed.
// `drop` is a GUI alias for `delete`, no longer advertised by Core.
const GUI_CONFIRMATION_COMMANDS = new Set(["share", "live", "btw", "delete", "drop"]);

export type ComposerSubmit =
	/** Session-replacing command while busy — draft stays, warning toasted. */
	| { kind: "blocked" }
	/** Exact `/clear` — native clear_context RPC path (lib/messages.clearSessionContext). */
	| { kind: "clear" }
	/** A GUI-native command opened/executed its affordance synchronously. */
	| { kind: "handled" }
	/** Dispatch this lazy request; on success call {@link settleComposerResponse}. */
	| { kind: "send"; request: () => Promise<RpcResponse> };

function runGuiAffordance(affordance: CommandAffordance, args?: string): boolean {
	const reportFailure = (cause: unknown): void => {
		toast({ variant: "error", title: translate("palette.failed"), message: String(cause) });
	};
	switch (affordance.kind) {
		case "action":
			void Promise.resolve(affordance.run(args)).catch(reportFailure);
			return true;
		case "toggle":
			void Promise.resolve(affordance.set(!affordance.get())).catch(reportFailure);
			return true;
		case "picker":
		case "window":
			affordance.open();
			return true;
		case "unavailable":
			toast({ variant: "warning", message: affordance.reason || translate("unavailable.tuiOnly") });
			return false;
		case "prompt":
		case "submenu":
			toast({ variant: "warning", message: translate("unavailable.tuiOnly") });
			return false;
	}
}

function findGuiOnlyBuiltin(message: string, commands: AvailableCommand[]): AvailableCommand | undefined {
	const name = /^\/([a-z0-9-]+)/i.exec(message)?.[1]?.toLowerCase();
	if (!name) return undefined;
	const command = commands.find(
		command => command.name.toLowerCase() === name || command.aliases?.some(alias => alias.toLowerCase() === name),
	);
	if (GUI_CONFIRMATION_COMMANDS.has(name) && (!command || command.source === "builtin")) {
		return command ?? { name, source: "builtin", description: name, textModeExecutable: false };
	}
	return command?.source === "builtin" && command.textModeExecutable === false ? command : undefined;
}

export function isGuiOnlyBuiltinCommand(message: string, commands: AvailableCommand[]): boolean {
	return findGuiOnlyBuiltin(message, commands) !== undefined;
}

function runGuiOnlyBuiltin(message: string, commands: AvailableCommand[]): boolean | undefined {
	const wireCommand = findGuiOnlyBuiltin(message, commands);
	if (!wireCommand) return undefined;
	const match = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i.exec(message.trim());
	const name = match?.[1]?.toLowerCase() ?? wireCommand.name.toLowerCase();
	const args = match?.[2]?.trim() || undefined;
	const item = buildCurrentCommandMenu(commands).find(
		candidate =>
			candidate.name.toLowerCase() === wireCommand.name.toLowerCase() ||
			candidate.aliases?.some(alias => alias.toLowerCase() === name),
	);
	if (!item) {
		toast({ variant: "warning", message: translate("unavailable.tuiOnly") });
		return false;
	}
	return runGuiAffordance(item.affordance, args);
}

export function planComposerSubmit(input: {
	message: string;
	images: ImageContent[];
	isStreaming: boolean;
	mode: ComposerSendMode;
	commands: AvailableCommand[];
	rpc?: Pick<TabRpc, "compact" | "followUp" | "prompt" | "steer">;
}): ComposerSubmit {
	const { message, images, isStreaming, mode, commands, rpc = window.omp.rpc } = input;
	const isSlashCommand = message.startsWith("/");
	if (isSlashCommand && isStreaming) {
		const commandName = /^\/([a-z-]+)/i.exec(message)?.[1]?.toLowerCase();
		if (commandName !== undefined && SESSION_REPLACING_COMMANDS[commandName]) {
			toast({ variant: "warning", message: translate("sessionSwitch.busyBlocked") });
			return { kind: "blocked" };
		}
	}
	// Typed `/clear` (no args) takes the native clear_context RPC — forwarding it
	// as prompt text would fall through the TUI-only builtin and reach the model
	// as a literal user message.
	if (isSlashCommand && message.trim() === "/clear") {
		return { kind: "clear" };
	}
	// Manual compaction can spend minutes in provider summarization. Route the
	// exact command through its dedicated RPC so it gets the compact timeout
	// instead of timing out as an 8s prompt while still blocking the RPC queue.
	if (isSlashCommand && message.trim() === "/compact") {
		return { kind: "send", request: () => rpc.compact() };
	}
	const guiHandled = isSlashCommand ? runGuiOnlyBuiltin(message, commands) : undefined;
	if (guiHandled !== undefined) return { kind: guiHandled ? "handled" : "blocked" };
	if (!isSlashCommand && isStreaming) {
		return {
			kind: "send",
			request: () => (mode === "followUp" ? rpc.followUp(message, images) : rpc.steer(message, images)),
		};
	}
	return { kind: "send", request: () => rpc.prompt(message, images) };
}

/** Post-success settle: rehydrate after local-only slash commands. */
export async function settleComposerResponse(
	response: RpcResponse,
	hydrate: () => Promise<void> = hydrateSession,
): Promise<void> {
	if (!response.success) return;
	const data: unknown = response.data;
	if (
		response.command === "compact" ||
		(data !== null && typeof data === "object" && "agentInvoked" in data && data.agentInvoked === false)
	) {
		await hydrate();
	}
}
