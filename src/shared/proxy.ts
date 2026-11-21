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

/**
 * Hosts that must never enter a proxy, in the rule forms Bun's NO_PROXY parser
 * accepts (exact host, dot-suffix, IPv4/IPv6 CIDR — all verified against Bun
 * 1.4.4). Bun's native fetch proxies loopback and private addresses too unless a
 * rule names them, and it reads only the environment: the agent's own
 * per-request bypass just declines to set `proxy`, which cannot undo an env
 * proxy. Mirrors the agent's local/metadata bypass set so both layers agree —
 * otherwise a local gateway (ollama, LM Studio, an OpenAI-compatible shim) is
 * sent to the system proxy and every turn dies there.
 */
export const LOCAL_NO_PROXY = [
	"localhost",
	".localhost",
	"127.0.0.0/8",
	"0.0.0.0/8",
	"::1",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"169.254.0.0/16",
	"fe80::/10",
	"fc00::/7",
	"metadata.google.internal",
].join(",");

/** Combine bypass lists, keeping the user's own entries and dropping duplicates. */
export function mergeNoProxy(...lists: (string | undefined)[]): string {
	const seen = new Set<string>();
	const rules: string[] = [];
	for (const list of lists) {
		for (const entry of (list ?? "").split(",")) {
			const rule = entry.trim();
			if (!rule || seen.has(rule.toLowerCase())) continue;
			seen.add(rule.toLowerCase());
			rules.push(rule);
		}
	}
	return rules.join(",");
}
