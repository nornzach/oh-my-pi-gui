/**
 * Pure parser and semantic classifier for builtin slash-command outputs
 * (`customType: "command"`), turning plain terminal text like `/mcp list`,
 * `/mcp help`, `/mcp test`, and key-value status dumps into structured UI views.
 */

import type { BadgeVariant } from "../common/Badge";

export interface McpListRow {
	name: string;
	transport: string;
	status: string;
	target?: string;
	scope?: string;
}

export interface PipeTableRow {
	cells: string[];
	scope?: string;
}

export interface HelpRow {
	command: string;
	description: string;
}

export interface KvRow {
	key: string;
	value: string;
}

export type CommandTone = "default" | "success" | "warning" | "error";

export type ParsedCommandOutput =
	| { kind: "mcp-list"; rows: McpListRow[] }
	| { kind: "pipe-table"; rows: PipeTableRow[]; columnCount: number }
	| { kind: "usage-help"; title?: string; rows: HelpRow[] }
	| { kind: "kv"; title?: string; rows: KvRow[] }
	| { kind: "bullet-list"; title?: string; items: string[]; tone: CommandTone }
	| { kind: "plain"; text: string; singleLine: boolean; tone: CommandTone };

// Strip ANSI CSI/OSC sequences solely for structural classification; the
// fallback renderer still passes the original text to OutputText.
const ANSI_ESCAPE_RE = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/g;

const MCP_TRANSPORTS = new Set(["stdio", "http", "sse", "streamable-http", "websocket", "ws"]);
const MCP_STATUSES = new Set([
	"enabled",
	"disabled",
	"connected",
	"disconnected",
	"connecting",
	"ready",
	"error",
	"failed",
	"needs-auth",
	"unauthorized",
]);

const SCOPE_SUFFIX_RE = /^(.*?)\s+\[([a-zA-Z0-9_-]{1,24})\]$/;
const HELP_ROW_RE = /^\s{1,6}((?:\/[a-zA-Z0-9:_-]+|--?[a-zA-Z0-9-]+)(?:[^\n]*?))\s{2,}(.+)$/;
const KV_ROW_RE = /^([A-Za-z0-9][A-Za-z0-9 _.-]{0,31}):\s+(.+)$/;
const BULLET_ROW_RE = /^\s*[-•*]\s+(.+)$/;

const ERROR_TONE_RE = /\b(failed|error|not found|invalid|unknown|refused|denied|missing)\b/i;
const WARNING_TONE_RE = /\b(no\s+mcp\s+servers|no\s+resources|no\s+prompts|requires\s+the\s+tui|usage:|warning)\b/i;
const SUCCESS_TONE_RE = /\b(connected|enabled|added|removed|reloaded|reload requested|updated|saved|authorized)\b/i;

function stripAnsi(text: string): string {
	return text.replace(ANSI_ESCAPE_RE, "");
}

function splitTrailingScope(value: string): { value: string; scope?: string } {
	const match = SCOPE_SUFFIX_RE.exec(value.trim());
	if (!match) return { value: value.trim() };
	return { value: (match[1] ?? "").trim(), scope: match[2] };
}

export function inferCommandTone(text: string): CommandTone {
	const clean = stripAnsi(text).trim();
	if (!clean) return "default";
	if (ERROR_TONE_RE.test(clean)) return "error";
	if (WARNING_TONE_RE.test(clean)) return "warning";
	if (SUCCESS_TONE_RE.test(clean)) return "success";
	return "default";
}

export function statusBadgeVariant(status: string): BadgeVariant {
	const lower = status.trim().toLowerCase();
	if (lower === "enabled" || lower === "connected" || lower === "ready" || lower === "ok" || lower === "active") {
		return "success";
	}
	if (lower === "error" || lower === "failed" || lower === "unauthorized") {
		return "error";
	}
	if (lower === "connecting" || lower === "needs-auth" || lower === "warning" || lower === "degraded") {
		return "warning";
	}
	if (lower === "disabled" || lower === "disconnected" || lower === "idle" || lower === "off") {
		return "muted";
	}
	return "default";
}

/** Semantic pill classification for generic pipe-table cells. */
export function classifyTableCell(cell: string): { kind: "status"; variant: BadgeVariant } | { kind: "tag" } | null {
	const lower = cell.trim().toLowerCase();
	if (!lower || lower.length > 24 || lower.includes(" ")) return null;
	if (MCP_STATUSES.has(lower) || lower === "ok" || lower === "active" || lower === "off" || lower === "idle") {
		return { kind: "status", variant: statusBadgeVariant(lower) };
	}
	if (MCP_TRANSPORTS.has(lower) || lower === "user" || lower === "project" || lower === "global") {
		return { kind: "tag" };
	}
	return null;
}

function tryParseMcpList(lines: string[]): McpListRow[] | null {
	const rows: McpListRow[] = [];
	for (const line of lines) {
		const parts = line.split("|").map(part => part.trim());
		if (parts.length < 3 || parts.length > 4) return null;
		const [name, transport, status, rawTarget] = parts;
		if (!name || !transport || !status) return null;
		if (!MCP_TRANSPORTS.has(transport.toLowerCase()) || !MCP_STATUSES.has(status.toLowerCase())) {
			return null;
		}
		if (rawTarget !== undefined) {
			const { value, scope } = splitTrailingScope(rawTarget);
			rows.push({
				name,
				transport: transport.toLowerCase(),
				status: status.toLowerCase(),
				target: value || undefined,
				scope,
			});
		} else {
			rows.push({
				name,
				transport: transport.toLowerCase(),
				status: status.toLowerCase(),
			});
		}
	}
	return rows.length > 0 ? rows : null;
}

function tryParsePipeTable(lines: string[]): { rows: PipeTableRow[]; columnCount: number } | null {
	let columnCount: number | null = null;
	const rows: PipeTableRow[] = [];
	for (const line of lines) {
		if (!line.includes(" | ")) return null;
		const cells = line.split(" | ").map(cell => cell.trim());
		if (cells.length < 2) return null;
		if (columnCount === null) columnCount = cells.length;
		else if (cells.length !== columnCount) return null;
		const last = cells[cells.length - 1] ?? "";
		const { value, scope } = splitTrailingScope(last);
		const normalized = scope ? [...cells.slice(0, -1), value] : cells;
		rows.push({ cells: normalized, scope });
	}
	if (columnCount === null) return null;
	// Avoid misclassifying a single casual "A | B" sentence; require >=2 rows or >=3 columns.
	if (rows.length < 2 && columnCount < 3) return null;
	return { rows, columnCount };
}

function tryParseUsageHelp(lines: string[]): { title?: string; rows: HelpRow[] } | null {
	if (lines.length < 2) return null;
	let startIndex = 0;
	let title: string | undefined;
	if (!HELP_ROW_RE.test(lines[0] ?? "")) {
		title = (lines[0] ?? "").trim();
		startIndex = 1;
	}
	const body = lines.slice(startIndex);
	if (body.length < 2) return null;
	const rows: HelpRow[] = [];
	for (const line of body) {
		const match = HELP_ROW_RE.exec(line);
		if (!match) return null;
		rows.push({ command: (match[1] ?? "").trim(), description: (match[2] ?? "").trim() });
	}
	return { title, rows };
}

function tryParseKv(lines: string[]): { title?: string; rows: KvRow[] } | null {
	if (lines.length < 2) return null;
	let startIndex = 0;
	let title: string | undefined;
	const first = (lines[0] ?? "").trim();
	if (!KV_ROW_RE.test(first) || /^https?:\/\//i.test(first)) {
		title = first;
		startIndex = 1;
	}
	const body = lines.slice(startIndex);
	if (body.length < 2) return null;
	const rows: KvRow[] = [];
	for (const rawLine of body) {
		const line = rawLine.trim();
		if (/^https?:\/\//i.test(line)) return null;
		const match = KV_ROW_RE.exec(line);
		if (!match) return null;
		rows.push({ key: (match[1] ?? "").trim(), value: (match[2] ?? "").trim() });
	}
	return { title, rows };
}

function tryParseBulletList(lines: string[]): { title?: string; items: string[]; tone: CommandTone } | null {
	if (lines.length < 2) return null;
	let startIndex = 0;
	let title: string | undefined;
	if (!BULLET_ROW_RE.test(lines[0] ?? "")) {
		title = (lines[0] ?? "").trim();
		startIndex = 1;
	}
	const body = lines.slice(startIndex);
	if (body.length < 1) return null;
	const items: string[] = [];
	for (const line of body) {
		const match = BULLET_ROW_RE.exec(line);
		if (!match) return null;
		items.push((match[1] ?? "").trim());
	}
	return { title, items, tone: title ? inferCommandTone(title) : "default" };
}

export function parseCommandOutput(rawText: string): ParsedCommandOutput {
	const cleaned = stripAnsi(rawText).replace(/\r\n?/g, "\n").trim();
	if (!cleaned) {
		return { kind: "plain", text: rawText, singleLine: true, tone: "default" };
	}
	const rawLines = cleaned.split("\n");
	const nonEmptyLines = rawLines.filter(line => line.trim().length > 0);

	const mcpRows = tryParseMcpList(nonEmptyLines);
	if (mcpRows) return { kind: "mcp-list", rows: mcpRows };

	const pipeTable = tryParsePipeTable(nonEmptyLines);
	if (pipeTable) return { kind: "pipe-table", ...pipeTable };

	const usageHelp = tryParseUsageHelp(nonEmptyLines);
	if (usageHelp) return { kind: "usage-help", ...usageHelp };

	const bulletList = tryParseBulletList(nonEmptyLines);
	if (bulletList) return { kind: "bullet-list", ...bulletList };

	const kv = tryParseKv(nonEmptyLines);
	if (kv) return { kind: "kv", ...kv };

	return {
		kind: "plain",
		text: rawText.trim(),
		singleLine: nonEmptyLines.length === 1,
		tone: inferCommandTone(cleaned),
	};
}

/** Whether a command output relates to MCP servers (offers quick jump to MCP settings). */
export function isMcpCommandOutput(command: string | undefined, rawText: string, parsed: ParsedCommandOutput): boolean {
	if (parsed.kind === "mcp-list") return true;
	if (command && /^\/mcp(?:\s|$)/i.test(command.trim())) return true;
	return /\bmcp\b/i.test(stripAnsi(rawText));
}
