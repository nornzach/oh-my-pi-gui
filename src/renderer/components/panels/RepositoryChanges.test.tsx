/**
 * RepositoryChanges refresh contract (linkedom, same pattern as
 * QueuePanel.test.tsx): the header refresh re-reads the checkout WITHOUT
 * wiping the file list. A reload is not an initial load — if the second read
 * fails, the rows that loaded successfully stay on screen under the error,
 * instead of the panel collapsing to "Loading" and then nothing.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RpcGitChanges } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { RepositoryChanges } from "./RepositoryChanges";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");

interface TestElement {
	disabled: boolean;
	textContent: string | null;
	remove: () => void;
	dispatchEvent: (event: object) => boolean;
	getAttribute: (name: string) => string | null;
}

function changes(...paths: string[]): RpcGitChanges {
	return {
		isRepo: true,
		root: "/work",
		base: "main",
		files: paths.map(path => ({ path, status: "M" })),
		truncated: false,
	};
}

let getGitChanges: Mock<() => Promise<unknown>>;

function installMockOmp(next: () => Promise<unknown>): void {
	getGitChanges = vi.fn(next);
	(window as unknown as { omp: { rpc: { getGitChanges: Mock } } }).omp = {
		rpc: { getGitChanges },
	};
}

let root: ReturnType<typeof createRoot>;
let container: TestElement;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<RepositoryChanges />
			</I18nProvider>,
		);
	});
	await flush();
}

function queryAll(selector: string): TestElement[] {
	return Array.from(document.querySelectorAll(selector)) as unknown as TestElement[];
}

function bodyText(): string {
	return document.body.textContent ?? "";
}

/** Dispatch inside act(); linkedom's Event has a getter-only eventPhase React writes to. */
async function dispatch(target: TestElement, event: InstanceType<typeof Event>): Promise<void> {
	Object.defineProperty(event, "eventPhase", { value: 0, writable: true, configurable: true });
	await act(async () => {
		target.dispatchEvent(event);
	});
}

async function click(element: TestElement): Promise<void> {
	await dispatch(element, new Event("click", { bubbles: true, cancelable: true }));
}

function refreshButton(): TestElement {
	const match = queryAll("button").find(button => button.getAttribute("title") === "Refresh");
	if (!match) throw new Error("refresh button not found");
	return match;
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
});

describe("RepositoryChanges", () => {
	it("keeps the loaded file list on screen when a refresh fails", async () => {
		installMockOmp(async () => ({
			type: "response",
			command: "get_git_changes",
			success: true,
			data: changes("src/a.ts"),
		}));
		await mount();
		expect(bodyText()).toContain("src/a.ts");
		expect(getGitChanges).toHaveBeenCalledTimes(1);

		getGitChanges.mockResolvedValueOnce({
			type: "response",
			command: "get_git_changes",
			success: false,
			error: "git status failed",
		});
		await click(refreshButton());
		await flush();

		// The user was looking at real changes; a failed re-read may not turn the
		// panel into an empty "clean tree".
		expect(bodyText()).toContain("src/a.ts");
		expect(bodyText()).not.toContain("No net changes in this checkout.");
		expect(bodyText()).toContain("git status failed");
	});

	it("replaces the rows when the retried refresh succeeds", async () => {
		installMockOmp(async () => ({
			type: "response",
			command: "get_git_changes",
			success: true,
			data: changes("src/a.ts"),
		}));
		await mount();
		getGitChanges
			.mockResolvedValueOnce({
				type: "response",
				command: "get_git_changes",
				success: false,
				error: "git status failed",
			})
			.mockResolvedValueOnce({
				type: "response",
				command: "get_git_changes",
				success: true,
				data: changes("src/b.ts"),
			});
		await click(refreshButton());
		await flush();
		expect(bodyText()).toContain("git status failed");

		await click(refreshButton());
		await flush();

		expect(bodyText()).toContain("src/b.ts");
		expect(bodyText()).not.toContain("src/a.ts");
		expect(bodyText()).not.toContain("git status failed");
	});
});
