import { describe, expect, it } from "vitest";
import type { RpcMarketplacePluginInfo } from "../../../../shared/rpc-types";
import {
	catalogCategories,
	dedupeCatalog,
	filterCatalog,
	humanizePluginName,
	isCatalogListed,
	stripReadmeImages,
	toCatalogPlugin,
} from "./catalog-model";

const MARKETPLACE = { name: "official", source: "anthropics/claude-plugins-official" };

function plugin(info: Partial<RpcMarketplacePluginInfo> & { name: string }) {
	return toCatalogPlugin(MARKETPLACE, { installed: false, ...info });
}

const PLUGINS = [
	plugin({ name: "slack", description: "Read channels", category: "productivity", tags: ["chat"] }),
	plugin({ name: "datadog-logs", displayName: "Datadog", category: "monitoring", installed: true }),
	plugin({ name: "notion", description: "Search pages", category: "productivity", author: "Makenotion" }),
];

const titles = (query: string, view: "all" | "installed" = "all", category: string | null = null): string[] =>
	filterCatalog(PLUGINS, { query, view, category, catalog: null }).map(entry => entry.title);

describe("filterCatalog", () => {
	it("sorts by what people see and searches every field shown on a card", () => {
		expect(titles("")).toEqual(["Datadog", "Notion", "Slack"]);
		expect(titles("channels")).toEqual(["Slack"]);
		expect(titles("MAKENOTION")).toEqual(["Notion"]);
		expect(titles("chat")).toEqual(["Slack"]);
	});

	it("needs every word to match, not just one", () => {
		expect(titles("search pages")).toEqual(["Notion"]);
		expect(titles("search channels")).toEqual([]);
	});

	it("combines the installed view and the category with the search", () => {
		expect(titles("", "installed")).toEqual(["Datadog"]);
		expect(titles("", "all", "productivity")).toEqual(["Notion", "Slack"]);
		expect(titles("", "installed", "productivity")).toEqual([]);
	});
});

describe("dedupeCatalog", () => {
	const FIRST = { name: "first", source: "a/first" };
	const SECOND = { name: "second", source: "b/second" };
	const from = (marketplace: typeof FIRST, info: Partial<RpcMarketplacePluginInfo>) =>
		toCatalogPlugin(marketplace, { name: "apollo", installed: false, ...info });
	const ids = (...plugins: ReturnType<typeof from>[]) => dedupeCatalog(plugins).map(entry => entry.id);

	it("shows the earlier catalog's copy of a plugin hosted in the same place, whatever commit each pins", () => {
		const url = "https://github.com/apolloio/plugin";
		expect(
			ids(
				from(FIRST, { source: { source: "url", url: `${url}.git`, sha: "aaa" } }),
				from(SECOND, { source: { source: "url", url, sha: "bbb" } }),
			),
		).toEqual(["apollo@first"]);
	});

	it("treats a matching description as the same plugin when one catalog carries its own copy", () => {
		expect(
			ids(
				from(FIRST, { description: "Prospect leads", source: { source: "url", url: "https://github.com/a/b" } }),
				from(SECOND, { description: "Prospect leads", source: "./partner-built/apollo" }),
			),
		).toEqual(["apollo@first"]);
	});

	it("keeps different plugins that happen to share a name", () => {
		expect(
			ids(
				from(FIRST, { name: "data", description: "Airflow pipelines", source: "./data" }),
				from(SECOND, { name: "data", description: "Write SQL", source: "./data" }),
			),
		).toEqual(["data@first", "data@second"]);
	});

	it("shows the installed copy, and both when both are installed, so either can be removed", () => {
		const url = "https://github.com/a/b";
		const entry = { source: { source: "url", url } as const };
		expect(ids(from(FIRST, entry), from(SECOND, { ...entry, installed: true }))).toEqual(["apollo@second"]);
		expect(ids(from(FIRST, { ...entry, installed: true }), from(SECOND, { ...entry, installed: true }))).toEqual([
			"apollo@first",
			"apollo@second",
		]);
	});
});

describe("isCatalogListed", () => {
	const DEFAULT = { source: "trailofbits/skills", name: "trailofbits" };

	it("recognises a catalog added under another address or spelled in another case", () => {
		expect(isCatalogListed([{ name: "trailofbits", source: "https://github.com/trailofbits/skills" }], DEFAULT)).toBe(
			true,
		);
		expect(isCatalogListed([{ name: "TrailOfBits", source: "/tmp/copy" }], DEFAULT)).toBe(true);
		expect(isCatalogListed([{ name: "mine", source: "me/plugins" }], DEFAULT)).toBe(false);
	});
});

describe("catalogCategories", () => {
	it("orders by size and leaves out plugins with no category", () => {
		expect(catalogCategories([...PLUGINS, plugin({ name: "bare" })])).toEqual([
			{ id: "productivity", count: 2 },
			{ id: "monitoring", count: 1 },
		]);
	});
});

describe("toCatalogPlugin", () => {
	it("prefers the catalog's display name and uses the agent's id for the plugin", () => {
		const entry = plugin({ name: "datadog-logs", displayName: "Datadog" });
		expect(entry.title).toBe("Datadog");
		expect(entry.id).toBe("datadog-logs@official");
		expect(humanizePluginName("code_review-tool")).toBe("Code Review Tool");
		expect(humanizePluginName("agent-sdk-dev")).toBe("Agent SDK Dev");
		// Only whole words: "aiven" and "apify" stay names.
		expect(humanizePluginName("aiven-apify")).toBe("Aiven Apify");
	});
});

describe("stripReadmeImages", () => {
	it("removes badges, images and HTML images but leaves ordinary links", () => {
		const readme = [
			"# Title",
			"[![CI](https://x.test/b.svg)](https://x.test/ci)",
			"![shot](./a.png)",
			'<img src="https://x.test/a.png" width="10">',
			"See [the docs](https://x.test/docs).",
		].join("\n");
		expect(stripReadmeImages(readme)).toBe("# Title\n\nSee [the docs](https://x.test/docs).");
	});
});
