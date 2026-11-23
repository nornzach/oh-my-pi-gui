import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { CustomMessageCard, isCustomMessageCardType } from "./CustomMessageCard";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Element = Element;
globals.Node = Node;

function asyncResult(details: unknown, content = "Background job finished.\njobs/batch-1.log"): AgentMessage {
	return { role: "custom", customType: "async-result", content, details, timestamp: 1 };
}

function html(message: AgentMessage): string {
	return renderToStaticMarkup(
		<I18nProvider>
			<CustomMessageCard message={message} />
		</I18nProvider>,
	);
}

describe("async-result card", () => {
	it("renders one row per delivered job", () => {
		const markup = html(
			asyncResult({
				jobs: [
					{ jobId: "batch-1", type: "bash", label: "gui tests", durationMs: 1200 },
					{ jobId: "batch-2", type: "task", label: "audit sweep", durationMs: 4200 },
				],
			}),
		);

		expect(markup).toContain("gui tests");
		expect(markup).toContain("audit sweep");
		expect(markup).toContain("[bash]");
		expect(markup).toContain("[task]");
	});

	it("shows the delivery text instead of inventing a job row when no jobs arrived", () => {
		// The card used to fold the whole `details` object into one fake job, so
		// a malformed batch claimed an `[job]` named "unknown".
		const markup = html(asyncResult({ meta: { source: "background job delivery" } }, "Nothing to report."));

		expect(markup).toContain("Nothing to report.");
		expect(markup).not.toContain("unknown");
		expect(markup).not.toContain("[job]");
	});
});

describe("command output card", () => {
	it("registers command as a dedicated custom message card type", () => {
		expect(isCustomMessageCardType("command")).toBe(true);
	});

	it("renders /mcp list output as a structured table with header, badges, and MCP shortcut", () => {
		const markup = html({
			role: "custom",
			customType: "command",
			content: [
				{
					type: "text",
					text: [
						"mysql3306 | stdio | enabled | /opt/mcp/mysql [user]",
						"docs | http | disabled | https://docs.example.com/mcp [project]",
					].join("\n"),
				},
			],
			details: { command: "/mcp list" },
			timestamp: 2,
		});

		expect(markup).toContain("omp-command-card");
		expect(markup).toContain("/mcp list");
		expect(markup).toContain("2 servers");
		expect(markup).toContain("Manage MCP");
		expect(markup).toContain("mysql3306");
		expect(markup).toContain("stdio");
		expect(markup).toContain("enabled");
		expect(markup).toContain("/opt/mcp/mysql");
		expect(markup).toContain("user");
		expect(markup).toContain("docs");
		expect(markup).toContain("disabled");
		expect(markup).toContain("project");
	});

	it("renders /mcp help and plain command messages cleanly without command metadata", () => {
		const helpMarkup = html({
			role: "custom",
			customType: "command",
			content: "MCP server management\n  /mcp list      List servers\n  /mcp reload    Reload runtime",
			timestamp: 3,
		});

		expect(helpMarkup).toContain("Command output");
		expect(helpMarkup).toContain("/mcp list");
		expect(helpMarkup).toContain("List servers");

		const plainMarkup = html({
			role: "custom",
			customType: "command",
			content: "Enabled models: gpt-5.6",
			timestamp: 4,
		});
		expect(plainMarkup).toContain("Enabled models: gpt-5.6");
	});
});
