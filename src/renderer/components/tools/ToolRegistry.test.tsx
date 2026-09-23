import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useToolsStore } from "../../stores/tools";
import { useUiStore } from "../../stores/ui";
import { GenericRenderer } from "./GenericRenderer";
import { getToolRenderer, getToolSummary } from "./index";
import { ToolCard } from "./ToolCard";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Element = Element;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

/** Canonical names from the sidecar's `tools/builtin-names.ts`, plus the
 *  CustomTools the same session registers (`generate_image`, `tts`). */
const BUILTIN_TOOL_NAMES = [
	"read",
	"bash",
	"edit",
	"ast_grep",
	"ast_edit",
	"ask",
	"debug",
	"eval",
	"github",
	"glob",
	"grep",
	"find",
	"lsp",
	"checkpoint",
	"rewind",
	"context_notes",
	"new_context",
	"security_scan",
	"task",
	"hub",
	"todo",
	"web_search",
	"write",
	"memory_edit",
	"retain",
	"recall",
	"reflect",
	"learn",
	"manage_skill",
	"generate_image",
	"tts",
	// Hidden tools are never user-initiated, but a transcript rebuild can carry one.
	"yield",
	"goal",
	"think",
] as const;

/**
 * Tools whose result the key/value view renders faithfully — a sentence, a
 * saved path, or prose it folds one click down. Landing here is a decision, not
 * an oversight: the coverage test below fails for any other canonical name.
 */
const GENERIC_BY_DESIGN = [
	"ask",
	"checkpoint",
	"context_notes",
	"learn",
	"manage_skill",
	"new_context",
	"rewind",
	"security_scan",
	"think",
	"tts",
	"yield",
] as const;

/**
 * Names with nothing to put in a header: `new_context` takes no arguments, and
 * the hidden scratchpad/control tools are surfaced as their own blocks rather
 * than as tool cards.
 */
const NOT_CARDED = ["new_context", "think", "yield"] as const;

/** Arguments each tool actually ships with, so the header test is not vacuous. */
const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
	ask: { question: "which layout?" },
	ast_edit: { pat: "foo($X)", out: "bar($X)", paths: "src" },
	ast_grep: { pat: "useState(...)" },
	bash: { command: "bun check" },
	checkpoint: { goal: "trace the retry path" },
	context_notes: { text: "notes body" },
	debug: { action: "continue" },
	edit: { edits: [{ path: "src/a.ts", context: "x", patch: "@@ -1 +1 @@" }] },
	eval: { code: "print(1)", language: "python" },
	find: { query: "where retries are counted", path: "packages/coding-agent" },
	generate_image: { subject: "a red fox" },
	github: { action: "pr_view" },
	glob: { pattern: "**/*.ts" },
	goal: { objective: "ship it" },
	grep: { pattern: "xdev" },
	hub: { op: "jobs" },
	learn: { memory: "releases need a clean checkout" },
	lsp: { action: "references", symbol: "buildTool" },
	manage_skill: { action: "update", name: "release" },
	memory_edit: { op: "forget", id: "mem-1" },
	read: { path: "src/app.ts" },
	recall: { query: "release rules" },
	reflect: { query: "how do releases work?" },
	retain: { items: [{ content: "releases need a clean checkout" }] },
	rewind: { report: "the findings" },
	security_scan: { action: "start", plan_id: "p-1" },
	task: { name: "audit" },
	think: { thoughts: "check the wire shape first" },
	todo: { op: "advance", task: "write the card" },
	tts: { text: "hello" },
	web_search: { query: "bun 1.4" },
	write: { path: "src/app.ts", content: "x" },
};

const containers: HTMLElement[] = [];
const roots: Root[] = [];

async function mountCard(toolCallId: string, toolName: string, args: Record<string, unknown>): Promise<void> {
	// Cards read the shared expand-all target on mount, so expand before rendering.
	useUiStore.getState().toggleToolsExpandAll();
	const container = document.createElement("div");
	document.body.appendChild(container);
	containers.push(container);
	const root = createRoot(container);
	roots.push(root);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ToolCard toolCallId={toolCallId} toolName={toolName} args={args} />
			</I18nProvider>,
		);
	});
}

function bodyText(): string {
	return containers.map(container => container.textContent ?? "").join("");
}

/** A `write xd://<tool>` call, as the tools store sees it. */
function deviceCall(toolCallId: string, args: Record<string, unknown>, result: unknown): void {
	useToolsStore.getState().applyEvents([
		{ type: "tool_execution_start", toolCallId, toolName: "write", args },
		{ type: "tool_execution_end", toolCallId, toolName: "write", result, isError: false },
	]);
}

afterEach(async () => {
	for (const root of roots.splice(0)) await act(async () => root.unmount());
	for (const container of containers.splice(0)) container.remove();
	useToolsStore.getState().reset();
	useUiStore.setState({ toolsExpandAll: { expanded: false, seq: 0 } });
});

describe("tool registry coverage", () => {
	it("gives every canonical tool name a rendering decision", () => {
		const undecided = BUILTIN_TOOL_NAMES.filter(
			name => getToolRenderer(name) === GenericRenderer && !(GENERIC_BY_DESIGN as readonly string[]).includes(name),
		);
		expect(undecided).toEqual([]);
	});

	it("never shows a blank collapsed header for a canonical call", () => {
		const blank = BUILTIN_TOOL_NAMES.filter(
			name =>
				!(NOT_CARDED as readonly string[]).includes(name) &&
				getToolSummary(name, SAMPLE_ARGS[name] ?? {}).trim() === "",
		);
		expect(blank).toEqual([]);
	});

	it("states what a find call looked for, not the directory it scoped to", () => {
		expect(getToolSummary("find", { query: "where retries are counted", path: "packages" })).toBe(
			"where retries are counted",
		);
	});

	it("names a live call in its own header", async () => {
		useToolsStore.getState().applyEvents([
			{
				type: "tool_execution_start",
				toolCallId: "hdr",
				toolName: "find",
				args: { query: "where retries are counted" },
			},
		]);
		await mountCard("hdr", "find", { query: "where retries are counted" });

		// The header belongs to the card: a transcript layer that has to pass it
		// in leaves live cards from ChatStream and ReadGroupCard blank.
		const headers = containers.flatMap(container =>
			[...container.querySelectorAll(".omp-tool-summary")].map(node => node.textContent),
		);
		expect(headers).toEqual(["where retries are counted"]);
	});
});

describe("device calls routed through write", () => {
	it("renders the scan outcome instead of a file write", async () => {
		const args = { path: "xd://security_scan", content: '{"action":"start","plan_id":"p-1"}' };
		deviceCall("scan", args, {
			content: [{ type: "text", text: "Security scan scan-9 started as op-3." }],
			details: {
				xdev: {
					tool: "security_scan",
					mode: "execute",
					args: { action: "start", plan_id: "p-1" },
					inner: { action: "start", operation: { scanId: "scan-9", phase: "reviewing", findingCount: 0 } },
				},
			},
		});
		await mountCard("scan", "write", args);

		expect(bodyText()).toContain("Security scan scan-9 started as op-3.");
		expect(bodyText()).toContain("plan_id");
		// The payload is a JSON request, not a file: a line count would be fiction.
		expect(bodyText()).not.toMatch(/\d+ lines?\b/);
	});

	it("renders a plan resolution through the resolve card", async () => {
		const args = { path: "xd://resolve", content: '{"action":"apply"}' };
		deviceCall("res", args, {
			content: [{ type: "text", text: "Applied 3 ops." }],
			details: {
				xdev: {
					tool: "resolve",
					mode: "execute",
					args: { action: "apply" },
					inner: {
						action: "apply",
						label: "ast_edit: rename the flag",
						sourceToolName: "ast_edit",
						sourceResultDetails: { ops: [{}, {}, {}] },
					},
				},
			},
		});
		await mountCard("res", "write", args);

		expect(bodyText()).toContain("Applied");
		expect(bodyText()).toContain("3 ops");
		expect(bodyText()).toContain("rename the flag");
	});

	it("does not claim a verdict for a device call that never returned", async () => {
		useToolsStore.getState().applyEvents([
			{
				type: "tool_execution_start",
				toolCallId: "live",
				toolName: "write",
				args: { path: "xd://grep", content: '{"pattern":"dispatchXdevTool"' },
			},
		]);
		await mountCard("live", "write", { path: "xd://grep", content: '{"pattern":"dispatchXdevTool"' });

		// GrepRenderer reads a missing result as zero matches.
		expect(bodyText()).not.toContain("No matches");
		expect(bodyText()).toContain("dispatchXdevTool");
	});

	it("keeps a real file write on the write card", async () => {
		const args = { path: "src/app.ts", content: "export const a = 1;" };
		deviceCall("file", args, {
			content: [{ type: "text", text: "Successfully wrote 21 bytes to src/app.ts" }],
			details: {},
		});
		await mountCard("file", "write", args);

		expect(bodyText()).toContain("src/app.ts");
		expect(bodyText()).toContain("1 line");
	});
});

describe("device call headers", () => {
	it("reads as the tool that ran instead of the device url", () => {
		expect(
			getToolSummary("write", { path: "xd://lsp", content: '{"action":"references","symbol":"buildTool"}' }),
		).toBe("lsp · references buildTool");
		// A half-streamed payload decodes to nothing but still names the device.
		expect(getToolSummary("write", { path: "xd://security_scan", content: '{"act' })).toBe("security_scan");
	});
});
