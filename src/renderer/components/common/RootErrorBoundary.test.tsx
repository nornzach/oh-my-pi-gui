import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OmpApi } from "../../../shared/ipc-types";
import { RootErrorBoundary } from "./RootErrorBoundary";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });

interface TestElement {
	remove(): void;
	textContent: string | null;
}

let container: TestElement;
let root: Root;

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
});

function Broken(): ReactNode {
	throw new Error("broken root surface");
}

describe("RootErrorBoundary", () => {
	it("replaces a root render crash with a reload surface and exposes the log path", async () => {
		const logPath = vi.fn(async () => "/tmp/gui-runtime.jsonl");
		(window as unknown as { omp: OmpApi }).omp = {
			runtime: { report: vi.fn(), logPath },
		} as unknown as OmpApi;
		container = document.createElement("div") as unknown as TestElement;
		document.body.appendChild(container as never);
		root = createRoot(container as unknown as Element, { onCaughtError: () => {} });

		await act(async () => {
			root.render(
				<RootErrorBoundary>
					<Broken />
				</RootErrorBoundary>,
			);
		});

		expect(container.textContent).toContain("broken root surface");
		expect(container.textContent).toContain("Reload window");
		expect(container.textContent).toContain("/tmp/gui-runtime.jsonl");
		expect(logPath).toHaveBeenCalledOnce();
	});
});
