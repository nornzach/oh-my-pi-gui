import { parseHTML } from "linkedom";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isApprovalRequest } from "../../../shared/approval-prompt";
import { OVERLAY_EXIT_MS } from "../../hooks/use-overlay-presence";
import { I18nProvider } from "../../lib/i18n";
import { ApprovalDialog } from "../dialogs/ApprovalDialog";
import { DIALOG_OVERLAY_Z } from "./dialog-layer";
import { Modal } from "./Modal";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

let activeElement: HTMLElement | null = null;
Object.defineProperty(document, "activeElement", {
	configurable: true,
	get: () => activeElement,
});

let container: HTMLElement;
let root: Root;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container as unknown as Element);
	await render(element);
}

async function render(element: ReactElement): Promise<void> {
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
	await flush();
}

async function pressEscape({ isComposing = false, keyCode = 27 } = {}): Promise<void> {
	const event = new Event("keydown", { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		isComposing: { value: isComposing },
		key: { value: "Escape" },
		keyCode: { value: keyCode },
	});
	await act(async () => {
		document.dispatchEvent(event);
	});
	await flush();
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	document.body.innerHTML = "";
	activeElement = null;
	vi.restoreAllMocks();
});

describe("Modal", () => {
	it("registers focus and Escape when an initially closed dialog opens", async () => {
		const close = vi.fn();
		vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
			activeElement = this;
		});
		await mount(
			<Modal open={false} onClose={close} title="Later">
				<input />
			</Modal>,
		);
		await render(
			<Modal open onClose={close} title="Later">
				<input />
			</Modal>,
		);
		expect(document.querySelector("[role='dialog']")?.contains(activeElement)).toBe(true);
		await pressEscape();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("keeps the full approval operation visible without focusing Approve", async () => {
		vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
			activeElement = this;
		});
		const operation = `${"x".repeat(2200)}\ncritical final argument`;
		const respond = vi.fn();
		await mount(
			<ApprovalDialog
				request={{
					type: "extension_ui_request",
					id: "approval",
					method: "select",
					title: `Allow tool: bash\n${operation}`,
					options: ["Approve", "Deny"],
				}}
				onRespond={respond}
			/>,
		);
		expect(document.querySelector("pre")?.textContent).toBe(operation);
		expect(activeElement?.textContent).not.toContain("Approve");
		await pressEscape();
		expect(respond).toHaveBeenCalledWith({ value: "Deny" });
	});

	it("answers a session-approvable prompt with the agent's exact session option", async () => {
		const request = {
			type: "extension_ui_request" as const,
			id: "approval",
			method: "select" as const,
			title: "Allow tool: bash\ngit status",
			options: ["Approve", "Approve `git status` for this session", "Deny"],
		};
		expect(isApprovalRequest(request)).toBe(true);
		// A select titled like an approval but missing "Approve" or "Deny" is not one.
		expect(isApprovalRequest({ ...request, options: ["Maybe", "Deny"] })).toBe(false);
		expect(isApprovalRequest({ ...request, options: ["Approve", "Maybe"] })).toBe(false);
		// Without the "Allow tool:" title an Approve/Deny select is a plain extension dialog.
		expect(isApprovalRequest({ ...request, title: "Pick one" })).toBe(false);
		const respond = vi.fn();
		await mount(<ApprovalDialog request={request} onRespond={respond} />);
		const button = [...document.querySelectorAll("button")].find(b => b.textContent?.includes("for this session"));
		await act(async () => {
			button?.dispatchEvent(new Event("click", { bubbles: true }));
		});
		expect(respond).toHaveBeenCalledWith({ value: "Approve `git status` for this session" });
	});

	it("renders always-ask-cached grant options and answers with the picked label", async () => {
		const request = {
			type: "extension_ui_request" as const,
			id: "approval",
			method: "select" as const,
			title: "Allow tool: read\ncat secret.txt",
			options: ["Allow reads in /tmp/work for this session", "Always allow reads in /tmp/work", "Approve", "Deny"],
		};
		expect(isApprovalRequest(request)).toBe(true);
		const respond = vi.fn();
		await mount(<ApprovalDialog request={request} onRespond={respond} />);
		const grant = [...document.querySelectorAll("button")].find(b =>
			b.textContent?.includes("Always allow reads in /tmp/work"),
		);
		expect(grant).toBeTruthy();
		await act(async () => {
			grant?.dispatchEvent(new Event("click", { bubbles: true }));
		});
		expect(respond).toHaveBeenCalledWith({ value: "Always allow reads in /tmp/work" });
	});
	it("focuses the dialog on open and restores the trigger on close", async () => {
		const trigger = document.createElement("button");
		document.body.appendChild(trigger);
		activeElement = trigger;
		vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
			activeElement = this;
		});

		await mount(
			<Modal open onClose={() => {}} title="Dialog">
				<button type="button">Action</button>
			</Modal>,
		);

		expect(document.querySelector("[role='dialog']")?.contains(activeElement)).toBe(true);
		await render(
			<Modal open={false} onClose={() => {}} title="Dialog">
				<button type="button">Action</button>
			</Modal>,
		);
		expect(activeElement).toBe(trigger);
		trigger.remove();
	});

	it("returns focus to the first trigger after dialogs hand over to each other", async () => {
		const trigger = document.createElement("button");
		document.body.appendChild(trigger);
		activeElement = trigger;
		vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
			activeElement = this;
		});
		const handOff = (shown: "picker" | "editor" | null) => (
			<>
				<Modal open={shown === "picker"} onClose={() => {}} title="Picker">
					<button type="button">New theme</button>
				</Modal>
				<Modal open={shown === "editor"} onClose={() => {}} title="Editor">
					<button type="button">Cancel</button>
				</Modal>
			</>
		);

		// Picker → editor → picker, each swap in one commit, then the picker closes.
		await mount(handOff("picker"));
		expect(document.querySelector("[aria-label='Picker']")?.contains(activeElement)).toBe(true);
		await render(handOff("editor"));
		expect(document.querySelector("[aria-label='Editor']")?.contains(activeElement)).toBe(true);
		await render(handOff("picker"));
		await render(handOff(null));
		expect(activeElement).toBe(trigger);
		trigger.remove();
	});

	it("closes only the topmost dialog for each Escape press", async () => {
		const closeBottom = vi.fn();
		const closeTop = vi.fn();

		function StackedDialogs() {
			const [bottomOpen, setBottomOpen] = useState(true);
			const [topOpen, setTopOpen] = useState(true);
			return (
				<>
					<Modal
						onClose={() => {
							closeBottom();
							setBottomOpen(false);
						}}
						open={bottomOpen}
						title="Bottom"
					>
						<button type="button">Bottom action</button>
					</Modal>
					<Modal
						onClose={() => {
							closeTop();
							setTopOpen(false);
						}}
						open={topOpen}
						title="Top"
					>
						<button type="button">Top action</button>
					</Modal>
				</>
			);
		}

		await mount(<StackedDialogs />);
		await pressEscape();
		expect(closeTop).toHaveBeenCalledTimes(1);
		expect(closeBottom).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Bottom action");

		await pressEscape();
		expect(closeBottom).toHaveBeenCalledTimes(1);
	});

	it("ignores live IME composition but closes on a resolved Escape with legacy keyCode 229", async () => {
		const onClose = vi.fn();
		await mount(
			<Modal open onClose={onClose} title="Dialog">
				<input defaultValue="输入" />
			</Modal>,
		);

		await pressEscape({ isComposing: true, keyCode: 229 });
		expect(onClose).not.toHaveBeenCalled();

		await pressEscape({ keyCode: 229 });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("leaves Escape to an inline editor that owns it, then closes on the next one", async () => {
		// A browser runs the dialog's document capture listener before the editor
		// sees the key; linkedom runs capture after bubbling, so call it directly.
		const captured: EventListener[] = [];
		const add = document.addEventListener.bind(document);
		vi.spyOn(document, "addEventListener").mockImplementation(((
			type: string,
			listener: EventListener,
			options?: boolean | AddEventListenerOptions,
		) => {
			if (type === "keydown" && options === true) captured.push(listener);
			add(type, listener, options);
		}) as typeof document.addEventListener);
		const onClose = vi.fn();
		await mount(
			<Modal open onClose={onClose} title="Dialog">
				<input data-owns-escape="" />
			</Modal>,
		);
		const escapeFrom = (target: unknown) =>
			({
				key: "Escape",
				keyCode: 27,
				isComposing: false,
				target,
				preventDefault() {},
				stopPropagation() {},
				stopImmediatePropagation() {},
			}) as unknown as Event;
		const onKeyDown = captured.at(-1);
		onKeyDown?.(escapeFrom(document.querySelector("input")));
		expect(onClose).not.toHaveBeenCalled();

		onKeyDown?.(escapeFrom(document.querySelector("[role='dialog']")));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("ignores Escape while a custom fullscreen dialog covers it", async () => {
		const onClose = vi.fn();
		await mount(
			<Modal open onClose={onClose} title="Underlay">
				<button type="button">Action</button>
			</Modal>,
		);
		const fullscreen = document.createElement("div");
		fullscreen.setAttribute("role", "dialog");
		document.body.appendChild(fullscreen);

		await pressEscape();
		expect(onClose).not.toHaveBeenCalled();

		fullscreen.remove();
		await pressEscape();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("renders its overlay on the shared dialog tier above app surfaces and floaters", async () => {
		await mount(
			<Modal onClose={() => {}} open title="Layered">
				<span>body</span>
			</Modal>,
		);
		// Fullscreen windows (z-50) and composer menus (z-[100]) must never paint
		// over a pending prompt — the overlay carries the shared DIALOG_OVERLAY_Z.
		expect(document.querySelector(".omp-dialog-overlay")?.className).toContain(DIALOG_OVERLAY_Z);
	});

	it("fades out with the content it had while open, then unmounts", async () => {
		const close = vi.fn();
		await mount(
			<Modal onClose={close} open title="Delete group">
				<span>3 sessions</span>
			</Modal>,
		);
		// The payload that built this body clears on close, so the tree the parent
		// re-renders is empty. An exit that paints it would flash a blank panel.
		await render(
			<Modal onClose={close} open={false} title="Delete group">
				{null}
			</Modal>,
		);
		const panel = document.querySelector<HTMLElement>(".omp-dialog-panel");
		expect(panel?.textContent).toContain("3 sessions");
		expect(panel?.getAttribute("role")).toBe("presentation");

		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, OVERLAY_EXIT_MS + 20));
		});
		expect(document.querySelector(".omp-dialog-panel")).toBeNull();
	});
});
