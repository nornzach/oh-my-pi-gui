import { describe, expect, it } from "vitest";
import {
	classifyTableCell,
	inferCommandTone,
	isMcpCommandOutput,
	parseCommandOutput,
	statusBadgeVariant,
} from "./command-output";

describe("parseCommandOutput", () => {
	it("parses real /mcp list pipe-delimited output with scopes", () => {
		const raw = [
			"mysql3306 | stdio | enabled | /Users/demo/.omp/mcp-mysql [user]",
			"docs | http | enabled | https://mcp.example.com/v1 [project]",
			"legacy | sse | disabled | https://old.example.com/sse [user]",
		].join("\n");

		const parsed = parseCommandOutput(raw);
		expect(parsed).toEqual({
			kind: "mcp-list",
			rows: [
				{
					name: "mysql3306",
					transport: "stdio",
					status: "enabled",
					target: "/Users/demo/.omp/mcp-mysql",
					scope: "user",
				},
				{
					name: "docs",
					transport: "http",
					status: "enabled",
					target: "https://mcp.example.com/v1",
					scope: "project",
				},
				{
					name: "legacy",
					transport: "sse",
					status: "disabled",
					target: "https://old.example.com/sse",
					scope: "user",
				},
			],
		});
		expect(isMcpCommandOutput("/mcp list", raw, parsed)).toBe(true);
	});

	it("parses 3-column mcp rows without target/scope", () => {
		const parsed = parseCommandOutput("mysql | stdio | enabled");
		expect(parsed).toEqual({
			kind: "mcp-list",
			rows: [{ name: "mysql", transport: "stdio", status: "enabled" }],
		});
	});

	it("parses generic multi-row pipe tables", () => {
		const raw = ["alpha | active | 12ms [user]", "beta | idle | 4ms [project]"].join("\n");
		const parsed = parseCommandOutput(raw);
		expect(parsed).toEqual({
			kind: "pipe-table",
			columnCount: 3,
			rows: [
				{ cells: ["alpha", "active", "12ms"], scope: "user" },
				{ cells: ["beta", "idle", "4ms"], scope: "project" },
			],
		});
	});

	it("parses /mcp help usage output", () => {
		const raw = [
			"MCP server management (ACP mode)",
			"  /mcp list                List configured servers",
			"  /mcp enable <name>       Enable a server",
			"  /mcp reload              Reload MCP runtime",
		].join("\n");

		const parsed = parseCommandOutput(raw);
		expect(parsed).toEqual({
			kind: "usage-help",
			title: "MCP server management (ACP mode)",
			rows: [
				{ command: "/mcp list", description: "List configured servers" },
				{ command: "/mcp enable <name>", description: "Enable a server" },
				{ command: "/mcp reload", description: "Reload MCP runtime" },
			],
		});
	});

	it("parses /mcp test bullet lists with success tone", () => {
		const raw = ['Server "mysql" connected (2 tools).', "  - query", "  - list_tables"].join("\n");
		const parsed = parseCommandOutput(raw);
		expect(parsed).toEqual({
			kind: "bullet-list",
			title: 'Server "mysql" connected (2 tools).',
			items: ["query", "list_tables"],
			tone: "success",
		});
	});

	it("parses key-value blocks while ignoring bare URLs", () => {
		const raw = ["Session Summary", "Model: claude-sonnet-4", "Tokens: 12,400"].join("\n");
		expect(parseCommandOutput(raw)).toEqual({
			kind: "kv",
			title: "Session Summary",
			rows: [
				{ key: "Model", value: "claude-sonnet-4" },
				{ key: "Tokens", value: "12,400" },
			],
		});

		const urlLines = "https://example.com/a\nhttps://example.com/b";
		expect(parseCommandOutput(urlLines).kind).toBe("plain");
	});

	it("falls back to plain text with tone inference", () => {
		const ok = parseCommandOutput('Server "mysql" enabled (user config).');
		expect(ok).toEqual({
			kind: "plain",
			text: 'Server "mysql" enabled (user config).',
			singleLine: true,
			tone: "success",
		});

		const err = parseCommandOutput("Failed to list MCP servers: EACCES");
		expect(err.kind).toBe("plain");
		if (err.kind === "plain") expect(err.tone).toBe("error");

		expect(inferCommandTone("No MCP servers configured.")).toBe("warning");
	});

	it("maps status and cell semantic variants cleanly", () => {
		expect(statusBadgeVariant("enabled")).toBe("success");
		expect(statusBadgeVariant("disabled")).toBe("muted");
		expect(statusBadgeVariant("error")).toBe("error");
		expect(statusBadgeVariant("needs-auth")).toBe("warning");
		expect(classifyTableCell("stdio")).toEqual({ kind: "tag" });
		expect(classifyTableCell("enabled")).toEqual({ kind: "status", variant: "success" });
		expect(classifyTableCell("/usr/local/bin/server")).toBeNull();
	});
});
