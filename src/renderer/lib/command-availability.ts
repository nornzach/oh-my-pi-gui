import type { SessionKind } from "../../shared/ipc-types";

/**
 * The one availability rule for slash commands, shared by every surface that
 * advertises them (composer completion, ⌘K palette). A command that cannot do
 * anything in the current tab must not be offered — or must be visibly off.
 */

/**
 * Commands dead on chat tabs: mode toggles whose wiring is gated by
 * restrictToolNames (plan/goal/loop/vibe/modes), the session-tree viewer,
 * and tool-spawning commands (task/tan/security). Session/transport commands
 * (/compact, /clear, /model, /export…) still work tool-free and stay available.
 */
export const CHAT_DEAD_COMMANDS: ReadonlySet<string> = new Set([
	"plan",
	"goal",
	"loop",
	"vibe",
	"modes",
	"task",
	"tan",
	"security",
	"tree",
	"git",
]);

/** Whether `name` can run in a tab of this kind. */
export function isCommandAvailable(kind: SessionKind, name: string): boolean {
	return kind !== "chat" || !CHAT_DEAD_COMMANDS.has(name);
}
