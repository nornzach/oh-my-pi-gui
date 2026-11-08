import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { PluginCatalog } from "./plugin-catalog";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const PNG_URL = `data:image/png;base64,${PNG.toString("base64")}`;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function accountSearchUrl(...names: string[]): string {
	const query = encodeURIComponent(names.map(name => `user:${name}`).join(" "));
	return `https://api.github.com/search/users?per_page=100&q=${query}`;
}

const ACME_ACCOUNT = accountSearchUrl("acme");
const ACME_LOGO = "https://github.com/acme.png?size=128";
const OTHER_ACCOUNT = accountSearchUrl("other");
const OTHER_LOGO = "https://github.com/other.png?size=128";

function responseFrom(body: BodyInit | null, init: { status?: number; headers?: HeadersInit } = {}): Response {
	return new Response(body, { status: init.status ?? 200, headers: init.headers });
}

/** GitHub spells a name the way its owner does, which isn't how the page asked for it. */
function accountResponse(login: string, type: string, headers?: HeadersInit): Response {
	return responseFrom(JSON.stringify({ incomplete_results: false, items: [{ login, type }] }), { headers });
}

/** GitHub's answers for an organization with a logo. */
const ACME: Record<string, () => Response> = {
	[ACME_ACCOUNT]: () => accountResponse("ACME", "Organization"),
	[ACME_LOGO]: () => responseFrom(PNG),
};

function treeResponse(paths: string[], extra: Record<string, unknown> = {}): Response {
	return responseFrom(JSON.stringify({ tree: paths.map(p => ({ path: p, type: "blob" })), ...extra }));
}

describe("PluginCatalog", () => {
	let dir: string;
	let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
	let now: number;
	let catalog: PluginCatalog;

	function newCatalog(): PluginCatalog {
		return new PluginCatalog({
			fetch: fetchMock,
			logoCacheDir: dir,
			now: () => now,
			sleep: async ms => {
				now += ms;
			},
		});
	}

	/** Answers by URL so tests read as a small fake of GitHub. */
	function serve(routes: Record<string, () => Response>): void {
		fetchMock.mockImplementation(async url => {
			const route = routes[url];
			if (!route) throw new Error(`unexpected request: ${url}`);
			return route();
		});
	}

	beforeEach(async () => {
		dir = await fsp.mkdtemp(path.join(os.tmpdir(), "plugin-catalog-"));
		fetchMock = vi.fn();
		now = Date.now();
		catalog = newCatalog();
	});

	afterEach(async () => {
		await fsp.rm(dir, { recursive: true, force: true });
	});

	describe("logo", () => {
		it("serves a second request from disk, even in a new app run", async () => {
			serve(ACME);
			expect(await catalog.logo("Acme")).toBe(PNG_URL);
			expect(await newCatalog().logo("acme")).toBe(PNG_URL);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("never requests anything for a name that can't be a GitHub account", async () => {
			expect(await catalog.logo("../../etc/passwd")).toBeNull();
			expect(await catalog.logo(42)).toBeNull();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("refuses anything that isn't a raster image, including SVG", async () => {
			serve({
				...ACME,
				[ACME_LOGO]: () => responseFrom("<svg xmlns='http://www.w3.org/2000/svg'><script>x</script></svg>"),
			});
			expect(await catalog.logo("acme")).toBeNull();
			expect(await fsp.readdir(dir)).not.toContain("acme");
		});

		it("refuses an oversized image without keeping it", async () => {
			serve({ ...ACME, [ACME_LOGO]: () => responseFrom(Buffer.concat([PNG, Buffer.alloc(600_000)])) });
			expect(await catalog.logo("acme")).toBeNull();
			expect(await fsp.readdir(dir)).not.toContain("acme");
		});

		it("works when the response doesn't report its final address, as Electron's fetch doesn't", async () => {
			serve(ACME);
			expect(await catalog.logo("acme")).toBe(PNG_URL);
		});

		it("sends no cookies with any request", async () => {
			serve(ACME);
			await catalog.logo("acme");
			expect(fetchMock.mock.calls.map(call => call[1]?.credentials)).toEqual(["omit", "omit"]);
		});

		it("keeps showing an expired logo when the refresh fails, then waits before retrying", async () => {
			serve(ACME);
			await catalog.logo("acme");
			now += 8 * DAY_MS;
			fetchMock.mockRejectedValue(new Error("offline"));
			fetchMock.mockClear();
			expect(await catalog.logo("acme")).toBe(PNG_URL);
			expect(await catalog.logo("acme")).toBe(PNG_URL);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		describe("personal accounts", () => {
			it("never downloads a person's photo, and doesn't ask again in a new app run", async () => {
				serve({ [ACME_ACCOUNT]: () => accountResponse("acme", "User") });
				expect(await catalog.logo("acme")).toBeNull();
				expect(await newCatalog().logo("acme")).toBeNull();
				expect(fetchMock.mock.calls.map(call => call[0])).toEqual([ACME_ACCOUNT]);
			});

			it("deletes a photo an earlier version saved, instead of showing it", async () => {
				await fsp.writeFile(path.join(dir, "acme"), PNG);
				serve({ [ACME_ACCOUNT]: () => accountResponse("acme", "User") });
				expect(await catalog.logo("acme")).toBeNull();
				expect(await fsp.readdir(dir)).not.toContain("acme");
			});

			it("doesn't show a saved photo while the account's type can't be found out", async () => {
				await fsp.writeFile(path.join(dir, "acme"), PNG);
				fetchMock.mockRejectedValue(new Error("offline"));
				expect(await catalog.logo("acme")).toBeNull();
			});

			it("re-checks after a month, picking up an account that became an organization", async () => {
				serve({ [ACME_ACCOUNT]: () => accountResponse("acme", "User") });
				await catalog.logo("acme");
				now += 31 * DAY_MS;
				serve(ACME);
				expect(await catalog.logo("acme")).toBe(PNG_URL);
			});

			it("keeps an organization's logo when the monthly re-check fails", async () => {
				serve(ACME);
				await catalog.logo("acme");
				// A logo downloaded a moment before the re-check is still fresh.
				now += 31 * DAY_MS;
				await fsp.utimes(path.join(dir, "acme"), new Date(now), new Date(now));
				fetchMock.mockRejectedValue(new Error("offline"));
				expect(await catalog.logo("acme")).toBe(PNG_URL);
			});
		});

		describe("when GitHub can't say what an account is", () => {
			it.each([
				["refuses", () => responseFrom("{}", { status: 403 }), 3],
				["has an outage", () => responseFrom("{}", { status: 503 }), 3],
				["is replaced by a network's sign-in page", () => responseFrom("<html>Sign in to Wi-Fi</html>"), 3],
				[
					"says that account can't be searched",
					() => responseFrom('{"message":"Validation Failed"}', { status: 422 }),
					1,
				],
				["answers without a type", () => responseFrom("{}"), 1],
				["leaves the account out of its answer", () => responseFrom('{"incomplete_results":false,"items":[]}'), 1],
			])("shows no logo when it %s, then asks again after a wait and shows it", async (_name, answer, requests) => {
				serve({ [ACME_ACCOUNT]: answer });
				expect(await catalog.logo("acme")).toBeNull();
				expect(await catalog.logo("acme")).toBeNull();
				expect(fetchMock).toHaveBeenCalledTimes(requests);
				now += 11 * MINUTE_MS;
				serve(ACME);
				expect(await catalog.logo("acme")).toBe(PNG_URL);
			});

			it.each([
				["is lost on the way", () => Promise.reject(new Error("connection reset"))],
				["is refused", () => Promise.resolve(responseFrom("{}", { status: 403 }))],
			])("still shows the logo when one request %s", async (_name, failure) => {
				serve(ACME);
				const answer = fetchMock.getMockImplementation();
				fetchMock.mockImplementationOnce(failure);
				fetchMock.mockImplementation(async url => answer?.(url) ?? responseFrom(null));
				expect(await catalog.logo("acme")).toBe(PNG_URL);
			});
		});

		it("asks about a whole screen of cards in one request", async () => {
			// Long enough for both cards to reach the lookup, however busy the machine is.
			const slowToGather = new PluginCatalog({
				fetch: fetchMock,
				logoCacheDir: dir,
				now: () => now,
				sleep: () => new Promise(resolve => setTimeout(resolve, 300)),
			});
			const searches: string[] = [];
			fetchMock.mockImplementation(async url => {
				if (!url.includes("/search/users")) return responseFrom(PNG);
				searches.push(url);
				return responseFrom(
					JSON.stringify({
						items: [
							{ login: "acme", type: "Organization" },
							{ login: "person", type: "User" },
						],
					}),
				);
			});

			const logos = await Promise.all([slowToGather.logo("acme"), slowToGather.logo("person")]);

			expect(logos).toEqual([PNG_URL, null]);
			expect(searches).toHaveLength(1);
		});

		describe("when GitHub's request allowance runs out", () => {
			const spent = (resetInMs: number): Record<string, string> => ({
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(Math.ceil((now + resetInMs) / 1000)),
			});
			const OTHER: Record<string, () => Response> = {
				[OTHER_ACCOUNT]: () => accountResponse("other", "Organization"),
				[OTHER_LOGO]: () => responseFrom(PNG),
			};

			it("holds the next card until the allowance is back, then still shows its logo", async () => {
				const started = now;
				serve({
					...OTHER,
					[ACME_ACCOUNT]: () => accountResponse("acme", "Organization", spent(40_000)),
					[ACME_LOGO]: () => responseFrom(PNG),
				});
				expect(await catalog.logo("acme")).toBe(PNG_URL);
				expect(await catalog.logo("other")).toBe(PNG_URL);
				expect(now - started).toBeGreaterThanOrEqual(40_000);
			});

			it("waits ten minutes at most, whatever GitHub's answer says", async () => {
				const started = now;
				serve({ ...OTHER, [ACME_ACCOUNT]: () => accountResponse("acme", "User", spent(5 * DAY_MS)) });
				await catalog.logo("acme");
				expect(await catalog.logo("other")).toBe(PNG_URL);
				expect(now - started).toBeLessThanOrEqual(11 * MINUTE_MS);
			});

			it("goes by GitHub's clock, so a computer whose clock is wrong waits the right time", async () => {
				const gitHubTime = now - DAY_MS;
				const started = now;
				serve({
					...OTHER,
					[ACME_ACCOUNT]: () =>
						accountResponse("acme", "User", {
							"x-ratelimit-remaining": "0",
							"x-ratelimit-reset": String(Math.ceil((gitHubTime + 40_000) / 1000)),
							date: new Date(gitHubTime).toUTCString(),
						}),
				});
				await catalog.logo("acme");
				expect(await catalog.logo("other")).toBe(PNG_URL);
				expect(now - started).toBeGreaterThanOrEqual(39_000);
				expect(now - started).toBeLessThan(MINUTE_MS);
			});

			it("doesn't wait when the allowance is merely getting low", async () => {
				const started = now;
				serve({
					...OTHER,
					[ACME_ACCOUNT]: () => accountResponse("acme", "User", { "x-ratelimit-remaining": "1" }),
				});
				await catalog.logo("acme");
				await catalog.logo("other");
				expect(now - started).toBeLessThan(MINUTE_MS);
			});
		});
	});

	describe("inspect", () => {
		const TREE = "https://api.github.com/repos/acme/plug/git/trees/HEAD?recursive=1";
		const raw = (file: string): string => `https://raw.githubusercontent.com/acme/plug/HEAD/${file}`;

		it("summarizes a plugin in a subfolder from files inside that folder only", async () => {
			serve({
				[TREE]: () =>
					treeResponse([
						"plugins/one/.claude-plugin/plugin.json",
						"plugins/one/skills/review/SKILL.md",
						"plugins/one/.mcp.json",
						"plugins/one/README.md",
						"plugins/two/skills/other/SKILL.md",
					]),
				[raw("plugins/one/.claude-plugin/plugin.json")]: () => responseFrom(JSON.stringify({ name: "one" })),
				[raw("plugins/one/.mcp.json")]: () =>
					responseFrom(JSON.stringify({ mcpServers: { slack: { url: "https://mcp.slack.com/sse" } } })),
				[raw("plugins/one/README.md")]: () => responseFrom("# One"),
			});
			const result = await catalog.inspect({ owner: "acme", repo: "plug", path: "plugins/one" });
			if (result.status !== "ok") throw new Error(result.status);
			expect(result.effects.skills).toEqual(["review"]);
			expect(result.effects.mcpServers).toEqual([{ name: "slack", kind: "remote", host: "mcp.slack.com" }]);
			expect(result.readme).toBe("# One");
			expect(result.partial).toBe(false);
		});

		it("sends no cookies with any of its requests", async () => {
			serve({
				[TREE]: () => treeResponse(["plugin.json", "README.md"]),
				[raw("plugin.json")]: () => responseFrom("{}"),
				[raw("README.md")]: () => responseFrom("# Plug"),
			});
			await catalog.inspect({ owner: "acme", repo: "plug" });
			expect(fetchMock).toHaveBeenCalledTimes(3);
			for (const [, init] of fetchMock.mock.calls) expect(init?.credentials).toBe("omit");
		});

		it.each([
			[403, "rate-limited"],
			[429, "rate-limited"],
			[404, "not-found"],
			[500, "unavailable"],
		])("reports GitHub answering %i as %s", async (status, expected) => {
			serve({ [TREE]: () => responseFrom("{}", { status }) });
			expect(await catalog.inspect({ owner: "acme", repo: "plug" })).toEqual({ status: expected });
		});

		it("reports a folder that isn't in the repository as not found", async () => {
			serve({ [TREE]: () => treeResponse(["README.md"]) });
			expect(await catalog.inspect({ owner: "acme", repo: "plug", path: "plugins/missing" })).toEqual({
				status: "not-found",
			});
		});

		it("says the preview is partial when the file list is cut off or a config can't be read", async () => {
			serve({
				[TREE]: () => treeResponse([".mcp.json"], { truncated: true }),
				[raw(".mcp.json")]: () => responseFrom("not json"),
			});
			const result = await catalog.inspect({ owner: "acme", repo: "plug" });
			if (result.status !== "ok") throw new Error(result.status);
			expect(result.partial).toBe(true);
		});

		it("cuts a long README short instead of dropping it", async () => {
			serve({
				[TREE]: () => treeResponse(["README.md"]),
				[raw("README.md")]: () => responseFrom("x".repeat(200_000)),
			});
			const result = await catalog.inspect({ owner: "acme", repo: "plug" });
			if (result.status !== "ok") throw new Error(result.status);
			expect(result.readme).toHaveLength(64_000);
		});

		it("doesn't ask GitHub again for a plugin it already read, but does after a failure", async () => {
			serve({ [TREE]: () => treeResponse(["skills/a/SKILL.md"]) });
			await catalog.inspect({ owner: "acme", repo: "plug" });
			await catalog.inspect({ owner: "acme", repo: "plug" });
			expect(fetchMock).toHaveBeenCalledTimes(1);

			fetchMock.mockClear();
			fetchMock.mockRejectedValueOnce(new Error("offline"));
			expect(await catalog.inspect({ owner: "acme", repo: "other" })).toEqual({ status: "unavailable" });
			fetchMock.mockRejectedValueOnce(new Error("offline"));
			await catalog.inspect({ owner: "acme", repo: "other" });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it.each([
			[{ owner: "a/b", repo: "plug" }],
			[{ owner: "acme", repo: ".." }],
			[{ owner: "acme", repo: "plug", ref: "../../x" }],
			[{ owner: "acme", repo: "plug", path: "../up" }],
		])("sends nothing for an unsafe location: %j", async payload => {
			expect(await catalog.inspect(payload)).toEqual({ status: "unavailable" });
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});
});
