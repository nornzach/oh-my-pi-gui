import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { AskRenderer } from "./AskRenderer";
import { askFormSummary } from "./ask-form";
import type { ToolRendererProps } from "./ToolCard";

function render(props: ToolRendererProps) {
	return parseHTML(
		renderToStaticMarkup(
			<I18nProvider>
				<AskRenderer {...props} />
			</I18nProvider>,
		),
	).document;
}

// The renderer reads forms with the browser's DOMParser; linkedom stands in for it here.
Object.assign(globalThis, { DOMParser: parseHTML("<html></html>").DOMParser });

const DEPLOY_FORM = `<form>
	<p>Where should this deploy?</p>
	<label><input type="radio" name="target" value="prod"> Production</label>
	<label><input type="radio" name="target" value="stage"> Staging</label>
	<label for="why">Reason</label><textarea id="why" name="why"></textarea>
	<label>API key <input type="password" name="api_key"></label>
	<fieldset><legend>Regions</legend>
		<label><input type="checkbox" name="regions" value="a"> East, primary</label>
		<label><input type="checkbox" name="regions" value="b"> West</label>
		<label><input type="checkbox" name="regions" value="c"> North</label>
	</fieldset>
	<button type="submit">Send</button>
</form>`;

function deployAnswers(overrides: Record<string, string> = {}) {
	return [
		{ name: "target", question: "Where should this deploy?", answer: overrides.target ?? "Staging" },
		{ name: "why", question: "Reason", answer: overrides.why ?? "Line one\nLine two" },
		{ name: "api_key", question: "API key", answer: overrides.api_key ?? "sk-secret-value" },
		{ name: "regions", question: "Regions", answer: overrides.regions ?? "East, primary, North" },
	];
}

const checkedLabels = (section: Element) =>
	Array.from(section.querySelectorAll('svg[aria-label="Selected"]')).map(icon => icon.parentElement?.textContent);

describe("Ask HTML forms", () => {
	it("shows each submitted answer under its question instead of the raw result", () => {
		const document = render({
			args: { html: DEPLOY_FORM },
			result: {
				content: [{ type: "text", text: 'User answers:\n{"target":"stage"}' }],
				details: { answers: deployAnswers() },
			},
		});
		const sections = Array.from(document.querySelectorAll("section"));
		expect(sections).toHaveLength(4);
		expect(sections[0].textContent).toContain("Where should this deploy?");
		expect(checkedLabels(sections[0])).toEqual(["Staging"]);
		expect(sections[1].textContent).toContain("Answered: Line one\nLine two");
		expect(document.documentElement.textContent).not.toContain("User answers");
	});

	it("marks every checked option of a multi-choice answer, including labels with commas", () => {
		const document = render({ args: { html: DEPLOY_FORM }, result: { details: { answers: deployAnswers() } } });
		expect(checkedLabels(document.querySelectorAll("section")[3])).toEqual(["East, primary", "North"]);
	});

	it("masks password answers", () => {
		const document = render({ args: { html: DEPLOY_FORM }, result: { details: { answers: deployAnswers() } } });
		const text = document.documentElement.textContent;
		expect(text).not.toContain("sk-secret-value");
		expect(document.querySelectorAll("section")[2].textContent).toContain(`Answered: ${"•".repeat(12)}`);
	});

	it("lists the form's questions and options while waiting for the user", () => {
		const document = render({ args: { html: DEPLOY_FORM }, result: undefined, isPartial: true });
		const sections = Array.from(document.querySelectorAll("section"));
		expect(sections.map(section => section.querySelector("span")?.textContent)).toEqual([
			"Where should this deploy?",
			"Reason",
			"API key",
			"Regions",
		]);
		expect(sections[0].textContent).toContain("Production");
		expect(document.querySelector('svg[aria-label="Selected"]')).toBeNull();
		expect(document.querySelector('[role="status"]')).not.toBeNull();
	});

	it("reads a form that is still streaming", () => {
		const document = render({
			args: { html: '<form><label>Project name <input name="project"' },
			result: undefined,
			isPartial: true,
		});
		expect(document.querySelector("section")).toBeNull();
		expect(document.documentElement.textContent).toContain("Question");

		const complete = render({
			args: { html: '<form><label>Project name <input name="project"></label>' },
			result: undefined,
		});
		expect(complete.querySelector("section span")?.textContent).toBe("Project name");
	});

	it("keeps the question beside a cancelled form's error", () => {
		const document = render({
			args: { html: DEPLOY_FORM },
			result: "Ask tool was cancelled by the user",
			isError: true,
		});
		expect(document.documentElement.textContent).toContain("Where should this deploy?");
		expect(document.documentElement.textContent).toContain("Ask tool was cancelled by the user");
	});

	it("says when the timeout submitted the form and when a field was left blank", () => {
		const document = render({
			args: { html: DEPLOY_FORM },
			result: { details: { answers: deployAnswers({ why: "" }), timedOut: true } },
		});
		expect(document.querySelectorAll("section")[1].textContent).toContain("No answer");
		expect(document.documentElement.textContent).toContain("submitted after the timeout");
	});

	it("still shows answers when a restored call has lost its form", () => {
		const document = render({ args: {}, result: { details: { answers: deployAnswers({ api_key: "" }) } } });
		expect(document.querySelectorAll("section")[0].textContent).toContain("Answered: Staging");
	});

	it("summarizes a collapsed call by its first question", () => {
		expect(askFormSummary(DEPLOY_FORM)).toBe("Where should this deploy?");
		expect(askFormSummary(undefined)).toBe("");
	});
});

describe("Ask history", () => {
	it("preserves original structured options and selects only the exact answer", () => {
		const document = render({
			args: {
				questions: [
					{
						id: "db",
						question: "Which database?",
						options: [{ label: "SQL" }, { label: "SQLite", description: "Embedded storage" }],
					},
				],
			},
			result: {
				content: [{ type: "text", text: "User selected: SQLite" }],
				details: { question: "Which database?", selectedOptions: ["SQLite"], options: ["SQL", "SQLite"] },
			},
		});
		expect(document.documentElement.textContent).toContain("Which database?");
		expect(document.documentElement.textContent).toContain("Embedded storage");
		const selected = document.querySelectorAll('svg[aria-label="Selected"]');
		expect(selected).toHaveLength(1);
		expect(selected[0].parentElement?.textContent).toBe("SQLiteEmbedded storage");
	});

	it("matches multiple answers to question ids and retains custom input and notes", () => {
		const document = render({
			args: {
				questions: [
					{ id: "one", question: "First?", options: [{ label: "Alpha" }] },
					{ id: "two", question: "Second?", options: [] },
				],
			},
			result: {
				details: {
					results: [
						{
							id: "two",
							question: "Second?",
							selectedOptions: [],
							customInput: "Custom answer",
							note: "Keep this constraint",
						},
						{ id: "one", selectedOptions: ["Alpha"] },
					],
				},
			},
		});
		const sections = document.querySelectorAll("section");
		expect(sections[0].textContent).toContain("Answered: Alpha");
		expect(sections[0].textContent).not.toContain("Custom answer");
		expect(sections[1].textContent).toContain("Custom answer");
		expect(sections[1].textContent).toContain("Keep this constraint");
	});

	it("preserves a legacy question and an error result without inferring a selection", () => {
		const document = render({
			args: { question: "Continue?", options: ["Yes", "No"] },
			result: "No response: cancelled",
			isError: true,
		});
		expect(document.documentElement.textContent).toContain("Continue?");
		expect(document.documentElement.textContent).toContain("No response: cancelled");
		expect(document.querySelector('svg[aria-label="Selected"]')).toBeNull();
	});
});
