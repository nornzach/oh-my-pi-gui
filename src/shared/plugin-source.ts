/**
 * Locates a catalog plugin on GitHub from what the catalog declares. The Plugins
 * page uses this for the plugin's logo (its GitHub owner's avatar) and to preview
 * what it adds; a plugin hosted anywhere else simply gets neither.
 */

import type { RpcMarketplacePluginSource } from "./rpc-types";

export interface PluginRepoLocation {
	owner: string;
	repo: string;
	/** Commit, tag or branch; absent means the default branch. */
	ref?: string;
	/** Directory of the plugin inside the repository; absent means the root. */
	path?: string;
}

const OWNER = "[A-Za-z0-9][A-Za-z0-9-]{0,38}";
const REPO = "[A-Za-z0-9._-]{1,100}";
const OWNER_PATTERN = new RegExp(`^${OWNER}$`);
const REPO_PATTERN = new RegExp(`^${REPO}$`);
const REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const SHORTHAND_PATTERN = new RegExp(`^(${OWNER})/(${REPO})$`);
const GITHUB_URL_PATTERN = new RegExp(
	`^(?:https?://(?:www\\.)?github\\.com/|ssh://git@github\\.com/|git@github\\.com:)(${OWNER})/(${REPO})(?:/.*)?$`,
	"i",
);

export function isValidGithubOwner(owner: string): boolean {
	return OWNER_PATTERN.test(owner);
}

export function isValidGithubRepo(repo: string): boolean {
	return REPO_PATTERN.test(repo) && repo !== "." && repo !== "..";
}

export function isValidGitRef(ref: string): boolean {
	return (
		REF_PATTERN.test(ref) && !ref.split("/").some(segment => segment === "" || segment === "." || segment === "..")
	);
}

/**
 * Normalizes a path inside a repository: strips `./` and trailing slashes, and
 * returns null for anything that could escape the repository.
 */
export function normalizeRepoPath(value: string): string | null {
	const segments = value.replace(/\\/g, "/").split("/");
	const kept: string[] = [];
	for (const segment of segments) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") return null;
		kept.push(segment);
	}
	return kept.join("/");
}

/** `owner/repo` from a GitHub shorthand or URL; null for anything else, including other hosts. */
export function parseGithubRepo(value: string): { owner: string; repo: string } | null {
	const trimmed = value.trim();
	const match = SHORTHAND_PATTERN.exec(trimmed) ?? GITHUB_URL_PATTERN.exec(trimmed);
	if (!match) return null;
	const owner = match[1];
	const repo = match[2].replace(/\.git$/i, "");
	return isValidGithubRepo(repo) ? { owner, repo } : null;
}

function withRef(
	base: { owner: string; repo: string },
	source: { ref?: string; sha?: string },
	path?: string,
): PluginRepoLocation {
	// A pinned commit is exactly what an install would fetch, so it wins over a moving ref.
	const ref = [source.sha, source.ref].find(value => value !== undefined && isValidGitRef(value));
	return { ...base, ...(ref ? { ref } : {}), ...(path ? { path } : {}) };
}

/** Where a plugin's files live on GitHub, or null when that can't be told. */
export function resolvePluginLocation(
	source: RpcMarketplacePluginSource | undefined,
	marketplaceSource: string | undefined,
): PluginRepoLocation | null {
	if (source === undefined) return null;
	if (typeof source === "string") {
		const marketplace = marketplaceSource ? parseGithubRepo(marketplaceSource) : null;
		const path = normalizeRepoPath(source);
		if (!marketplace || path === null) return null;
		return { ...marketplace, ...(path ? { path } : {}) };
	}
	switch (source.source) {
		case "github": {
			const base = parseGithubRepo(source.repo);
			return base && withRef(base, source);
		}
		case "url": {
			const base = parseGithubRepo(source.url);
			return base && withRef(base, source);
		}
		case "git-subdir": {
			const base = parseGithubRepo(source.url);
			const path = normalizeRepoPath(source.path);
			return base && path !== null ? withRef(base, source, path) : null;
		}
		default:
			return null;
	}
}

/** The GitHub account behind a plugin. Its avatar becomes the logo if it's an organization. */
export function pluginLogoOwner(
	plugin: { source?: RpcMarketplacePluginSource; repository?: string; homepage?: string },
	marketplaceSource: string | undefined,
): string | null {
	const location = resolvePluginLocation(plugin.source, marketplaceSource);
	if (location) return location.owner;
	for (const candidate of [plugin.repository, plugin.homepage]) {
		const parsed = candidate ? parseGithubRepo(candidate) : null;
		if (parsed) return parsed.owner;
	}
	return null;
}
