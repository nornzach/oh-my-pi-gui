import { resultDetails } from "./format";

/**
 * `xd://` device writes. With `tools.xdev` on, the sidecar does not send a
 * discoverable tool as its own tool call: the model writes a JSON payload to
 * `xd://<tool>` and the write tool dispatches it, so the transcript carries one
 * `write` call whose result holds the *device* outcome under `details.xdev`.
 * Without this layer every device call — plan resolution, security scans,
 * checkpoints, MCP tools — renders as a file write with a line count.
 */

/** Mirrors `parseXdUrl` in @oh-my-pi/pi-tui/tools/xd-url. */
const XD_URL_PREFIX = "xd://";

/** Dispatch metadata the write tool attaches to a device result. */
export interface XdevDispatch {
	tool: string;
	mode: "help" | "execute";
	/** Validated inner args — absent for `help` and for dispatches that never ran. */
	args?: Record<string, unknown>;
	/** Details returned by the wrapped tool. */
	inner?: unknown;
}

/** Device name of an `xd://` write target, or null for a real file path. */
export function parseXdTarget(path: unknown): string | null {
	if (typeof path !== "string") return null;
	const trimmed = path.trim();
	if (!trimmed.toLowerCase().startsWith(XD_URL_PREFIX)) return null;
	const name = trimmed.slice(XD_URL_PREFIX.length);
	if (name.length === 0) return null;
	if (/[/?#]/.test(name)) return null;
	return name;
}

/** Device name a write call targets, accepting both `path` spellings. */
export function xdevWriteTarget(args: Record<string, unknown>): string | null {
	return parseXdTarget(args.path) ?? parseXdTarget(args.file_path);
}

/** Dispatch metadata of a device result, when the call reached a device. */
export function xdevDispatch(result: unknown): XdevDispatch | undefined {
	const details = resultDetails(result);
	const value = details?.xdev;
	if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.tool !== "string") return undefined;
	const args = record.args;
	const inner = record.inner;
	return {
		tool: record.tool,
		mode: record.mode === "help" ? "help" : "execute",
		args:
			args != null && typeof args === "object" && !Array.isArray(args)
				? (args as Record<string, unknown>)
				: undefined,
		inner: inner == null ? undefined : inner,
	};
}

/**
 * The wrapped tool's own result, rebuilt from the device envelope so the
 * delegated renderer reads it exactly as it would a direct tool call.
 */
export function xdevInnerResult(result: unknown, dispatch: XdevDispatch): unknown {
	if (result == null || typeof result !== "object" || Array.isArray(result)) return null;
	const record = result as Record<string, unknown>;
	return { content: record.content, details: dispatch.inner, isError: record.isError === true };
}

/** Best-effort decode of a streamed device payload; partial JSON yields `{}`. */
export function decodeXdevPayload(content: unknown): Record<string, unknown> {
	if (typeof content !== "string" || content.length === 0) return {};
	try {
		const parsed: unknown = JSON.parse(content);
		if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed))
			return parsed as Record<string, unknown>;
	} catch {
		/* still streaming */
	}
	return {};
}
