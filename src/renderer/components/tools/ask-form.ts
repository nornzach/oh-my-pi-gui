/**
 * Reads what the transcript shows from an `ask` call's HTML form: its named
 * fields, their questions and options, and which ones hold passwords. Follows
 * the sidecar's form parser (`pi-tui/html-form/parse.ts`), which the renderer
 * cannot import.
 *
 * The markup is model-written and may still be streaming. DOMParser documents
 * are inert and only text and attributes leave this file, so nothing from the
 * form is ever injected into the page.
 */

export interface AskFormField {
	name: string;
	question: string;
	password: boolean;
	multi: boolean;
	options: string[];
}

const CONTROLS = "input, select, textarea";
const NOT_LABEL_TEXT = `${CONTROLS}, button, script, style, template`;
const UNANSWERED_INPUTS = new Set(["button", "file", "hidden", "image", "reset", "submit"]);

function oneLine(text: string | null | undefined): string {
	return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Text of a label without the controls inside it (a `<select>`'s text is its options). */
function labelElementText(label: Element): string {
	const copy = label.cloneNode(true) as Element;
	for (const excluded of Array.from(copy.querySelectorAll(NOT_LABEL_TEXT))) excluded.remove();
	return oneLine(copy.textContent);
}

function controlLabel(control: Element, root: ParentNode): string {
	const wrapping = control.closest("label");
	const wrapped = wrapping ? labelElementText(wrapping) : "";
	if (wrapped) return wrapped;
	if (control.id) {
		const named = Array.from(root.querySelectorAll("label")).find(label => label.getAttribute("for") === control.id);
		const text = named ? labelElementText(named) : "";
		if (text) return text;
	}
	return oneLine(control.getAttribute("aria-label") ?? control.getAttribute("title"));
}

/** Text right before a control, which is a radio group's question; stops at an earlier field. */
function captionBefore(control: Element, root: ParentNode): string {
	let node: Node | null = control.closest("label") ?? control;
	while (node && node !== root) {
		for (let previous = node.previousSibling; previous; previous = previous.previousSibling) {
			if (previous.nodeType === 1 && (previous as Element).querySelector(CONTROLS)) return "";
			if (previous.nodeType !== 1 && previous.nodeType !== 3) continue;
			const text = oneLine(previous.textContent);
			if (text) return text;
		}
		node = node.parentNode;
	}
	return "";
}

function nameLabel(name: string): string {
	return name.replace(/[_-]+/g, " ");
}

function readFields(html: string): AskFormField[] {
	const document = new DOMParser().parseFromString(html, "text/html");
	const root: ParentNode = document.querySelector("form") ?? document;
	const fields: AskFormField[] = [];
	const groups = new Map<string, AskFormField>();
	for (const control of Array.from(root.querySelectorAll(CONTROLS))) {
		const name = control.getAttribute("name") ?? "";
		if (!name) continue;
		const tag = control.localName;
		if (tag === "select") {
			fields.push({
				name,
				question: controlLabel(control, root) || captionBefore(control, root) || nameLabel(name),
				password: false,
				multi: control.hasAttribute("multiple"),
				options: Array.from(control.querySelectorAll("option")).map(option => oneLine(option.textContent)),
			});
			continue;
		}
		const type = tag === "textarea" ? "textarea" : (control.getAttribute("type") ?? "text").toLowerCase();
		if (UNANSWERED_INPUTS.has(type)) continue;
		if (type === "radio" || type === "checkbox") {
			const label = controlLabel(control, root) || oneLine(control.getAttribute("value")) || name;
			const key = `${type}\0${name}`;
			const group = groups.get(key);
			if (group) {
				group.options.push(label);
				continue;
			}
			const field: AskFormField = {
				name,
				question: captionBefore(control, root),
				password: false,
				multi: type === "checkbox",
				options: [label],
			};
			groups.set(key, field);
			fields.push(field);
			continue;
		}
		fields.push({
			name,
			question: controlLabel(control, root) || nameLabel(name),
			password: type === "password",
			multi: false,
			options: [],
		});
	}
	for (const field of groups.values()) {
		if (field.question) continue;
		const lone = field.options.length === 1 ? field.options[0] : undefined;
		field.question = lone ?? nameLabel(field.name);
	}
	return fields;
}

let lastRead: { html: string; fields: AskFormField[] } | undefined;

/** Fields of a form, remembered for the latest markup: each streamed update reads it from the header and the body. */
export function parseAskForm(html: string): AskFormField[] {
	if (lastRead?.html === html) return lastRead.fields;
	const fields = readFields(html);
	lastRead = { html, fields };
	return fields;
}

/** The first question of an `ask` call's `html` argument, for the collapsed tool header. */
export function askFormSummary(html: unknown): string {
	if (typeof html !== "string" || html.trim() === "") return "";
	return parseAskForm(html)[0]?.question ?? "";
}

/** Whether a field's submitted answer text names this option; a multi-choice answer joins labels with ", ". */
export function answerNamesOption(field: AskFormField, label: string, answer: string): boolean {
	if (!field.multi) return label === answer;
	return `, ${answer}, `.includes(`, ${label}, `);
}
