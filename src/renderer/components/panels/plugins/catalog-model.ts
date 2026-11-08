/** Pure helpers behind the Plugins page: display names, search and filtering. */

import { pluginLogoOwner } from "../../../../shared/plugin-source";
import type { RpcMarketplaceInfo, RpcMarketplacePluginInfo } from "../../../../shared/rpc-types";

export interface DefaultCatalog {
	source: string;
	/** What the catalog calls itself, which is how a copy added some other way is recognised. */
	name: string;
}

/**
 * Catalogs people get without having to find them. Only these addresses ship with
 * the app: each catalog downloads the first time the Plugins page opens, and a
 * plugin only when someone installs it. Earlier catalogs win when the same plugin
 * is listed twice, so the most trusted ones go first.
 */
export const DEFAULT_CATALOGS: readonly DefaultCatalog[] = [
	{ source: "anthropics/claude-plugins-official", name: "claude-plugins-official" },
	{ source: "anthropics/knowledge-work-plugins", name: "knowledge-work-plugins" },
	{ source: "anthropics/skills", name: "anthropic-agent-skills" },
	{ source: "anthropics/financial-services-plugins", name: "claude-for-financial-services" },
	{ source: "wshobson/agents", name: "claude-code-workflows" },
	{ source: "trailofbits/skills", name: "trailofbits" },
	{ source: "obra/superpowers-marketplace", name: "superpowers-marketplace" },
	{ source: "phuryn/pm-skills", name: "pm-skills" },
];

/** Whether this catalog is already configured, under any address. The agent treats names case-insensitively. */
export function isCatalogListed(catalogs: readonly RpcMarketplaceInfo[], catalog: DefaultCatalog): boolean {
	const name = catalog.name.toLowerCase();
	return catalogs.some(entry => entry.source === catalog.source || entry.name.toLowerCase() === name);
}

export type PluginAction = "install" | "uninstall" | "upgrade";

export interface CatalogPlugin {
	/** `name@marketplace`, the same id the agent uses for an installed plugin. */
	id: string;
	marketplace: string;
	marketplaceSource: string;
	title: string;
	logoOwner: string | null;
	info: RpcMarketplacePluginInfo;
}

export interface CatalogFilter {
	query: string;
	view: "all" | "installed";
	/** Category id, or null for every category. */
	category: string | null;
	/** Catalog name, or null for every catalog. */
	catalog: string | null;
}

/** Words a slug spells in lowercase that nobody writes that way in a title. */
const UPPERCASE_WORDS = new Set([
	"ai",
	"api",
	"aws",
	"cli",
	"crm",
	"gcp",
	"llm",
	"lsp",
	"mcp",
	"pm",
	"pr",
	"sdk",
	"seo",
	"sql",
	"ui",
]);

export function humanizePluginName(name: string): string {
	return name
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map(word =>
			UPPERCASE_WORDS.has(word.toLowerCase()) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1),
		)
		.join(" ");
}

export function toCatalogPlugin(marketplace: RpcMarketplaceInfo, info: RpcMarketplacePluginInfo): CatalogPlugin {
	return {
		id: `${info.name}@${marketplace.name}`,
		marketplace: marketplace.name,
		marketplaceSource: marketplace.source,
		title: info.displayName?.trim() || humanizePluginName(info.name) || info.name,
		logoOwner: pluginLogoOwner(info, marketplace.source),
		info,
	};
}

function matchesQuery(plugin: CatalogPlugin, terms: string[]): boolean {
	if (terms.length === 0) return true;
	const { info } = plugin;
	const haystack = [plugin.title, info.name, info.description, info.author, info.category, ...(info.tags ?? [])]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return terms.every(term => haystack.includes(term));
}

/** Where a plugin is hosted outside its catalog, or null when it lives in the catalog's own repository. */
function remoteOrigin({ source }: RpcMarketplacePluginInfo): string | null {
	if (source === undefined || typeof source === "string") return null;
	switch (source.source) {
		case "github":
			return `github:${source.repo.toLowerCase()}`;
		case "url":
			return `git:${source.url.toLowerCase().replace(/\.git$/, "")}`;
		case "git-subdir":
			return `git:${source.url.toLowerCase().replace(/\.git$/, "")}#${source.path}`;
		case "npm":
			return `npm:${source.package}`;
	}
}

function isSamePlugin(a: RpcMarketplacePluginInfo, b: RpcMarketplacePluginInfo): boolean {
	if (a.name !== b.name) return false;
	const origin = remoteOrigin(a);
	if (origin !== null && origin === remoteOrigin(b)) return true;
	return Boolean(a.description) && a.description === b.description;
}

/**
 * One card per plugin when several catalogs list it: the installed copy, or else
 * the earliest catalog's. A shared name isn't enough, since two catalogs can use
 * the same name for different plugins, and two installed copies both stay so
 * either can be removed.
 */
export function dedupeCatalog(plugins: readonly CatalogPlugin[]): CatalogPlugin[] {
	const kept: CatalogPlugin[] = [];
	for (const plugin of plugins) {
		const twin = kept.findIndex(entry => isSamePlugin(entry.info, plugin.info));
		if (twin === -1) kept.push(plugin);
		else if (plugin.info.installed && !kept[twin].info.installed) kept[twin] = plugin;
		else if (plugin.info.installed) kept.push(plugin);
	}
	return kept;
}

/** Plugins matching every filter, in title order. */
export function filterCatalog(plugins: readonly CatalogPlugin[], filter: CatalogFilter): CatalogPlugin[] {
	const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
	return plugins
		.filter(
			plugin =>
				(filter.view === "all" || plugin.info.installed) &&
				(filter.category === null || plugin.info.category === filter.category) &&
				(filter.catalog === null || plugin.marketplace === filter.catalog) &&
				matchesQuery(plugin, terms),
		)
		.sort((a, b) => a.title.localeCompare(b.title));
}

/** Categories present in the catalog, most plugins first. */
export function catalogCategories(plugins: readonly CatalogPlugin[]): Array<{ id: string; count: number }> {
	const counts = new Map<string, number>();
	for (const { info } of plugins) {
		if (info.category) counts.set(info.category, (counts.get(info.category) ?? 0) + 1);
	}
	return [...counts]
		.map(([id, count]) => ({ id, count }))
		.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/**
 * Removes images from a README, including image links such as badges. The page's
 * content security policy blocks remote images, so they would only show as broken.
 */
export function stripReadmeImages(markdown: string): string {
	return markdown
		.replace(/\[\s*!\[[^\]]*\]\([^)]*\)\s*\]\([^)]*\)/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/<img\b[^>]*>/gi, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
