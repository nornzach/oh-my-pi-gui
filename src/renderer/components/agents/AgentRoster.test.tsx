/**
 * Rows in the drawer's Agents tab. A regression here hides what type of agent
 * a row is, which model and reasoning level it runs, or what it has spent.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage, AgentProgress, SubagentSnapshot } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import type { MessagesStore } from "../../stores/messages";
import {
	deleteSessionRuntime,
	SessionRuntimeProvider,
	sessionRuntime,
	sessionRuntimeStore,
} from "../../stores/session-runtime-context";
import type { SubagentsStore } from "../../stores/subagents";
import { createTabRuntime } from "../../stores/tab-runtime";
import { AgentRoster } from "./AgentRoster";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

interface TestElement {
	textContent: string | null;
	remove: () => void;
	querySelectorAll: (selector: string) => TestElement[];
}

let container: TestElement;
let root: Root;

function progress(overrides: Partial<AgentProgress>): AgentProgress {
	return {
		index: 0,
		id: "p",
		agent: "task",
		agentSource: "bundled",
		status: "completed",
		task: "t",
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		requests: 0,
		tokens: 0,
		cost: 0,
		durationMs: 0,
		...overrides,
	};
}

const agents: SubagentSnapshot[] = [
	{
		id: "Rain",
		index: 0,
		agent: "task",
		description: "Map the auth surface",
		status: "completed",
		lastUpdate: 1,
		parentToolCallId: "c1",
		progress: progress({ resolvedModel: "anthropic/claude-sonnet-5:high", requests: 3, tokens: 7_700, cost: 0.0123 }),
	},
	// Just spawned: no model reported and nothing spent yet.
	{
		id: "Field",
		index: 1,
		agent: "explore",
		description: "Audit cookie flags",
		status: "running",
		lastUpdate: 1,
		parentToolCallId: "c1",
	},
];

async function mount(): Promise<void> {
	createTabRuntime("t1");
	sessionRuntimeStore<MessagesStore>("t1", "messages")!.setState({
		messages: [
			{ role: "user", content: "go" },
			{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "task", arguments: {} }] },
		] as AgentMessage[],
	});
	sessionRuntimeStore<SubagentsStore>("t1", "subagents")!.getState().setSnapshots(agents);
	// The roster re-reads the agent list when it opens.
	(window as unknown as { omp: unknown }).omp = {
		rpc: {
			commandForTab: async () => ({
				type: "response",
				command: "get_subagents",
				success: true,
				data: { subagents: agents },
			}),
		},
	};
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<SessionRuntimeProvider runtime={sessionRuntime("t1")!}>
					<AgentRoster />
				</SessionRuntimeProvider>
			</I18nProvider>,
		);
	});
}

const rowText = (title: string) =>
	container
		.querySelectorAll('[role="treeitem"]')
		.map(row => row.textContent ?? "")
		.find(text => text.includes(title));

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	deleteSessionRuntime("t1");
});

describe("AgentRoster rows", () => {
	it("say each agent's type and number, model with reasoning level, and usage, like the agents card", async () => {
		await mount();

		expect(rowText("Map the auth surface")).toContain(
			"task #1 · anthropic/claude-sonnet-5:high · 7.7k tokens · $0.0123",
		);
		const spawned = rowText("Audit cookie flags");
		expect(spawned).toContain("explore #2");
		expect(spawned).not.toContain("tokens");
	});
});
