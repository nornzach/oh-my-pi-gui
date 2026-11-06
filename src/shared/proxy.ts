/**
 * Bun's fetch, which carries every agent request, only speaks http:// and
 * https:// proxies. Any other scheme (socks5://, socks5h://, ...) fails before
 * touching the network; a value with no scheme is read as http://.
 */
export function isUnsupportedProxyUrl(value: string): boolean {
	const scheme = /^\s*([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
	return scheme !== undefined && scheme !== "http" && scheme !== "https";
}

/** A proxy the GUI kept from the agent. Never carries the value, which may hold credentials. */
export type DroppedProxy = { source: "setting" } | { source: "environment"; names: string[] } | { source: "system" };
