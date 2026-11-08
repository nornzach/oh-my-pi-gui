import { describe, expect, it } from "vitest";
import { isEmptyEffects, pluginConfigFilesToRead, runsLocalCode, summarizePluginEffects } from "./plugin-effects";

function summarize(
	files: string[],
	configs: Record<string, unknown> = {},
	manifest: Record<string, unknown> | null = null,
) {
	return summarizePluginEffects({ files: new Set(files), manifest, configs: new Map(Object.entries(configs)) });
}

describe("summarizePluginEffects", () => {
	it("names skills after their folder and markdown components after their file", () => {
		const effects = summarize([
			"skills/review/SKILL.md",
			"skills/review/notes.md",
			"commands/ship.md",
			"commands/README.md",
			"agents/planner.md",
			"rules/style.md",
		]);
		expect(effects.skills).toEqual(["review"]);
		expect(effects.commands).toEqual(["ship"]);
		expect(effects.agents).toEqual(["planner"]);
		expect(effects.rules).toEqual(["style"]);
	});

	it("tells a remote MCP server from one that runs locally, in nested and flat config", () => {
		const nested = summarize([".mcp.json"], {
			".mcp.json": {
				mcpServers: {
					slack: { url: "https://mcp.slack.com/sse" },
					db: { command: "npx", args: ["-y", "db-server"] },
				},
			},
		});
		expect(nested.mcpServers).toEqual([
			{ name: "slack", kind: "remote", host: "mcp.slack.com" },
			{ name: "db", kind: "local", command: "npx -y db-server" },
		]);
		const flat = summarize(["mcp.json"], { "mcp.json": { notion: { url: "https://mcp.notion.com/mcp" } } });
		expect(flat.mcpServers).toEqual([{ name: "notion", kind: "remote", host: "mcp.notion.com" }]);
	});

	it("lists hook events from config and hook scripts that load without one", () => {
		const effects = summarize(["hooks/hooks.json", "hooks/pre/check.sh"], {
			"hooks/hooks.json": { hooks: { PostToolUse: [], PreToolUse: [] } },
		});
		expect(effects.hooks).toEqual(["PostToolUse", "PreToolUse", "check"]);
	});

	it("follows directories the manifest declares instead of the default ones", () => {
		const effects = summarize(["custom/cmds/go.md", "commands/ignored.md"], {}, { commands: ["./custom/cmds"] });
		expect(effects.commands).toEqual(["go"]);
	});

	it("lets what the catalog declares win over the plugin's manifest", () => {
		const effects = summarizePluginEffects({
			files: new Set(),
			manifest: { lspServers: { old: { command: "old-ls" } } },
			configs: new Map(),
			components: { lspServers: { rust: { command: "rust-analyzer", args: ["--stdio"] } } },
		});
		expect(effects.lspServers).toEqual([{ name: "rust", command: "rust-analyzer --stdio" }]);
	});
});

describe("pluginConfigFilesToRead", () => {
	it("skips config the catalog already spells out inline", () => {
		const files = new Set([".mcp.json", ".lsp.json", "package.json"]);
		expect(pluginConfigFilesToRead(files, null, { mcpServers: { a: { url: "https://x.test" } } })).toEqual([
			".lsp.json",
			"package.json",
		]);
	});

	it("reads the file a manifest points at, not the default", () => {
		const files = new Set(["config/servers.json", ".mcp.json"]);
		expect(pluginConfigFilesToRead(files, { mcpServers: "./config/servers.json" })).toEqual(["config/servers.json"]);
	});
});

describe("runsLocalCode", () => {
	it.each([
		["a local MCP server", summarize([".mcp.json"], { ".mcp.json": { db: { command: "db" } } })],
		["a hook", summarize(["hooks/post/a.sh"])],
		["a custom tool", summarize(["tools/thing.ts"])],
		["a language server", summarize([".lsp.json"], { ".lsp.json": { rust: { command: "rust-analyzer" } } })],
		["an agent extension", summarize(["package.json"], { "package.json": { omp: { extensions: ["./x.ts"] } } })],
	])("flags %s", (_label, effects) => {
		expect(runsLocalCode(effects)).toBe(true);
	});

	it("doesn't flag a plugin that only adds text and a remote connection", () => {
		const effects = summarize(["skills/a/SKILL.md", ".mcp.json"], {
			".mcp.json": { s: { url: "https://x.test/m" } },
		});
		expect(runsLocalCode(effects)).toBe(false);
		expect(isEmptyEffects(effects)).toBe(false);
	});
});
