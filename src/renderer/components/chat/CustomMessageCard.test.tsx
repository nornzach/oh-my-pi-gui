import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { CustomMessageCard } from "./CustomMessageCard";

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
