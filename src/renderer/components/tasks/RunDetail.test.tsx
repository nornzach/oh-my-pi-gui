/**
 * A failed unattended run is read after the fact, so the view that explains it
 * has to keep what the agent actually printed, not only the readable sentence.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskRun } from "../../../shared/scheduler-types";
import { I18nProvider } from "../../lib/i18n";
import { RunDetail } from "./RunDetail";

const failedRun = {
	id: "run-1",
	taskId: "task-1",
	taskRevision: 1,
	trigger: "manual",
	scheduledFor: null,
	createdAt: 0,
	state: "failed",
	blocked: [],
	changedFiles: [],
	verification: { state: "none" },
	review: { state: "none" },
	error: { message: "Exit code 2 — unknown option --foo", kind: "usage" },
} as unknown as TaskRun;

describe("RunDetail", () => {
	it("shows why a run failed in words and keeps the agent's own output under Technical details", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<RunDetail run={failedRun} />
			</I18nProvider>,
		);
		const [sentence, details] = html.split("<details");
		expect(sentence).not.toContain("Exit code");
		expect(details).toContain("Technical details");
		expect(details).toContain("unknown option --foo");
	});
});
