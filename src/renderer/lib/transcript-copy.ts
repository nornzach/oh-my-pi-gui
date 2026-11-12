/**
 * Client-side transcript/todo clipboard flows backing the nativized /dump and
 * /todo subcommands: fetch structured state over RPC (or the live stores),
 * format it as readable markdown/JSON, and push it to the clipboard with a
 * toast result — no prompt round-trip through the agent.
 */

import type { AgentMessage, MessageContent, TodoPhase, TodoTask } from "../../shared/rpc-types";
import { hydrateSession } from "../hooks/use-rpc-events";
import { toast } from "../stores/toast";
import { useTodoStore } from "../stores/todo";
import { copyText } from "./format";
import { translate } from "./i18n";
import { messageText } from "./messages";

/** Tool-call argument/rendered-result cap so one dump stays paste-friendly. */
const TOOL_ARGS_CHAR_LIMIT = 600;
const TOOL_RESULT_CHAR_LIMIT = 1200;

const TODO_STATUS_VALID: Record<string, true> = {
	pending: true,
	in_progress: true,
	completed: true,
	abandoned: true,
	blocked: true,
};

function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]`;
}

/** One-line JSON summary of tool arguments (compact, single-line, capped). */
function summarizeArgs(args: Record<string, unknown>): string {
	try {
		return truncate(JSON.stringify(args), TOOL_ARGS_CHAR_LIMIT);
	} catch {
		return "[unserializable arguments]";
	}
}

function fence(text: string, lang?: string): string {
	// Longer fences win when the payload itself contains triple backticks.
	const barrier = text.includes("```") ? "````" : "```";
	return `${barrier}${lang ?? ""}\n${text}\n${barrier}`;
}

const ROLE_HEADINGS: Partial<Record<AgentMessage["role"], string>> = {
	user: "User",
	assistant: "Assistant",
	system: "System",
	bashExecution: "Bash",
	pythonExecution: "Python",
	branchSummary: "Branch Summary",
	compactionSummary: "Compaction Summary",
};

function formatContentBlock(block: MessageContent, lines: string[]): void {
	switch (block.type) {
		case "text": {
			const text = block.text.trim();
			if (text) lines.push(text, "");
			return;
		}
		case "thinking": {
			const thinking = block.thinking.trim();
			if (thinking) {
				lines.push("> **Thinking**", ">");
				for (const line of thinking.split("\n")) lines.push(`> ${line}`);
				lines.push("");
			}
			return;
		}
		case "toolCall":
			lines.push(`- **Tool call:** \`${block.name}\` — ${summarizeArgs(block.arguments)}`, "");
			return;
		case "image":
			lines.push("- [image]", "");
			return;
	}
}

function formatMessage(message: AgentMessage, lines: string[]): void {
	const heading = ROLE_HEADINGS[message.role];
	if (heading !== undefined) {
		const text = messageText(message);
		// Assistant turns with only tool calls still earn a header; empty
		// headers for content-less messages are noise, so gate on content.
		const blocks = Array.isArray(message.content) ? message.content : [];
		if (!text && blocks.length === 0 && !message.code && !message.summary) return;
		lines.push(`## ${heading}`, "");
		if (Array.isArray(message.content)) {
			for (const block of message.content) formatContentBlock(block, lines);
		} else if (text) {
			lines.push(text, "");
		}
		if (message.code) lines.push(fence(message.code, "bash"), "");
		if (message.output) lines.push(fence(truncate(message.output, TOOL_RESULT_CHAR_LIMIT)), "");
		if (message.summary && !text) lines.push(message.summary, "");
		return;
	}
	if (message.role === "toolResult") {
		const label = message.toolName ? `\`${message.toolName}\`` : "tool";
		const errorMark = message.isError ? " (error)" : "";
		const output = truncate(messageText(message) || message.output || "", TOOL_RESULT_CHAR_LIMIT);
		if (!output) return;
		lines.push(`**Tool result** ${label}${errorMark}:`, "", fence(output), "");
		return;
	}
	// custom/hookMessage/fileMention and unmapped roles: keep the text if any.
	const text = messageText(message);
	if (text) lines.push(`## Message (${message.customType ?? message.command ?? message.role})`, "", text, "");
}

/**
 * Render the full display transcript as readable markdown: role headers per
 * message, thinking folded into blockquotes, tool calls as one-line summaries
 * with capped JSON args, tool results as fenced blocks.
 */
export function formatTranscriptMarkdown(messages: AgentMessage[]): string {
	const lines: string[] = ["# Session Transcript", ""];
	for (const message of messages) formatMessage(message, lines);
	return lines.join("\n").trimEnd();
}

const TODO_STATUS_SUFFIX: Record<TodoTask["status"], string> = {
	pending: "",
	in_progress: " _(in progress)_",
	completed: "",
	abandoned: " _(abandoned)_",
};

/** Render todo phases as a GFM task list (`- [x]` completed, `- [ ]` open). */
export function formatTodoMarkdown(phases: TodoPhase[]): string {
	const lines: string[] = ["# Todos", ""];
	for (const phase of phases) {
		lines.push(`## ${phase.name}`, "");
		for (const task of phase.tasks) {
			const box = task.status === "completed" ? "[x]" : "[ ]";
			const content = task.status === "abandoned" ? `~~${task.content}~~` : task.content;
			lines.push(`- ${box} ${content}${TODO_STATUS_SUFFIX[task.status] ?? ""}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

function taskCount(phases: TodoPhase[]): number {
	return phases.reduce((total, phase) => total + phase.tasks.length, 0);
}

/** Store phases stripped of GUI-side ids back down to the wire shape. */
function currentTodoPhases(): TodoPhase[] {
	return useTodoStore.getState().phases.map(phase => ({
		name: phase.name,
		tasks: phase.tasks.map(task => ({ content: task.content, status: task.status })),
	}));
}

/** /dump: full transcript as markdown → clipboard → toast. */
export async function dumpTranscriptToClipboard(): Promise<void> {
	const response = await window.omp.rpc.getTranscript();
	if (!response.success) throw new Error(response.error);
	const messages = (response.data as { messages?: AgentMessage[] } | undefined)?.messages ?? [];
	if (messages.length === 0) {
		toast({ variant: "info", message: translate("dump.empty") });
		return;
	}
	if (!(await copyText(formatTranscriptMarkdown(messages)))) throw new Error(translate("dump.failed"));
	toast({ variant: "success", message: translate("dump.copied", { count: messages.length }) });
}

/** /todo copy: current phases as a markdown task list → clipboard → toast. */
export async function copyTodosToClipboard(): Promise<void> {
	const phases = currentTodoPhases();
	const count = taskCount(phases);
	if (count === 0) {
		toast({ variant: "info", message: translate("todoCmd.empty") });
		return;
	}
	if (!(await copyText(formatTodoMarkdown(phases)))) throw new Error(translate("todoCmd.copyFailed"));
	toast({ variant: "success", message: translate("todoCmd.copied", { count }) });
}

/**
 * /todo export: the GUI preload exposes no fs-write IPC (system/fs only has
 * list/read), so the save-dialog + write flow degrades to clipboard + toast
 * until a write bridge exists.
 */
export async function exportTodos(): Promise<void> {
	const phases = currentTodoPhases();
	const count = taskCount(phases);
	if (count === 0) {
		toast({ variant: "info", message: translate("todoCmd.empty") });
		return;
	}
	if (!(await copyText(JSON.stringify(phases, null, 2)))) throw new Error(translate("todoCmd.copyFailed"));
	toast({ variant: "success", message: translate("todoCmd.exportCopied", { count }) });
}

/** Validate parsed JSON into the TodoPhase wire shape; throws when malformed. */
export function parseTodoPhasesJson(value: unknown): TodoPhase[] {
	const message = translate("todoCmd.importInvalid");
	if (!Array.isArray(value)) throw new Error(message);
	const phases: TodoPhase[] = [];
	for (const rawPhase of value) {
		if (typeof rawPhase !== "object" || rawPhase === null) throw new Error(message);
		const { name, tasks } = rawPhase as { name?: unknown; tasks?: unknown };
		if (typeof name !== "string" || !name.trim() || !Array.isArray(tasks)) throw new Error(message);
		const parsedTasks: TodoTask[] = tasks.map(rawTask => {
			if (typeof rawTask !== "object" || rawTask === null) throw new Error(message);
			const { content, status } = rawTask as { content?: unknown; status?: unknown };
			if (typeof content !== "string" || !content.trim()) throw new Error(message);
			if (status !== undefined && (typeof status !== "string" || TODO_STATUS_VALID[status] !== true)) {
				throw new Error(message);
			}
			return { content, status: (status ?? "pending") as TodoTask["status"] };
		});
		phases.push({ name, tasks: parsedTasks });
	}
	return phases;
}

/** /todo import: open dialog → read JSON → validate → set_todos RPC → toast. */
export async function importTodosFromFile(): Promise<void> {
	const picked = await window.omp.system.showOpenDialog([{ name: "JSON", extensions: ["json"] }]);
	const path = picked?.[0];
	if (!path) return;
	const read = await window.omp.fs.read(path, 4 * 1024 * 1024);
	if (!read.ok || read.binary || read.truncated) throw new Error(translate("todoCmd.importReadFailed"));
	let parsed: unknown;
	try {
		parsed = JSON.parse(read.content);
	} catch {
		throw new Error(translate("todoCmd.importInvalid"));
	}
	const phases = parseTodoPhasesJson(parsed);
	const response = await window.omp.rpc.setTodos(phases);
	if (!response.success) throw new Error(response.error);
	await hydrateSession();
	toast({ variant: "success", message: translate("todoCmd.imported", { count: taskCount(phases) }) });
}
