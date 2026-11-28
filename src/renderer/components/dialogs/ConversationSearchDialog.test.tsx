/**
 * Conversation search from the keyboard: the query and scope that reach the
 * index, the message a selection opens (and where), and an answer given while
 * sessions are still being read being asked again until the index catches up.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ConversationSearchResponse } from "../../../shared/ipc-types";
import { I18nProvider } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { useTranscriptFocusStore } from "../../stores/transcript-focus";
import { useUiStore } from "../../stores/ui";
import { ConversationSearchDialog } from "./ConversationSearchDialog";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
// linkedom has no layout; the selected row is kept in view with scrollIntoView.
(HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView = () => {};

const storage = new Map<string, string>();
globals.localStorage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => void storage.set(key, value),
};

const HERE = "/work/app";
const OTHER = "/work/site";

function response(overrides: Partial<ConversationSearchResponse> = {}): ConversationSearchResponse {
	return {
		results: [
			{
				path: "/s/app/one.jsonl",
				sessionId: "one",
				cwd: HERE,
				title: "Release build",
				modified: 2000,
				hits: [
					{ entryId: "u1", role: "user", snippet: "why does \u0001notarize\u0002 fail", timestamp: 1000 },
					{ entryId: "a1", role: "assistant", snippet: "\u0001Notarize\u0002 needs a flag", timestamp: 1100 },
				],
				more: 0,
			},
			{
				path: "/s/site/two.jsonl",
				sessionId: "two",
				cwd: OTHER,
				title: null,
				modified: 1000,
				hits: [{ entryId: "u9", role: "user", snippet: "\u0001notarize\u0002 again", timestamp: 900 }],
				more: 2,
			},
		],
		indexed: 2,
		indexing: null,
		...overrides,
	};
}

let container: HTMLElement;
let root: Root;
let search: Mock;
let openTab: Mock;

function reactProps(element: Element | null): Record<string, ((event: object) => unknown) | undefined> {
	const record = element as unknown as Record<string, unknown>;
	const key = Object.getOwnPropertyNames(record).find(name => name.startsWith("__reactProps$"));
	return (key ? record[key] : {}) as Record<string, ((event: object) => unknown) | undefined>;
}

const input = () => container.querySelector("input") as unknown as HTMLInputElement;
const dialog = () => container.querySelector("[role=dialog]");

async function type(text: string): Promise<void> {
	await act(async () => reactProps(input()).onChange?.({ target: { value: text } }));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(200);
	});
}

async function press(key: string, modifiers: { metaKey?: boolean } = {}): Promise<void> {
	await act(async () =>
		reactProps(dialog()).onKeyDown?.({ key, target: input(), preventDefault: () => {}, ...modifiers }),
	);
}

beforeEach(async () => {
	vi.useFakeTimers();
	storage.clear();
	search = vi.fn(async () => response());
	openTab = vi.fn(async () => "tab-2");
	(window as unknown as { omp: unknown }).omp = { sessions: { searchConversations: search } };
	useTabsStore.setState({ openTab });
	useSessionStore.setState({ cwd: HERE });
	useTranscriptFocusStore.setState({ target: null });
	useUiStore.setState({ conversationSearchOpen: true });
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ConversationSearchDialog />
			</I18nProvider>,
		);
	});
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	useUiStore.setState({ conversationSearchOpen: false });
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("ConversationSearchDialog", () => {
	it("does not open a hit from the previous query before the next answer arrives", async () => {
		await type("notarize");
		await act(async () => reactProps(input()).onChange?.({ target: { value: "release" } }));
		await press("Enter", { metaKey: true });
		const staleHit = container.querySelector("[data-search-index='0']");
		expect(staleHit?.hasAttribute("disabled")).toBe(true);
		expect(openTab).not.toHaveBeenCalled();
		expect(useUiStore.getState().conversationSearchOpen).toBe(true);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		await press("Enter", { metaKey: true });
		expect(openTab).toHaveBeenCalledTimes(1);
	});

	it("retries a failed query in place without retyping it", async () => {
		search.mockRejectedValueOnce(new Error("index unavailable"));
		await type("notarize");
		const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Retry");
		await act(async () => reactProps(retry ?? null).onClick?.({}));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(search).toHaveBeenCalledTimes(2);
		expect(search).toHaveBeenLastCalledWith("notarize", HERE);
		await press("Enter", { metaKey: true });
		expect(openTab).toHaveBeenCalledTimes(1);
	});
	it("searches this project by default and all projects once switched", async () => {
		await type("  notarize ");
		expect(search).toHaveBeenLastCalledWith("notarize", HERE);

		const all = [...container.querySelectorAll("button[aria-pressed]")].find(
			button => button.textContent === "All projects",
		);
		await act(async () => reactProps(all ?? null).onClick?.({}));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(search).toHaveBeenLastCalledWith("notarize", null);
		expect(storage.get("omp.conversationSearch.scope")).toBe("all");
	});

	it("opens the selected message, in a new tab with ⌘↵, and remembers the search", async () => {
		await type("notarize");
		expect(container.querySelectorAll("mark")).toHaveLength(3);

		await press("ArrowDown");
		await press("Enter", { metaKey: true });

		expect(useTranscriptFocusStore.getState().target).toMatchObject({
			sessionPath: "/s/app/one.jsonl",
			entryId: "a1",
		});
		expect(openTab).toHaveBeenCalledWith({ cwd: HERE, sessionPath: "/s/app/one.jsonl", kind: "agent" });
		expect(useUiStore.getState().conversationSearchOpen).toBe(false);
		expect(JSON.parse(storage.get("omp.conversationSearch.recent") ?? "[]")).toEqual(["notarize"]);
	});

	it("opens a message from another project in its own tab even with plain ↵", async () => {
		await type("notarize");
		await press("ArrowDown");
		await press("ArrowDown");
		await press("Enter");

		expect(useTranscriptFocusStore.getState().target).toMatchObject({
			sessionPath: "/s/site/two.jsonl",
			entryId: "u9",
		});
		expect(openTab).toHaveBeenCalledWith({ cwd: OTHER, sessionPath: "/s/site/two.jsonl", kind: "agent" });
	});

	it("says how much is searchable before anything is typed, without listing results", async () => {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});
		expect(search).toHaveBeenLastCalledWith("", HERE);
		expect(container.textContent).toContain("2 sessions searchable");
		expect(container.textContent).toContain("Find anything from your sessions");
		expect(container.querySelectorAll("mark")).toHaveLength(0);

		await press("Enter");
		expect(openTab).not.toHaveBeenCalled();
	});

	it("asks again while sessions are being read, then shows what is searchable", async () => {
		search.mockResolvedValueOnce(response({ results: [], indexed: 1, indexing: { done: 1, total: 2 } }));
		await type("notarize");
		expect(container.textContent).toContain("Reading sessions 1/2");
		expect(search).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(800);
		});
		expect(search).toHaveBeenCalledTimes(2);
		expect(container.textContent).toContain("2 sessions searchable");
		expect(container.textContent).toContain("Release build");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		expect(search).toHaveBeenCalledTimes(2);
	});
});
