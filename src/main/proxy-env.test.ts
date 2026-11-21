/**
 * What an agent spawn ends up with for each place a proxy can come from: a proxy
 * the agent can't use fails every request before it leaves the machine, so it is
 * skipped for the next source and reported, without ever repeating its value.
 */
import { describe, expect, it, vi } from "vitest";
import { LOCAL_NO_PROXY } from "../shared/proxy";
import { dropUnsupportedProxies, type ProxySources, resolveProxyForSpawn } from "./proxy-env";

const SOCKS = "socks5://127.0.0.1:1085";
const HTTP = "http://127.0.0.1:7890";

const resolve = (sources: Partial<ProxySources>) =>
	resolveProxyForSpawn({ pref: undefined, inherited: {}, systemPac: async () => "DIRECT", ...sources });

describe("resolveProxyForSpawn: saved setting", () => {
	it("gives a usable setting to every variable the agent and Bun read", async () => {
		const { env, dropped } = await resolve({ pref: HTTP, systemPac: async () => "PROXY 10.0.0.1:1" });
		expect(env).toEqual({
			PI_PROXY: HTTP,
			HTTPS_PROXY: HTTP,
			HTTP_PROXY: HTTP,
			ALL_PROXY: HTTP,
			https_proxy: HTTP,
			http_proxy: HTTP,
			all_proxy: HTTP,
			NO_PROXY: LOCAL_NO_PROXY,
			no_proxy: LOCAL_NO_PROXY,
		});
		expect(dropped).toEqual([]);
	});

	it("reads a value with no scheme as http", async () => {
		const { env } = await resolve({ pref: " 127.0.0.1:7890 " });
		expect(env.HTTPS_PROXY).toBe(HTTP);
	});

	it("skips a saved SOCKS setting for the system proxy and reports it", async () => {
		const { env, dropped } = await resolve({ pref: SOCKS, systemPac: async () => "PROXY 127.0.0.1:7890" });
		expect(env.HTTPS_PROXY).toBe(HTTP);
		expect(dropped).toEqual([{ source: "setting" }]);
	});

	it("skips a saved SOCKS setting for a usable inherited proxy without asking the system", async () => {
		const systemPac = vi.fn(async () => "PROXY 10.0.0.1:1");
		const { env, dropped } = await resolve({ pref: SOCKS, inherited: { HTTPS_PROXY: HTTP }, systemPac });
		expect(env).toEqual({});
		expect(dropped).toEqual([{ source: "setting" }]);
		expect(systemPac).not.toHaveBeenCalled();
	});

	it("overrides an inherited SOCKS proxy silently, since the setting replaces it", async () => {
		const { dropped } = await resolve({ pref: HTTP, inherited: { HTTPS_PROXY: SOCKS, ALL_PROXY: SOCKS } });
		expect(dropped).toEqual([]);
	});

	it("reports a per-provider SOCKS override the setting doesn't replace", async () => {
		const { dropped } = await resolve({ pref: HTTP, inherited: { PI_PROXY_ANTHROPIC: SOCKS } });
		expect(dropped).toEqual([{ source: "environment", names: ["PI_PROXY_ANTHROPIC"] }]);
	});
});

describe("resolveProxyForSpawn: inherited environment", () => {
	it("reports an inherited SOCKS proxy by name and lets the system proxy take over", async () => {
		const { env, dropped } = await resolve({
			inherited: { HTTPS_PROXY: SOCKS, https_proxy: SOCKS },
			systemPac: async () => "PROXY 127.0.0.1:7890",
		});
		expect(env.HTTPS_PROXY).toBe(HTTP);
		expect(dropped).toEqual([{ source: "environment", names: ["HTTPS_PROXY", "https_proxy"] }]);
	});

	it("reports ALL_PROXY when it was the only choice", async () => {
		const { dropped } = await resolve({ inherited: { ALL_PROXY: SOCKS } });
		expect(dropped).toEqual([{ source: "environment", names: ["ALL_PROXY"] }]);
	});

	it("stays quiet about all_proxy beside a working https_proxy, the shape proxy clients' shell command emits", async () => {
		const systemPac = vi.fn(async () => "PROXY 10.0.0.1:1");
		const { env, dropped } = await resolve({
			inherited: { https_proxy: HTTP, http_proxy: HTTP, all_proxy: SOCKS },
			systemPac,
		});
		expect(env).toEqual({});
		expect(dropped).toEqual([]);
		expect(systemPac).not.toHaveBeenCalled();
	});

	it("still reports a SOCKS HTTP_PROXY beside a working https_proxy", async () => {
		const { dropped } = await resolve({ inherited: { HTTPS_PROXY: HTTP, HTTP_PROXY: SOCKS } });
		expect(dropped).toEqual([{ source: "environment", names: ["HTTP_PROXY"] }]);
	});

	it("names the variable without repeating a value that may hold credentials", async () => {
		const { dropped } = await resolve({ inherited: { HTTPS_PROXY: "socks5://user:hunter2@127.0.0.1:1085" } });
		expect(JSON.stringify(dropped)).not.toContain("hunter2");
	});
});

describe("resolveProxyForSpawn: system proxy", () => {
	it.each([
		["PROXY 127.0.0.1:7890", "http://127.0.0.1:7890", []],
		["HTTPS 127.0.0.1:7890", "https://127.0.0.1:7890", []],
		["SOCKS5 127.0.0.1:1085; PROXY 127.0.0.1:7890; DIRECT", "http://127.0.0.1:7890", []],
		["SOCKS5 127.0.0.1:1085", undefined, [{ source: "system" }]],
		["SOCKS 127.0.0.1:1085; DIRECT", undefined, [{ source: "system" }]],
		["DIRECT", undefined, []],
		["DIRECT; SOCKS5 127.0.0.1:1085", undefined, []],
	])("%s", async (pac, proxy, warnings) => {
		const { env, dropped } = await resolve({ systemPac: async () => pac });
		expect(env.HTTPS_PROXY).toBe(proxy);
		expect(dropped).toEqual(warnings);
	});

	it("treats a failed system lookup as having no proxy", async () => {
		const result = await resolve({ systemPac: () => Promise.reject(new Error("no session")) });
		expect(result).toEqual({ env: {}, dropped: [] });
	});
});

/**
 * NO_PROXY matching as Bun's fetch implements it: exact host, dot-suffix, or
 * IPv4 CIDR. Bun proxies loopback and private hosts too unless a rule names
 * them, and it reads only the environment — the agent's own per-request bypass
 * cannot undo that, so these rules are what keeps a local provider reachable.
 */
function noProxyCovers(rules: string, host: string): boolean {
	const target = host.replace(/^\[|\]$/g, "").toLowerCase();
	const asV4 = (value: string): number | undefined => {
		const parts = value.split(".");
		if (parts.length !== 4) return undefined;
		let bits = 0;
		for (const part of parts) {
			if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return undefined;
			bits = bits * 256 + Number(part);
		}
		return bits;
	};
	const targetV4 = asV4(target);
	for (const raw of rules.split(",")) {
		const rule = raw
			.trim()
			.replace(/^\[|\]$/g, "")
			.toLowerCase();
		if (!rule) continue;
		if (rule === target) return true;
		if (rule.startsWith(".") && (target === rule.slice(1) || target.endsWith(rule))) return true;
		const [network, prefix] = rule.split("/");
		if (prefix === undefined || targetV4 === undefined) continue;
		const networkV4 = asV4(network);
		const width = Number(prefix);
		if (networkV4 === undefined || !Number.isInteger(width) || width < 0 || width > 32) continue;
		const mask = width === 0 ? 0 : (0xffffffff << (32 - width)) >>> 0;
		if ((networkV4 & mask) === (targetV4 & mask)) return true;
	}
	return false;
}

const LOCAL_HOSTS = [
	"127.0.0.1",
	"127.5.6.7",
	"localhost",
	"ollama.localhost",
	"::1",
	"10.1.2.3",
	"172.16.5.4",
	"172.31.9.9",
	"192.168.3.231",
	"169.254.169.254",
	"metadata.google.internal",
];

describe("resolveProxyForSpawn: local traffic stays out of the proxy", () => {
	it("bypasses local and private hosts when the proxy came from the system", async () => {
		const { env } = await resolve({ systemPac: async () => "PROXY 192.168.3.231:909" });
		expect(env.HTTP_PROXY).toBe("http://192.168.3.231:909");
		for (const host of LOCAL_HOSTS) expect(noProxyCovers(env.NO_PROXY ?? "", host), host).toBe(true);
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("bypasses the same hosts for a saved proxy", async () => {
		const { env } = await resolve({ pref: HTTP });
		for (const host of LOCAL_HOSTS) expect(noProxyCovers(env.NO_PROXY ?? "", host), host).toBe(true);
	});

	it("never widens the bypass to public hosts", async () => {
		const { env } = await resolve({ pref: HTTP });
		for (const host of ["api.openai.com", "chatgpt.com", "8.8.8.8", "192.169.1.1", "172.32.0.1", "11.0.0.1"]) {
			expect(noProxyCovers(env.NO_PROXY ?? "", host), host).toBe(false);
		}
	});

	it("keeps the user's own bypass entries beside the local ones", async () => {
		const { env } = await resolve({ pref: HTTP, inherited: { NO_PROXY: "git.corp.example,.internal" } });
		expect(noProxyCovers(env.NO_PROXY ?? "", "git.corp.example")).toBe(true);
		expect(noProxyCovers(env.NO_PROXY ?? "", "build.internal")).toBe(true);
		expect(noProxyCovers(env.NO_PROXY ?? "", "127.0.0.1")).toBe(true);
	});
});

describe("resolveProxyForSpawn: direct connection", () => {
	it("clears every proxy variable, including per-provider ones, without asking the system", async () => {
		const systemPac = vi.fn(async () => "PROXY 192.168.3.231:909");
		const { env, dropped } = await resolve({
			direct: true,
			pref: HTTP,
			inherited: { HTTPS_PROXY: HTTP, PI_PROXY_ANTHROPIC: HTTP },
			systemPac,
		});
		expect(systemPac).not.toHaveBeenCalled();
		for (const name of [
			"PI_PROXY",
			"HTTPS_PROXY",
			"HTTP_PROXY",
			"ALL_PROXY",
			"https_proxy",
			"http_proxy",
			"all_proxy",
		]) {
			expect(env[name], name).toBe("");
		}
		expect(env.PI_PROXY_ANTHROPIC).toBe("");
		expect(dropped).toEqual([]);
	});
});

describe("dropUnsupportedProxies", () => {
	it("removes only proxy variables the agent can't use", () => {
		expect(
			dropUnsupportedProxies({
				HTTPS_PROXY: HTTP,
				HTTP_PROXY: "127.0.0.1:7890",
				ALL_PROXY: SOCKS,
				all_proxy: "SOCKS5://127.0.0.1:1085",
				https_proxy: "socks5h://127.0.0.1:1085",
				PI_PROXY: "ftp://127.0.0.1:21",
				PI_PROXY_ANTHROPIC: SOCKS,
				NO_PROXY: "localhost",
				DOCS_URL: SOCKS,
			}),
		).toEqual({ HTTPS_PROXY: HTTP, HTTP_PROXY: "127.0.0.1:7890", NO_PROXY: "localhost", DOCS_URL: SOCKS });
	});
});
