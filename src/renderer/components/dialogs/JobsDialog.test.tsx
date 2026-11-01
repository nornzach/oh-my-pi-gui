/**
 * Jobs dialog contract: a sidecar that sends the job tree gets its subagent
 * jobs shown nested in the agent's display order, including subagents whose
 * task job is no longer listed. Same linkedom harness as the other dialog tests.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcJobsResult, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
Object.assign(globalThis as Record<string, unknown>, {
	document,
	window,
	Event,
	HTMLElement,
	Element,
	Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const getJobs = vi.fn<() => Promise<RpcResponse>>();
(window as unknown as { omp: { rpc: { getJobs: typeof getJobs } } }).omp = { rpc: { getJobs } };

const { createRoot } = await import("react-dom/client");
const { JobsDialog } = await import("./JobsDialog");

let container: InstanceType<typeof HTMLElement>;
let root: Root;

async function openWith(data: RpcJobsResult): Promise<void> {
	getJobs.mockResolvedValue({ command: "get_jobs", data, success: true, type: "response" });
	useUiStore.getState().openJobs();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(
			<I18nProvider>
				<JobsDialog />
			</I18nProvider>,
		);
	});
	await act(async () => {
		await Promise.resolve();
	});
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	getJobs.mockReset();
	useUiStore.getState().closeJobs();
});

describe("JobsDialog", () => {
	it("renders the sidecar's job tree in order, with subagent headers and running count", async () => {
		const own = { id: "j1", type: "bash", status: "completed", label: "npm test", startTime: 1, endedAt: 2 } as const;
		const task = {
			id: "scout",
			type: "task",
			status: "running",
			label: "scout",
			startTime: 1,
			agentId: "0-Scout",
		} as const;
		const child = {
			id: "j3",
			type: "bash",
			status: "running",
			label: "grep",
			startTime: 1,
			ownerId: "0-Scout",
		} as const;
		const orphan = {
			id: "j4",
			type: "bash",
			status: "running",
			label: "make",
			startTime: 1,
			ownerId: "1-Gone",
		} as const;
		await openWith({
			jobs: [own, task],
			tree: [
				{ depth: 0, job: task, agentId: "0-Scout" },
				{ depth: 1, job: child },
				{ depth: 0, agentId: "1-Gone" },
				{ depth: 1, job: orphan },
				{ depth: 0, job: own },
			],
		});
		const text = document.body.textContent ?? "";
		const order = ["[scout]", "[j3]", "1-Gone", "[j4]", "[j1]"].map(marker => text.indexOf(marker));
		expect(order.every(index => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(text).toContain("3 running");
	});

	it("leads a job with the purpose the model gave, then its caption, ahead of the command", async () => {
		const job = {
			id: "j1",
			type: "bash",
			status: "running",
			label: "bun test --coverage",
			intent: "Run the test suite",
			caption: "Runs all package tests; ends when coverage is written",
			startTime: 1,
		} as const;
		await openWith({ jobs: [job] });
		const text = document.body.textContent ?? "";
		const order = ["Run the test suite", "Runs all package tests", "bun test --coverage"].map(part =>
			text.indexOf(part),
		);
		expect(order.every(index => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});
});
