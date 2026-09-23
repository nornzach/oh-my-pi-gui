/**
 * useSessionList silent-refresh contract: the loading state shows only on the
 * initial load. Background refreshes (SessionIndex fires per session-file
 * append while agents stream) update the list WITHOUT flipping isLoading —
 * the sidebar "twitch" fix. Probe-component harness (no renderHook dep).
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { SessionInfo } from "../../shared/ipc-types";
import { useSessionList } from "./use-session-list";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

interface MockOmp {
	sessions: {
		list: Mock<(scope: string) => Promise<SessionInfo[]>>;
		delete: Mock<() => Promise<void>>;
		rename: Mock<() => Promise<void>>;
	};
	events: { onSessionsChanged: Mock<(callback: () => void) => () => void> };
}

function session(path: string): SessionInfo {
	return {
		path,
		id: path,
		title: path,
		cwd: "/work",
		created: "2026-01-01T00:00:00Z",
		modified: "2026-01-01T00:00:00Z",
		messageCount: 1,
		size: 10,
		status: "complete",
		firstMessage: "hi",
	};
}

let onSessionsChanged: (() => void) | undefined;
let listResult: SessionInfo[];

function installMockOmp(): MockOmp {
	const omp: MockOmp = {
		sessions: {
			list: vi.fn(async () => listResult),
			delete: vi.fn(async () => {}),
			rename: vi.fn(async () => {}),
		},
		events: {
			onSessionsChanged: vi.fn((callback: () => void) => {
				onSessionsChanged = callback;
				return () => {};
			}),
		},
	};
	(window as unknown as { omp: MockOmp }).omp = omp;
	return omp;
}

let root: Root;
let container: { textContent: string | null; remove: () => void };

function Probe() {
	const { error, isLoading, sessions } = useSessionList("global");
	return (
		<div>
			<span data-testid="loading">{String(isLoading)}</span>
			<span data-testid="count">{sessions.length}</span>
			<span data-testid="error">{error ?? ""}</span>
		</div>
	);
}

async function flush(ms = 0): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, ms);
		await promise;
	});
}

function probeText(selector: string): string {
	const el = document.querySelector(selector);
	return el?.textContent ?? "missing";
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	onSessionsChanged = undefined;
});

describe("useSessionList silent refresh", () => {
	it("shows loading on first load, then refreshes in place without flickering it", async () => {
		listResult = [session("/s/one.jsonl")];
		installMockOmp();
		container = document.createElement("div") as never;
		document.body.appendChild(container as never);
		root = createRoot(container as unknown as Element);

		await act(async () => {
			root.render(<Probe />);
		});
		await flush();

		// Initial load settles: loading off, one session shown.
		expect(probeText('[data-testid="loading"]')).toBe("false");
		expect(probeText('[data-testid="count"]')).toBe("1");

		// A session-file change event (streaming append) refreshes the list after
		// the trailing debounce — loading must NOT flip back on (that flip is the
		// visible twitch).
		listResult = [session("/s/one.jsonl"), session("/s/two.jsonl")];
		await act(async () => {
			onSessionsChanged?.();
		});
		await flush(400);

		expect(probeText('[data-testid="loading"]')).toBe("false");
		expect(probeText('[data-testid="count"]')).toBe("2");
	});

	it("reports a failed read as an error, not as an empty session list", async () => {
		listResult = [session("/s/one.jsonl")];
		const omp = installMockOmp();
		// The sidebar renders "No code sessions yet" whenever the list is empty and
		// loading is done — so a swallowed rejection becomes a false domain claim.
		omp.sessions.list.mockRejectedValueOnce(new Error("session index unreadable"));
		container = document.createElement("div") as never;
		document.body.appendChild(container as never);
		root = createRoot(container as unknown as Element);

		await act(async () => {
			root.render(<Probe />);
		});
		await flush();

		expect(probeText('[data-testid="loading"]')).toBe("false");
		expect(probeText('[data-testid="count"]')).toBe("0");
		expect(probeText('[data-testid="error"]')).toBe("session index unreadable");

		// The next good read clears it; the error is not sticky.
		await act(async () => {
			onSessionsChanged?.();
		});
		await flush(400);

		expect(probeText('[data-testid="count"]')).toBe("1");
		expect(probeText('[data-testid="error"]')).toBe("");
	});
});
