/**
 * Composer `!` / `$` / `?` input-mode detection, mirroring the TUI editor
 * (`packages/coding-agent/src/modes/controllers/input-controller.ts`):
 *
 * - `!cmd`  → bash mode (runs locally via `window.omp.rpc.bash`)
 * - `!!cmd` → bash mode, excluded from model context in the TUI (no RPC flag yet)
 * - `$ code`  → python mode (runs via `window.omp.rpc.eval`; `$$ code` = excluded variant)
 * - `? question` → BTW side-question mode
 * - `${...}` template literals and `$HOME`-style variables are NOT python mode
 *
 * Mode is detected from the prefix alone (even with an empty body) so the
 * composer can show the mode badge while the user is still typing; the send
 * path additionally requires a non-empty body.
 */

export type ComposerInputMode = "bash" | "python" | "btw";

export interface ComposerModeParse {
	mode: ComposerInputMode;
	/** Command/code with the sigil stripped and trimmed. May be empty. */
	body: string;
	/** `!!` / `$$` — excluded from model context in the TUI. */
	excluded: boolean;
}

const CHAR_DOLLAR = 36; /* $ */
const CHAR_OPEN_BRACE = 123; /* { */
const CHAR_BANG = 33; /* ! */
const CHAR_QUESTION = 63; /* ? */

// Pasted shell transcripts must not flip into python mode — ported from the TUI.
const SHELL_PROMPT_COMMAND_RE =
	/^(?:\.{0,2}\/|~\/|cd(?:\s|$)|sudo(?:\s|$)|git(?:\s|$)|bun(?:\s|$)|npm(?:\s|$)|pnpm(?:\s|$)|yarn(?:\s|$)|node(?:\s|$)|python\d*(?:\s|$)|cargo(?:\s|$)|go(?:\s|$)|make(?:\s|$)|docker(?:\s|$)|kubectl(?:\s|$))/;
const SHELL_PROMPT_OPERATOR_RE = /(?:^|\s)(?:&&|\|\||\||2>&1|[<>]{1,2})(?:\s|$)/;
const OMP_STATUS_LINE_RE = /^\s*in:\s+\d+\s+out:\s+\d+(?:\s+cache\s+\S+)?\s+t:\s+\S+\s+tok\/s:\s+\S+/m;

function looksLikePastedShellPrompt(code: string): boolean {
	const firstLine = code.split("\n", 1)[0]?.trimStart() ?? "";
	return (
		SHELL_PROMPT_COMMAND_RE.test(firstLine) ||
		SHELL_PROMPT_OPERATOR_RE.test(firstLine) ||
		OMP_STATUS_LINE_RE.test(code)
	);
}

/**
 * Detect the composer input mode from raw draft text, or null for a normal prompt.
 * Bash wins over python, matching the TUI submit order.
 */
export function parseComposerMode(text: string): ComposerModeParse | null {
	const trimmed = text.trimStart();

	if (trimmed.charCodeAt(0) === CHAR_QUESTION) {
		return { mode: "btw", body: trimmed.slice(1).trim(), excluded: false };
	}

	if (trimmed.charCodeAt(0) === CHAR_BANG) {
		const prefixLength = trimmed.charCodeAt(1) === CHAR_BANG ? 2 : 1;
		return { mode: "bash", body: trimmed.slice(prefixLength).trim(), excluded: prefixLength === 2 };
	}

	// Mirrors `pythonCommandPrefixLength` in the TUI input controller: `$`/`$$`
	// (but not `${`) followed by whitespace or end of input.
	if (trimmed.charCodeAt(0) === CHAR_DOLLAR && trimmed.charCodeAt(1) !== CHAR_OPEN_BRACE) {
		const prefixLength = trimmed.charCodeAt(1) === CHAR_DOLLAR ? 2 : 1;
		const next = trimmed.charCodeAt(prefixLength);
		if (Number.isNaN(next) || next === 32 || next === 9 || next === 10 || next === 13) {
			const body = trimmed.slice(prefixLength).trim();
			if (prefixLength === 1 && looksLikePastedShellPrompt(body)) return null;
			return { mode: "python", body, excluded: prefixLength === 2 };
		}
	}
	return null;
}
