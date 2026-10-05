/**
 * Upstream resumes fail closed when a session's saved model cannot be restored:
 * `switch_session`/`open_session` answer `Could not restore model <provider/id>`
 * and a `--session` boot exits with it on stderr (never silently re-routing the
 * transcript to another model). Both surfaces are recovered by re-opening with
 * an explicit model the user agreed to.
 */

/** Selector characters only — Bun's stderr also echoes the template-literal source line. */
const MODEL_RESTORE_RE = /Could not restore model ([\w.:@/+-]+)/;

/** The unavailable model selector, or null when `text` is not a model-restore failure. */
export function parseModelRestoreFailure(text: string | undefined | null): string | null {
	if (!text) return null;
	const match = MODEL_RESTORE_RE.exec(text);
	return match ? match[1].replace(/[.:]+$/, "") : null;
}

/** CLI selector for the configured default-role model (`--model @default`). */
export const DEFAULT_ROLE_MODEL_SELECTOR = "@default";

/** Explicit model binding accepted by `switch_session` / `open_session`. */
export interface SessionModelOverride {
	provider: string;
	modelId: string;
}
