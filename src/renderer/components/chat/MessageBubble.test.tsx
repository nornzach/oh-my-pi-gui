import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { useToolsStore } from "../../stores/tools";

import { MessageBubble } from "./MessageBubble";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Element = Element;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

const toolCallId = "call_read_package";
const assistantMessage: AgentMessage = {
	role: "assistant",
	content: [
		{
			type: "toolCall",
			id: toolCallId,
			name: "read",
			arguments: { path: "packages/gui/package.json" },
		},
	],
	timestamp: "2026-08-02T12:00:00.000Z",
};
const toolResultMessage: AgentMessage = {
	role: "toolResult",
	toolCallId,
	toolName: "read",
	content: [{ type: "text", text: '{"name":"@oh-my-pi/omp-gui"}' }],
	isError: false,
	timestamp: "2026-08-02T12:00:01.000Z",
};

afterEach(() => {
	useToolsStore.getState().reset();
});

describe("MessageBubble tool messages", () => {
	it("hydrates a completed tool card and folds away the standalone result", () => {
		useToolsStore.getState().hydrateMessages([assistantMessage, toolResultMessage]);

		const entry = useToolsStore.getState().activeTools.get(toolCallId);
		expect(entry).toMatchObject({
			toolName: "read",
			args: { path: "packages/gui/package.json" },
			status: "done",
			isError: false,
		});

		const callHtml = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble message={assistantMessage} />
			</I18nProvider>,
		);
		expect(callHtml).toContain("read");
		expect(callHtml).toContain("packages/gui/package.json");
		expect(
			renderToStaticMarkup(
				<I18nProvider>
					<MessageBubble message={toolResultMessage} />
				</I18nProvider>,
			),
		).toBe("");
	});

	it("shows edited files for freeform edit calls in collapsed headers", () => {
		const message: AgentMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call_edit_patch",
					name: "edit",
					arguments: {
						input: "*** Begin Patch\n[packages/gui/src/first.ts#A1B2] PUT 1.=1:\n+first\n[packages/gui/src/second.ts#C3D4] PUT 1.=1:\n+second\n*** End Patch\n",
					},
				},
			],
			timestamp: "2026-08-12T00:00:00.000Z",
		};
		useToolsStore.getState().hydrateMessages([message]);

		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble message={message} />
			</I18nProvider>,
		);
		expect(html).toContain("packages/gui/src/first.ts +1");
	});

	it("keeps repeated provider call ids paired with their own historical results", async () => {
		const firstCall: AgentMessage = {
			role: "assistant",
			content: [{ type: "toolCall", id: "read:0", name: "read", arguments: { path: "first.txt" } }],
			timestamp: "2026-08-02T12:00:02.000Z",
		};
		const firstResult: AgentMessage = {
			role: "toolResult",
			toolCallId: "read:0",
			toolName: "read",
			content: [{ type: "text", text: "FIRST_RESULT" }],
			timestamp: "2026-08-02T12:00:03.000Z",
		};
		const secondCall: AgentMessage = {
			role: "assistant",
			content: [{ type: "toolCall", id: "read:0", name: "read", arguments: { path: "second.txt" } }],
			timestamp: "2026-08-02T12:00:04.000Z",
		};
		const secondResult: AgentMessage = {
			role: "toolResult",
			toolCallId: "read:0",
			toolName: "read",
			content: [{ type: "text", text: "SECOND_RESULT" }],
			timestamp: "2026-08-02T12:00:05.000Z",
		};
		useToolsStore.getState().hydrateMessages([firstCall, firstResult, secondCall, secondResult]);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		try {
			await act(async () => {
				root.render(
					<I18nProvider>
						<div id="first-call">
							<MessageBubble message={firstCall} />
						</div>
						<div id="second-call">
							<MessageBubble message={secondCall} />
						</div>
					</I18nProvider>,
				);
			});
			const firstNode = container.querySelector("#first-call");
			const secondNode = container.querySelector("#second-call");
			const firstButton = firstNode?.querySelector("button");
			const secondButton = secondNode?.querySelector("button");
			if (!firstNode || !secondNode || !firstButton || !secondButton) throw new Error("tool cards did not render");
			await act(async () => firstButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true })));
			await act(async () => secondButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true })));
			expect(firstNode.textContent).toContain("FIRST_RESULT");
			expect(firstNode.textContent).not.toContain("SECOND_RESULT");
			expect(secondNode.textContent).toContain("SECOND_RESULT");
			expect(secondNode.textContent).not.toContain("FIRST_RESULT");
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});
});

describe("MessageBubble user content", () => {
	it("shows an assistant reaction on the user bubble", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					message={{
						role: "user",
						content: [{ type: "text", text: "Ship it?" }],
						timestamp: "2026-08-06T00:00:00.000Z",
					}}
					reaction="👍"
				/>
			</I18nProvider>,
		);
		expect(html).toContain('role="img"');
		expect(html).toContain("👍");
	});

	it("renders user text through the same Markdown pipeline as assistant text", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					message={{
						role: "user",
						content: [{ type: "text", text: "**bold** and `code`" }],
						timestamp: "2026-08-06T00:00:00.000Z",
					}}
				/>
			</I18nProvider>,
		);
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain("<code");
	});

	it("keeps SQL JSONPath dollars literal instead of parsing them as inline math", () => {
		const sql =
			"JSON_SET(o.parameters, '$.reasoning_effort.required', FALSE, '$.reasoning_effort.default', 'medium')";
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					message={{
						role: "user",
						content: [{ type: "text", text: sql }],
						timestamp: "2026-08-13T00:00:00.000Z",
					}}
				/>
			</I18nProvider>,
		);
		expect(html).toContain("$.reasoning_effort.required");
		expect(html).toContain("$.reasoning_effort.default");
		expect(html).not.toContain("katex");
	});
});

describe("MessageBubble compaction summaries", () => {
	it("shows the maintenance method and before-to-after context size", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					message={{
						role: "compactionSummary",
						summary: "Long archived context details.",
						shortSummary: "Kept the active work.",
						method: "remote",
						tokensBefore: 256_000,
						tokensAfter: 20_000,
						timestamp: "2026-08-20T00:00:00.000Z",
					}}
				/>
			</I18nProvider>,
		);

		expect(html).toContain("Remote compacted · 256.0k → 20.0k");
		expect(html).toContain("Kept the active work.");
		expect(html).not.toContain("Long archived context details.");
	});

	it("preserves an unknown maintenance method and a zero-token starting point", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					message={{
						role: "compactionSummary",
						summary: "Future compactor finished.",
						method: "future",
						tokensBefore: 0,
						tokensAfter: 12,
						timestamp: "2026-08-20T00:00:00.000Z",
					}}
				/>
			</I18nProvider>,
		);

		expect(html).toContain("future · 0 → 12");
	});
});

describe("MessageBubble completion events", () => {
	it("renders supervised-process failures as one compact status row without the wire type", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					compact
					message={{
						role: "custom",
						customType: "launch-completion",
						content: "Supervised process backend-smoke failed with exit code 1.",
						details: {
							daemons: [{ name: "backend-smoke", state: "failed", exitCode: 1 }],
						},
						display: true,
						timestamp: "2026-08-20T00:00:00.000Z",
					}}
				/>
			</I18nProvider>,
		);
		expect(html).toContain("backend-smoke");
		expect(html).toContain("exit 1");
		expect(html).not.toContain("launch-completion");
		expect(html).not.toContain("omp-custom-turn");
	});

	it("keeps background output behind one native disclosure row", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					message={{
						role: "custom",
						customType: "async-result",
						content: "<system-notice>Background job bg-7 has completed.\nBUILD_OUTPUT</system-notice>",
						details: { jobs: [{ jobId: "bg-7", type: "bash", label: "bun run build" }] },
						display: true,
						timestamp: "2026-08-20T00:00:00.000Z",
					}}
				/>
			</I18nProvider>,
		);
		expect(html).toContain("bun run build");
		expect(html).toContain("Background job completed");
		expect(html).toContain("<details");
		expect(html).not.toContain("<details open");
		expect(html).toContain("BUILD_OUTPUT");
	});
});

describe("MessageBubble noise filtering", () => {
	const at = "2026-08-02T12:00:00.000Z";

	it('renders nothing for punctuation-only text or thinking blocks (model filler like ".")', () => {
		for (const text of [".", "…", "---", " ", "***"]) {
			for (const message of [
				{ role: "assistant" as const, content: [{ type: "text" as const, text }], timestamp: at },
				{ role: "assistant" as const, content: [{ type: "thinking" as const, thinking: text }], timestamp: at },
			]) {
				expect(
					renderToStaticMarkup(
						<I18nProvider>
							<MessageBubble message={message} />
						</I18nProvider>,
					),
				).toBe("");
			}
		}
	});

	it("keeps real text, CJK, and emoji-only blocks", () => {
		for (const text of ["已修复", "Done.", "👍"]) {
			const message: AgentMessage = { role: "assistant", content: [{ type: "text", text }], timestamp: at };
			expect(
				renderToStaticMarkup(
					<I18nProvider>
						<MessageBubble message={message} />
					</I18nProvider>,
				),
			).toContain(text);
		}
	});

	it("compacts tool-only messages — no hover footer chrome", () => {
		useToolsStore.getState().hydrateMessages([assistantMessage, toolResultMessage]);
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble message={assistantMessage} />
			</I18nProvider>,
		);
		// The timestamp/copy/branch footer is message-level chrome a tool card
		// doesn't need (copy would copy an empty string).
		expect(html).not.toContain("Copy message text");
		expect(html).toContain("py-1.5");
	});

	it("keeps the footer on text-bearing messages", () => {
		const mixed: AgentMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "Fixed." },
				{ type: "toolCall", id: "call_mixed", name: "read", arguments: { path: "x" } },
			],
			timestamp: at,
		};
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble message={mixed} />
			</I18nProvider>,
		);
		expect(html).toContain("Fixed.");
		expect(html).toContain("Copy message text");
		expect(html).toContain("py-3");
	});

	it("offers branch-to-new-tab on user and assistant messages even before legacy ids are resolved", () => {
		const user: AgentMessage = {
			role: "user",
			entryId: "user-entry",
			content: [{ type: "text", text: "branch point" }],
			timestamp: at,
		};
		const assistant: AgentMessage = {
			role: "assistant",
			entryId: "assistant-entry",
			content: [{ type: "text", text: "answer" }],
			timestamp: at,
		};
		const render = (message: AgentMessage) =>
			renderToStaticMarkup(
				<I18nProvider>
					<MessageBubble message={message} />
				</I18nProvider>,
			);

		expect(render(user)).toContain("Branch to a new tab from here");
		expect(render(assistant)).toContain("Branch to a new tab from here");
		expect(render({ ...assistant, entryId: undefined })).toContain("Branch to a new tab from here");
	});

	it("uses compact chrome for expanded process details containing reasoning and tools", () => {
		const processMessage: AgentMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Inspect first." },
				{ type: "toolCall", id: "call_process", name: "read", arguments: { path: "x" } },
			],
			timestamp: at,
		};
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble compact message={processMessage} />
			</I18nProvider>,
		);
		expect(html).toContain("read");
		expect(html).not.toContain("Copy message text");
		expect(html).toContain("py-1.5");
		expect(html).toContain("omp-assistant-turn--compact");
	});

	it("uses the full-width transcript content surface for assistant output", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					message={{
						role: "assistant",
						content: [{ type: "text", text: "A long answer that must follow the transcript reading measure." }],
						timestamp: at,
					}}
				/>
			</I18nProvider>,
		);
		expect(html).toContain('class="omp-transcript-content min-w-0"');
		expect(html).not.toContain('class="min-w-0 flex-1"');
	});
});

describe("MessageBubble ended replies", () => {
	const ended = (stopReason: string, errorMessage: string) =>
		renderToStaticMarkup(
			<I18nProvider>
				<MessageBubble
					message={{
						role: "assistant",
						content: [{ type: "text", text: "Half an answer" }],
						stopReason,
						errorMessage,
						timestamp: "2026-08-06T00:00:00.000Z",
					}}
				/>
			</I18nProvider>,
		);

	it("shows a reply the user stopped as stopped, not as a failed request", () => {
		const html = ended("aborted", "Request was aborted");
		expect(html).toContain("Stopped");
		expect(html).not.toContain("Request was aborted");
		expect(html).not.toContain("The request failed");
		expect(html).not.toContain('role="alert"');
	});

	it("keeps an abort reason that says more than the stop itself", () => {
		expect(ended("aborted", "Handoff aborted by session")).toContain("Handoff aborted by session");
	});

	it("still reports a provider error as a failed request", () => {
		const html = ended("error", "429 Too Many Requests");
		expect(html).toContain("The request failed");
		expect(html).toContain('role="alert"');
	});

	it("explains an unusable proxy, keeping Bun's error under Technical details", () => {
		const html = ended(
			"error",
			'UnsupportedProxyProtocol fetching "https://example.com/v1/chat". For more information, pass `verbose: true` in the second argument to fetch()',
		);
		expect(html).toContain("The request failed");
		expect(html).toContain("HTTP and HTTPS proxies");
		const [sentence, details] = html.split("<details");
		expect(sentence).not.toContain("UnsupportedProxyProtocol");
		expect(details).toContain("Technical details");
		expect(details).toContain("UnsupportedProxyProtocol");
	});

	it("leaves out Technical details when the sentence is already the whole text", () => {
		expect(ended("error", "Workspace is read-only")).not.toContain("<details");
	});

	it("reads as a step along the way while the agent is still trying", async () => {
		const message: AgentMessage = {
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage: "500 Upstream overloaded",
			timestamp: "2026-08-06T00:00:00.000Z",
		};
		useMessagesStore.setState({ messages: [message], liveMessages: [] });
		useSessionStore.setState({ isStreaming: true, status: "ready" });
		const host = document.createElement("div");
		const root = createRoot(host as never);
		await act(async () => {
			root.render(
				<I18nProvider>
					<MessageBubble message={message} />
				</I18nProvider>,
			);
		});
		expect(host.textContent).toContain("Attempt failed, trying again");
		expect(host.textContent).not.toContain("The request failed");
		expect(host.querySelector('[role="alert"]')).toBeNull();

		await act(async () => {
			useSessionStore.setState({ isStreaming: false });
		});
		expect(host.textContent).toContain("The request failed");
		expect(host.querySelector('[role="alert"]')).not.toBeNull();
		expect(host.textContent).toContain("Retry");

		await act(async () => root.unmount());
		useMessagesStore.setState({ messages: [], liveMessages: [] });
	});
});
