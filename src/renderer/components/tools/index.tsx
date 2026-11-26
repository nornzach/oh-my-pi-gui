import type { ComponentType } from "react";
import { sanitizeToolText, shortenPath } from "../../lib/format";
import { translate } from "../../lib/i18n";
import { decodeXdevPayload, xdevDispatch, xdevInnerResult, xdevWriteTarget } from "../../lib/xdev";
import { AskRenderer, askResultSummary } from "./AskRenderer";
import { AstEditRenderer } from "./AstEditRenderer";
import { AstGrepRenderer } from "./AstGrepRenderer";
import { askFormSummary } from "./ask-form";
import { BashRenderer } from "./BashRenderer";
import { BrowserRenderer } from "./BrowserRenderer";
import { ComputerRenderer } from "./ComputerRenderer";
import { WaitRenderer } from "./CoordinationRenderer";
import { DebugRenderer } from "./DebugRenderer";
import { EditRenderer } from "./EditRenderer";
import { EvalRenderer } from "./EvalRenderer";
import { editArgumentSummary } from "./edit-args";
import { FindRenderer } from "./FindRenderer";
import { GenericRenderer } from "./GenericRenderer";
import { GithubRenderer } from "./GithubRenderer";
import { GlobRenderer } from "./GlobRenderer";
import { GoalRenderer } from "./GoalRenderer";
import { GrepRenderer } from "./GrepRenderer";
import { HubRenderer } from "./HubRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { LspRenderer } from "./LspRenderer";
import { ManageTasksRenderer } from "./ManageTasksRenderer";
import { MemoryRenderer } from "./MemoryRenderer";
import {
	CheckpointRenderer,
	ContextNotesRenderer,
	IdaRenderer,
	LearnRenderer,
	ManageSkillRenderer,
	NewContextRenderer,
	RewindRenderer,
	SecurityScanRenderer,
} from "./OpsRenderers";
import { ReadRenderer } from "./ReadRenderer";
import { ResolveRenderer } from "./ResolveRenderer";
import { ScheduleTaskRenderer } from "./ScheduleTaskRenderer";
import { TaskRenderer } from "./TaskRenderer";
import { TodoRenderer } from "./TodoRenderer";
import type { ToolRendererProps } from "./ToolCard";
import {
	VibeKillRenderer,
	VibeListRenderer,
	VibeSendRenderer,
	VibeSpawnRenderer,
	VibeWaitRenderer,
} from "./VibeRenderer";
import { WebSearchRenderer } from "./WebSearchRenderer";
import { WriteRenderer } from "./WriteRenderer";

export type { ToolRendererProps };

/** Clipped by CSS, but a megabyte of pasted text must not enter the DOM. */
const CARD_TEXT_MAX_CHARS = 160;

function clipCardText(text: string): string {
	return text.length > CARD_TEXT_MAX_CHARS ? `${text.slice(0, CARD_TEXT_MAX_CHARS)}…` : text;
}

/**
 * `write` carries two different things: a file write, and the device call the
 * sidecar routes through it (`write xd://<tool>`, see `lib/xdev`). A device call
 * must render as the tool that ran — otherwise a plan resolution, a security
 * scan or an MCP call shows up as a file write with a line count and the
 * outcome disappears entirely.
 */
function WriteRendererOrDevice(props: ToolRendererProps) {
	const { args, result, isError, isPartial, partialResult, interrupted } = props;
	const device = xdevWriteTarget(args);
	if (!device) return <WriteRenderer {...props} />;

	const envelope = isPartial ? partialResult : result;
	const dispatch = xdevDispatch(envelope);
	// No dispatch metadata: the payload is still streaming, or the write failed
	// before reaching a device. Show the request as key/value rows rather than a
	// file-write card — the wrapped tool has produced no verdict to render.
	if (!dispatch) {
		const raw = typeof args.content === "string" ? args.content : "";
		const decoded = decodeXdevPayload(raw);
		return (
			<GenericRenderer
				args={Object.keys(decoded).length > 0 ? decoded : { content: clipCardText(raw) }}
				isPartial={isPartial}
				result={envelope}
			/>
		);
	}
	if (dispatch.mode === "help") return <GenericRenderer args={{}} result={envelope} />;

	const name = dispatch.tool || device;
	// `xd://write` dispatches the write tool itself; delegating would recurse.
	const Renderer = name === "write" ? GenericRenderer : getToolRenderer(name);
	const inner = xdevInnerResult(envelope, dispatch);
	return (
		<Renderer
			args={dispatch.args ?? decodeXdevPayload(args.content)}
			interrupted={interrupted}
			isError={isError}
			isPartial={isPartial}
			partialResult={inner}
			result={inner}
		/>
	);
}

/**
 * Tool name → renderer. Every name the sidecar can emit for a top-level call
 * belongs here or in `GENERIC_TOOL_NAMES` below; `xd://` device names resolve
 * through this table too (see `WriteRendererOrDevice`). Anything unmapped falls
 * back to GenericRenderer, which is a lossy view, not a broken one.
 */
const REGISTRY: Record<string, ComponentType<ToolRendererProps>> = {
	read: ReadRenderer,
	edit: EditRenderer,
	ast_edit: AstEditRenderer,
	apply_patch: EditRenderer,
	goal: GoalRenderer,
	write: WriteRendererOrDevice,
	bash: BashRenderer,
	grep: GrepRenderer,
	find: FindRenderer,
	glob: GlobRenderer,
	task: TaskRenderer,
	todo: TodoRenderer,
	todowrite: TodoRenderer,
	todo_write: TodoRenderer,
	set_todos: TodoRenderer,
	eval: EvalRenderer,
	browser: BrowserRenderer,
	debug: DebugRenderer,
	lsp: LspRenderer,
	github: GithubRenderer,
	gh: GithubRenderer,
	hub: HubRenderer,
	wait: WaitRenderer,
	ask: AskRenderer,
	computer: ComputerRenderer,
	generate_image: ImageRenderer,
	ast_grep: AstGrepRenderer,
	web_search: WebSearchRenderer,
	vibe_spawn: VibeSpawnRenderer,
	vibe_send: VibeSendRenderer,
	vibe_wait: VibeWaitRenderer,
	vibe_kill: VibeKillRenderer,
	vibe_list: VibeListRenderer,
	retain: MemoryRenderer,
	recall: (props: ToolRendererProps) => <MemoryRenderer {...props} operation="recall" />,
	reflect: (props: ToolRendererProps) => <MemoryRenderer {...props} operation="reflect" />,
	memory_edit: MemoryRenderer,
	resolve: ResolveRenderer,
	// A pending reject carries only a reason — the wrapper pins the operation
	// so the card never renders as "Resolving".
	reject: (props: ToolRendererProps) => <ResolveRenderer {...props} operation="reject" />,
	checkpoint: CheckpointRenderer,
	rewind: RewindRenderer,
	context_notes: ContextNotesRenderer,
	new_context: NewContextRenderer,
	learn: LearnRenderer,
	manage_skill: ManageSkillRenderer,
	security_scan: SecurityScanRenderer,
	ida: IdaRenderer,
	schedule_task: ScheduleTaskRenderer,
	manage_scheduled_tasks: ManageTasksRenderer,
};

export function getToolRenderer(name: string): ComponentType<ToolRendererProps> {
	return REGISTRY[name] ?? GenericRenderer;
}

/** Keys tried in order for a device call's header: the verb, then its object. */
const DEVICE_VERB_KEYS = ["action", "op", "command"] as const;
const DEVICE_OBJECT_KEYS = ["query", "symbol", "path", "file", "pattern", "url", "name"] as const;

function argLine(args: Record<string, unknown>, keys: readonly string[]): string {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string" && value.length > 0) return sanitizeToolText(value.split("\n", 1)[0] ?? "");
	}
	return "";
}

/**
 * `LSP · references foo` instead of `xd://lsp`, so a collapsed device call
 * reads as the tool that ran (parity with the TUI's activity summary).
 */
function xdevSummary(device: string, content: unknown): string {
	const args = decodeXdevPayload(content);
	const detail = [argLine(args, DEVICE_VERB_KEYS), argLine(args, DEVICE_OBJECT_KEYS)].filter(Boolean).join(" ");
	return detail ? `${device} · ${detail}` : device;
}

/** Batch tools name their payload `items`; the first entry is the header. */
function firstItemContent(args: Record<string, unknown>): string {
	if (!Array.isArray(args.items)) return "";
	const first = args.items[0];
	if (first != null && typeof first === "object")
		return argLine(first as Record<string, unknown>, ["content", "text"]);
	return typeof first === "string" ? first : "";
}

const TERMINAL_ACTION_LABELS = new Map([
	["list", "tools.terminal.list"],
	["read", "tools.terminal.read"],
	["run", "tools.terminal.run"],
	["stop", "tools.terminal.stop"],
	["open", "tools.terminal.open"],
	["exec", "tools.terminal.run"],
	["send", "tools.terminal.send"],
	["wait", "tools.terminal.wait"],
]);

function terminalSummary(args: Record<string, unknown>, result?: unknown): string {
	const details = result && typeof result === "object" && "details" in result ? result.details : undefined;
	const terminal = details && typeof details === "object" && "terminal" in details ? details.terminal : undefined;
	const label = TERMINAL_ACTION_LABELS.get(argLine(args, ["action"]));
	const command = argLine(args, ["command", "key"]);
	const target =
		(terminal && typeof terminal === "object"
			? argLine(terminal as Record<string, unknown>, ["title", "host"])
			: "") ||
		argLine(args, ["label", "host"]) ||
		shortenPath(argLine(args, ["cwd"])) ||
		argLine(args, ["id"]);
	return [label && translate(label), command, target === command ? "" : target].filter(Boolean).join(" · ");
}

/**
 * One-line header for a collapsed card, computed from call arguments only —
 * the result may not exist yet. Lives next to the renderer table because the
 * header and the body describe the same call; a `switch` in the transcript
 * layer is what let `find`, `checkpoint` and every device call show nothing.
 */
const SUMMARIES: Record<string, (args: Record<string, unknown>, result?: unknown) => string> = {
	read: args => argLine(args, ["path", "file"]),
	write: args => {
		const device = xdevWriteTarget(args);
		return device ? xdevSummary(device, args.content) : argLine(args, ["path", "file"]);
	},
	edit: editArgumentSummary,
	apply_patch: editArgumentSummary,
	bash: args => argLine(args, ["command", "cmd"]),
	terminal: terminalSummary,
	grep: args => argLine(args, ["pattern"]),
	find: args => argLine(args, ["query"]),
	glob: args => argLine(args, ["path", "pattern"]),
	ast_grep: args => argLine(args, ["pat", "pattern", "query"]),
	ast_edit: args => argLine(args, ["pat", "pattern"]),
	lsp: args => [argLine(args, ["action"]), argLine(args, ["symbol", "file", "path"])].filter(Boolean).join(" "),
	task: args => argLine(args, ["i", "description", "task", "name"]),
	todo: args => [argLine(args, ["op"]), argLine(args, ["task", "reason"])].filter(Boolean).join(" "),
	eval: args => argLine(args, ["title", "language"]),
	debug: args => [argLine(args, ["action"]), argLine(args, ["program", "file", "symbol"])].filter(Boolean).join(" "),
	github: args => [argLine(args, ["action"]), argLine(args, ["repo", "url"])].filter(Boolean).join(" "),
	hub: args => [argLine(args, ["op"]), argLine(args, ["agent", "id"])].filter(Boolean).join(" "),
	wait: () => translate("tools.coordination.waitForResult"),
	ask: (args, result) => {
		const question = argLine(args, ["question", "i"]) || sanitizeToolText(askFormSummary(args.html));
		const answer = result !== undefined ? askResultSummary(result) : "";
		if (question && answer) return `${question} → ${answer}`;
		return answer || question;
	},
	goal: args => argLine(args, ["objective", "op"]),
	checkpoint: args => argLine(args, ["goal"]),
	rewind: args => argLine(args, ["report"]),
	security_scan: args => argLine(args, ["action", "target_kind"]),
	context_notes: args => argLine(args, ["text"]),
	learn: args => argLine(args, ["memory"]),
	manage_skill: args => [argLine(args, ["action"]), argLine(args, ["name"])].filter(Boolean).join(" "),
	memory_edit: args => [argLine(args, ["op"]), argLine(args, ["id"])].filter(Boolean).join(" "),
	retain: args => firstItemContent(args) || argLine(args, ["text", "memory"]),
	recall: args => argLine(args, ["query", "text"]),
	reflect: args => argLine(args, ["topic", "query"]),
	web_search: args => argLine(args, ["query", "i"]),
	generate_image: args => argLine(args, ["subject", "prompt"]),
	tts: args => argLine(args, ["text"]),
	resolve: args => argLine(args, ["reason", "label"]),
	reject: args => argLine(args, ["reason"]),
	schedule_task: args => argLine(args, ["title"]),
	manage_scheduled_tasks: args => [argLine(args, ["action"]), argLine(args, ["title"])].filter(Boolean).join(" "),
};

const FALLBACK_ARG_KEYS = [
	"description",
	"path",
	"file",
	"pattern",
	"query",
	"command",
	"url",
	"target",
	"i",
	"name",
	"action",
	"text",
] as const;

/** Header text for any tool call; unknown tools fall back to their first scalar argument. */
export function getToolSummary(name: string, args: Record<string, unknown>, result?: unknown, intent?: string): string {
	const summary = SUMMARIES[name];
	const target = summary?.(args, result) || argLine(args, FALLBACK_ARG_KEYS);
	const purpose = intent ? sanitizeToolText(intent).trim().split("\n", 1)[0] : undefined;
	return clipCardText(purpose && target && !purpose.includes(target) ? `${purpose} · ${target}` : purpose || target);
}
