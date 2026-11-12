import { parseHTML } from "linkedom";
import { act, type ReactNode, useState } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { OVERLAY_EXIT_MS } from "../../hooks/use-overlay-presence";
import { I18nProvider } from "../../lib/i18n";
import { type ToolEntry, useToolsStore } from "../../stores/tools";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
Object.assign(globalThis as Record<string, unknown>, {
	document,
	window,
	Event,
	HTMLElement,
	Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { ExecutionGroup } = await import("./ExecutionGroup");
const { ToolCard } = await import("../tools/ToolCard");

let container: HTMLElement;
let root: Root;

function toolEntry(status: "running" | "error", isError = false): ToolEntry {
	return {
		toolName: "bash",
		args: {},
		status,
		partialResult: null,
		streamingArgs: "",
		result: null,
		isError,
		startTime: 1,
		endTime: status === "running" ? null : 2,
	};
}

function StatefulExecutionGroup({
	children,
	failureCount,
	live,
	toolCallIds,
}: {
	children: ReactNode;
	failureCount: number;
	live: boolean;
	toolCallIds: string[];
}) {
	const [expanded, setExpanded] = useState(false);
	return (
		<ExecutionGroup
			expanded={expanded}
			failureCount={failureCount}
			live={live}
			onExpandedChange={setExpanded}
			stepCount={2}
			toolCallIds={toolCallIds}
		>
			{children}
		</ExecutionGroup>
	);
}

async function mount(
	toolCallIds: string[] = [],
	live = false,
	children: ReactNode = <div data-testid="details">tool details</div>,
	failureCount = 0,
): Promise<void> {
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<StatefulExecutionGroup failureCount={failureCount} live={live} toolCallIds={toolCallIds}>
					{children}
				</StatefulExecutionGroup>
			</I18nProvider>,
		);
	});
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	useToolsStore.getState().reset();
});

describe("ExecutionGroup", () => {
	it("keeps completed work to one summary line until requested", async () => {
		await mount();
		expect(container.textContent).toContain("2 steps complete");
		expect(container.querySelector('[data-testid="details"]')).toBeNull();

		await act(async () => {
			(container.querySelector("button") as unknown as { click: () => void }).click();
		});
		expect(container.querySelector('[data-testid="details"]')).not.toBeNull();
	});

	it("keeps failed work compact while preserving its error summary and details", async () => {
		useToolsStore.setState({
			activeTools: new Map([["tool-1", toolEntry("error", true)]]),
		});
		await mount(["tool-1"]);

		expect(container.textContent).toContain("1 failed · 2 steps");
		expect(container.querySelector('[data-testid="details"]')).toBeNull();

		await act(async () => {
			(container.querySelector("button") as unknown as { click: () => void }).click();
		});
		expect(container.querySelector('[data-testid="details"]')).not.toBeNull();
	});

	it("includes failed completion events in the existing group status", async () => {
		await mount([], false, undefined, 1);
		expect(container.textContent).toContain("1 failed · 2 steps");
		expect(container.querySelector('[data-state="failed"]')).not.toBeNull();
	});

	it("never overrides the user's disclosure while execution activity changes", async () => {
		useToolsStore.setState({ activeTools: new Map([["tool-1", toolEntry("running")]]) });
		await mount(["tool-1"]);
		expect(container.querySelector('[data-testid="details"]')).toBeNull();

		await act(async () => {
			(container.querySelector("button") as unknown as { click: () => void }).click();
		});
		expect(container.querySelector('[data-testid="details"]')).not.toBeNull();

		await act(async () => {
			useToolsStore.setState({ activeTools: new Map([["tool-1", toolEntry("error", true)]]) });
		});

		expect(container.textContent).toContain("1 failed · 2 steps");
		expect(container.querySelector('[data-testid="details"]')).not.toBeNull();

		await act(async () => {
			(container.querySelector("button") as unknown as { click: () => void }).click();
			useToolsStore.setState({ activeTools: new Map([["tool-1", toolEntry("running")]]) });
		});
		// The body plays its exit before it unmounts.
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, OVERLAY_EXIT_MS + 40));
		});
		expect(container.querySelector('[data-testid="details"]')).toBeNull();
	});

	it("keeps one animated status for a live group while running child steps remain visible", async () => {
		useToolsStore.setState({
			activeTools: new Map([
				["tool-1", toolEntry("running")],
				["tool-2", toolEntry("running")],
			]),
		});
		await mount(
			["tool-1", "tool-2"],
			true,
			<>
				<ToolCard toolCallId="tool-1" toolName="edit" args={{}} runningIndicator="dot" />
				<ToolCard toolCallId="tool-2" toolName="bash" args={{ command: "bun check" }} runningIndicator="dot" />
			</>,
		);
		await act(async () => {
			(container.querySelector(".omp-execution-group-header") as unknown as { click: () => void }).click();
		});
		await act(async () => {
			for (const button of container.querySelectorAll(".omp-tool-header")) {
				(button as unknown as { click: () => void }).click();
			}
		});

		expect(container.querySelectorAll(".animate-spin, .animate-pulse, .omp-working-dot")).toHaveLength(1);
		expect(container.querySelectorAll(".omp-tool-status-icon")).toHaveLength(2);
		expect(container.querySelector('[role="status"]')?.textContent).toContain("2 running");
	});
});
