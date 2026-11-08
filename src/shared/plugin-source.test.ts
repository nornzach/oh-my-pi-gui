import { describe, expect, it } from "vitest";
import { normalizeRepoPath, parseGithubRepo, pluginLogoOwner, resolvePluginLocation } from "./plugin-source";

const MARKETPLACE = "anthropics/claude-plugins-official";

describe("resolvePluginLocation", () => {
	it("reads a path entry from the catalog's own repository", () => {
		expect(resolvePluginLocation("./plugins/foo", MARKETPLACE)).toEqual({
			owner: "anthropics",
			repo: "claude-plugins-official",
			path: "plugins/foo",
		});
	});

	it("can't locate a path entry when the catalog itself isn't on GitHub", () => {
		expect(resolvePluginLocation("./plugins/foo", "https://gitlab.com/a/b.git")).toBeNull();
	});

	it("strips .git from a url source and prefers the pinned commit over a moving ref", () => {
		expect(
			resolvePluginLocation(
				{ source: "url", url: "https://github.com/slackapi/slack-mcp-plugin.git", ref: "main", sha: "abc123" },
				MARKETPLACE,
			),
		).toEqual({ owner: "slackapi", repo: "slack-mcp-plugin", ref: "abc123" });
	});

	it("keeps the subfolder of a git-subdir source", () => {
		expect(
			resolvePluginLocation(
				{ source: "git-subdir", url: "git@github.com:acme/mono.git", path: "./tools/plug/" },
				MARKETPLACE,
			),
		).toEqual({ owner: "acme", repo: "mono", path: "tools/plug" });
	});

	it("refuses a path that climbs out of the repository", () => {
		expect(resolvePluginLocation("../../secrets", MARKETPLACE)).toBeNull();
		expect(
			resolvePluginLocation({ source: "git-subdir", url: "acme/mono", path: "a/../../b" }, MARKETPLACE),
		).toBeNull();
	});

	it("gives up on sources that aren't GitHub", () => {
		expect(resolvePluginLocation({ source: "url", url: "https://gitlab.com/a/b.git" }, MARKETPLACE)).toBeNull();
		expect(resolvePluginLocation({ source: "npm", package: "foo" }, MARKETPLACE)).toBeNull();
	});
});

describe("parseGithubRepo", () => {
	it.each([
		["acme/plug", "acme", "plug"],
		["https://github.com/acme/plug/tree/main/sub", "acme", "plug"],
		["ssh://git@github.com/acme/plug.git", "acme", "plug"],
		["git@github.com:acme/plug.git", "acme", "plug"],
	])("reads %s", (input, owner, repo) => {
		expect(parseGithubRepo(input)).toEqual({ owner, repo });
	});

	it("doesn't take a lookalike host for GitHub", () => {
		expect(parseGithubRepo("https://github.com.evil.example/acme/plug")).toBeNull();
	});
});

describe("normalizeRepoPath", () => {
	it("treats the root spelled any way as empty", () => {
		expect(normalizeRepoPath("./")).toBe("");
	});
});

describe("pluginLogoOwner", () => {
	it("falls back to the repository link when the source can't be located", () => {
		expect(
			pluginLogoOwner(
				{ source: { source: "npm", package: "foo" }, repository: "https://github.com/acme/foo" },
				MARKETPLACE,
			),
		).toBe("acme");
	});

	it("has no logo for a plugin with no GitHub link at all", () => {
		expect(pluginLogoOwner({ homepage: "https://example.com" }, "https://gitlab.com/a/b.git")).toBeNull();
	});
});
