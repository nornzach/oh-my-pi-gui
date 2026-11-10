import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ExtensionUIRequest, ExtensionUIResponse, RpcCommand, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { type ExtensionUiStore, useExtensionUiStore } from "../../stores/extension-ui";
import {
	deleteSessionRuntime,
	sessionRuntimeStore,
	setFocusedSessionRuntime,
} from "../../stores/session-runtime-context";
import { createTabRuntime } from "../../stores/tab-runtime";
import { ExtensionDialog } from "./ExtensionDialog";

const { document, window, Event, CustomEvent, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.CustomEvent = CustomEvent;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.focus !== "function") elementPrototype.focus = () => {};

interface TestElement {
	textContent: string | null;
	remove(): void;
	dispatchEvent(event: object): boolean;
}

let container: TestElement;
let root: Root;
let respondExtensionUi: Mock<(response: ExtensionUIResponse) => void>;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(): Promise<void> {
	respondExtensionUi = vi.fn();
	const ompWindow = window as unknown as {
		omp: {
			ui: { respondExtensionUi: typeof respondExtensionUi };
			rpc: { commandForTab: (tabId: string, command: RpcCommand) => Promise<RpcResponse> };
		};
	};
	ompWindow.omp = {
		ui: { respondExtensionUi },
		rpc: {
			commandForTab: vi.fn(
				async (_tabId: string, command: RpcCommand): Promise<RpcResponse> => ({
					type: "response",
					command: command.type,
					success: true,
					data: {},
				}),
			),
		},
	};
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ExtensionDialog />
			</I18nProvider>,
		);
	});
}

function buttonWithText(text: string): TestElement | undefined {
	const buttons = Array.from(document.querySelectorAll("button")) as unknown as TestElement[];
	return buttons.find(button => button.textContent?.includes(text));
}

async function click(element: TestElement): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
	});
	await flush();
}

/** Set a controlled input's value and drive its React onChange contract. */
async function typeInto(element: TestElement, value: string): Promise<void> {
	const record = element as unknown as Record<string, unknown>;
	record.value = value;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey ? (record[propsKey] as { onChange?: (event: object) => void } | undefined) : undefined;
	await act(async () => props?.onChange?.({ target: element, currentTarget: element }));
}

async function submit(form: TestElement): Promise<void> {
	await act(async () => {
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	});
	await flush();
}

const PASTE_TITLE = "Paste the authorization code (or full redirect URL):";

async function push(...requests: ExtensionUIRequest[]): Promise<void> {
	await act(async () => {
		for (const request of requests) useExtensionUiStore.getState().pushRequest(request);
	});
	await flush();
}

/** What `login` sends for a paste-code provider: the browser step, then its paste prompt. */
async function showSignIn(): Promise<void> {
	await push(
		{
			type: "extension_ui_request",
			id: "url-1",
			method: "open_url",
			url: "https://claude.ai/oauth/authorize?state=s",
		},
		{
			type: "extension_ui_request",
			id: "code-1",
			method: "input",
			title: PASTE_TITLE,
			authCodeFor: "url-1",
		},
	);
}

const KEY_TITLE = "Paste your DeepSeek API key";

/** What `login` sends for an API-key provider: the page with the key, then the prompt the sign-in waits on. */
async function showKeySignIn(fields: { allowEmpty?: boolean } = {}): Promise<void> {
	await push(
		{
			type: "extension_ui_request",
			id: "url-1",
			method: "open_url",
			url: "https://platform.deepseek.com/api_keys",
			instructions: "Create or copy your API key from the DeepSeek dashboard",
		},
		{
			type: "extension_ui_request",
			id: "key-1",
			method: "input",
			title: KEY_TITLE,
			placeholder: "sk-...",
			loginPromptFor: "url-1",
			...fields,
		},
	);
}

function showAskDialog(): void {
	useExtensionUiStore.getState().pushRequest({
		type: "extension_ui_request",
		id: "ask-1",
		method: "askDialog",
		questions: [
			{
				id: "deploy",
				question: "Where should this deploy?",
				options: [
					{ label: "Staging", description: "Safe environment" },
					{ label: "Production", preview: "Deploys to **all users**." },
				],
				recommended: 0,
			},
		],
	});
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	useExtensionUiStore.getState().clearAll();
	deleteSessionRuntime("tab-bg");
	deleteSessionRuntime("tab-fg");
	setFocusedSessionRuntime(null);
	vi.restoreAllMocks();
	document.title = "";
});

describe("ExtensionDialog select", () => {
	it("shows positional descriptions without including them in the returned choice", async () => {
		await mount();
		await act(async () => {
			useExtensionUiStore.getState().pushRequest({
				type: "extension_ui_request",
				id: "select-details",
				method: "select",
				title: "Choose a connection",
				options: ["API key", "Subscription"],
				optionDetails: [{}, { description: "Sign in with your existing subscription" }],
			});
		});
		const apiKey = buttonWithText("API key");
		const subscription = buttonWithText("Subscription");
		if (!apiKey || !subscription) throw new Error("missing connection choices");
		expect(apiKey.textContent).not.toContain("existing subscription");
		expect(subscription.textContent).toContain("Sign in with your existing subscription");
		await click(subscription);
		expect(respondExtensionUi).toHaveBeenCalledWith({
			type: "extension_ui_response",
			id: "select-details",
			value: "Subscription",
		});
	});
});

describe("ExtensionDialog askDialog", () => {
	it("returns the wire submit discriminator and renders the selected option preview", async () => {
		await mount();
		await act(async () => showAskDialog());

		const production = buttonWithText("Production");
		if (!production) throw new Error("missing Production option");
		await click(production);
		expect(document.body.textContent).toContain("Deploys to all users.");

		const form = document.querySelector("form") as unknown as TestElement | null;
		if (!form) throw new Error("missing ask form");
		await act(async () => {
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		});
		await flush();

		expect(respondExtensionUi).toHaveBeenCalledWith({
			type: "extension_ui_response",
			id: "ask-1",
			askDialog: {
				kind: "submit",
				results: [
					{
						id: "deploy",
						question: "Where should this deploy?",
						options: ["Staging", "Production"],
						multi: false,
						selectedOptions: ["Production"],
					},
				],
			},
		});
	});

	it("returns the chat redirect discriminator", async () => {
		await mount();
		await act(async () => showAskDialog());

		const chat = buttonWithText("Chat about this");
		if (!chat) throw new Error("missing Chat about this button");
		await click(chat);

		expect(respondExtensionUi).toHaveBeenCalledWith({
			type: "extension_ui_response",
			id: "ask-1",
			askDialog: { kind: "chat" },
		});
	});
});

describe("ExtensionDialog non-dialog mutations", () => {
	it("hides transient extension status and renders widget ANSI without control codes", async () => {
		await mount();
		await act(async () => {
			useExtensionUiStore.getState().pushRequest({
				type: "extension_ui_request",
				id: "status-ansi",
				method: "setStatus",
				statusKey: "mode",
				statusText: "\x1b[38;5;39m●\x1b[39m ponytail: \x1b[1mFULL\x1b[0m",
			});
			useExtensionUiStore.getState().pushRequest({
				type: "extension_ui_request",
				id: "widget-ansi",
				method: "setWidget",
				widgetKey: "progress",
				widgetLines: ["\x1b[32mPASS\x1b[0m"],
			});
		});

		expect(document.body.textContent).not.toContain("ponytail");
		expect(document.body.textContent).toContain("PASS");
		expect(document.body.textContent).not.toContain("[32m");
	});

	it("fills the composer for set_editor_text and applies extension window titles", async () => {
		await mount();
		let editorDetail: { text?: string; images?: unknown[]; prepend?: boolean } | undefined;
		window.addEventListener(
			"omp:fill-composer",
			(event: Event) => {
				editorDetail = (event as CustomEvent<{ text?: string; images?: unknown[]; prepend?: boolean }>).detail;
			},
			{ once: true },
		);

		await act(async () => {
			useExtensionUiStore.getState().pushRequest({
				type: "extension_ui_request",
				id: "editor-1",
				method: "set_editor_text",
				text: "restored draft",
				images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
				prepend: true,
			});
			useExtensionUiStore.getState().pushRequest({
				type: "extension_ui_request",
				id: "title-1",
				method: "setTitle",
				title: "Extension task",
			});
		});
		await flush();

		expect(editorDetail).toEqual({
			text: "restored draft",
			images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
			prepend: true,
		});
		expect(document.title).toBe("Extension task");
		expect(useExtensionUiStore.getState().pendingRequests).toEqual([]);
	});
});

describe("ExtensionDialog cross-tab requests", () => {
	it("surfaces a blocking request queued in a background tab and clears it from the owning store", async () => {
		createTabRuntime("tab-fg");
		createTabRuntime("tab-bg");
		setFocusedSessionRuntime("tab-fg");
		const bgStore = sessionRuntimeStore<ExtensionUiStore>("tab-bg", "extensionUi");
		if (!bgStore) throw new Error("missing background extensionUi store");

		await mount();
		await act(async () => {
			bgStore.getState().pushRequest({
				type: "extension_ui_request",
				id: "bg-confirm",
				method: "confirm",
				title: "Background approval",
				message: "Allow the background agent?",
			});
		});
		await flush();

		// The dialog renders globally even though the request lives in the
		// non-focused tab's store.
		expect(document.body.textContent).toContain("Allow the background agent?");
		const approve = buttonWithText("Approve");
		if (!approve) throw new Error("missing Approve button");
		await click(approve);

		expect(respondExtensionUi).toHaveBeenCalledWith({
			type: "extension_ui_response",
			id: "bg-confirm",
			confirmed: true,
		});
		expect(bgStore.getState().pendingRequests).toEqual([]);
	});

	it("does not fill the focused composer for a background tab's set_editor_text", async () => {
		createTabRuntime("tab-fg");
		createTabRuntime("tab-bg");
		setFocusedSessionRuntime("tab-fg");
		const bgStore = sessionRuntimeStore<ExtensionUiStore>("tab-bg", "extensionUi");
		if (!bgStore) throw new Error("missing background extensionUi store");

		await mount();
		let editorFired = false;
		window.addEventListener("omp:fill-composer", () => {
			editorFired = true;
		});

		await act(async () => {
			bgStore.getState().pushRequest({
				type: "extension_ui_request",
				id: "bg-editor",
				method: "set_editor_text",
				text: "dropped prompt from background tab",
			});
		});
		await flush();

		// The request stays queued in its own tab until that tab is focused —
		// consuming it here would drop the text into the wrong composer.
		expect(editorFired).toBe(false);
		expect(bgStore.getState().pendingRequests.map(request => request.id)).toEqual(["bg-editor"]);
	});
});

describe("ExtensionDialog sign-in browser step", () => {
	it("takes a pasted code inside the browser dialog instead of a second dialog after it", async () => {
		await mount();
		await showSignIn();

		// One dialog, nothing to confirm: the paste prompt is not queued behind a Done.
		expect(document.body.textContent).not.toContain(PASTE_TITLE);
		expect(buttonWithText("Done")).toBeUndefined();

		const toggle = buttonWithText("Paste the code");
		if (!toggle) throw new Error("paste toggle missing");
		await click(toggle);
		await typeInto(document.querySelector("input") as unknown as TestElement, " pasted-code#s ");
		await submit(document.querySelector("form") as unknown as TestElement);

		expect(respondExtensionUi.mock.calls).toEqual([
			[{ type: "extension_ui_response", id: "code-1", value: "pasted-code#s" }],
		]);
		expect(buttonWithText("Checking")).toBeDefined();

		// The agent could not use the value and asks again in the same dialog.
		await push({
			type: "extension_ui_request",
			id: "code-2",
			method: "input",
			title: PASTE_TITLE,
			authCodeFor: "url-1",
		});
		expect(document.body.textContent).toContain("That code didn't work");
		expect(buttonWithText("Use Code")).toBeDefined();

		// Signed in: the agent closes both requests and the dialog goes away.
		await push(
			{ type: "extension_ui_request", id: "close-1", method: "cancel", targetId: "code-2" },
			{ type: "extension_ui_request", id: "close-2", method: "cancel", targetId: "url-1" },
		);
		expect(document.querySelector("form")).toBeNull();
		expect(buttonWithText("Open in Browser")).toBeUndefined();
	});

	it("cancels the paste prompt with the browser step so it never opens on its own", async () => {
		await mount();
		await showSignIn();

		const cancel = buttonWithText("Cancel");
		if (!cancel) throw new Error("cancel button missing");
		await click(cancel);

		expect(
			respondExtensionUi.mock.calls.map(([response]) => response).sort((a, b) => a.id.localeCompare(b.id)),
		).toEqual([
			{ type: "extension_ui_response", id: "code-1", cancelled: true },
			{ type: "extension_ui_response", id: "url-1", cancelled: true },
		]);
		expect(document.body.textContent).not.toContain(PASTE_TITLE);
	});

	it("shows a paste prompt on its own once its browser dialog is gone", async () => {
		await mount();
		await push({
			type: "extension_ui_request",
			id: "code-1",
			method: "input",
			title: PASTE_TITLE,
			authCodeFor: "url-gone",
		});

		expect(document.body.textContent).toContain(PASTE_TITLE);
	});

	it("asks for an API key inside the sign-in dialog instead of queueing it behind that dialog", async () => {
		await mount();
		await showKeySignIn();

		// Open from the start and masked: nothing in the browser can finish this sign-in.
		expect(document.body.textContent).toContain(KEY_TITLE);
		expect(document.querySelector("input")?.getAttribute("type")).toBe("password");
		await click(document.querySelector('button[aria-label="Reveal value"]') as unknown as TestElement);
		expect(document.querySelector("input")?.getAttribute("type")).toBe("text");

		await typeInto(document.querySelector("input") as unknown as TestElement, " sk-test ");
		await submit(document.querySelector("form") as unknown as TestElement);

		expect(respondExtensionUi.mock.calls).toEqual([
			[{ type: "extension_ui_response", id: "key-1", value: "sk-test" }],
		]);
		expect(buttonWithText("Checking")).toBeDefined();

		// Signed in: the agent closes the browser step and the dialog goes away.
		await push({ type: "extension_ui_request", id: "close-1", method: "cancel", targetId: "url-1" });
		expect(document.querySelector("form")).toBeNull();
	});

	it("moves on to the sign-in's next question without calling the last answer wrong", async () => {
		await mount();
		await showKeySignIn();
		await typeInto(document.querySelector("input") as unknown as TestElement, "token");
		await submit(document.querySelector("form") as unknown as TestElement);

		await push({
			type: "extension_ui_request",
			id: "account-1",
			method: "input",
			title: "Enter your Cloudflare account ID",
			loginPromptFor: "url-1",
		});

		expect(document.body.textContent).toContain("Enter your Cloudflare account ID");
		expect(document.body.textContent).not.toContain("didn't work");
		expect(buttonWithText("Continue")).toBeDefined();
	});

	it.each([
		["refuses a blank key", false, []],
		["sends a blank answer the sign-in allows", true, [[{ type: "extension_ui_response", id: "key-1", value: "" }]]],
	])("%s", async (_name, allowEmpty, expected) => {
		await mount();
		await showKeySignIn({ allowEmpty });

		await submit(document.querySelector("form") as unknown as TestElement);

		expect(respondExtensionUi.mock.calls).toEqual(expected);
	});
});
