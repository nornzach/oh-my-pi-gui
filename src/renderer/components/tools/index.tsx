import type { ComponentType } from "react";
import { AskRenderer } from "./AskRenderer";
import { AstEditRenderer } from "./AstEditRenderer";
import { AstGrepRenderer } from "./AstGrepRenderer";
import { BashRenderer } from "./BashRenderer";
import { BrowserRenderer } from "./BrowserRenderer";
import { ComputerRenderer } from "./ComputerRenderer";
import { DebugRenderer } from "./DebugRenderer";
import { EditRenderer } from "./EditRenderer";
import { EvalRenderer } from "./EvalRenderer";
import { FindRenderer } from "./FindRenderer";
import { GenericRenderer } from "./GenericRenderer";
import { GithubRenderer } from "./GithubRenderer";
import { GlobRenderer } from "./GlobRenderer";
import { GoalRenderer } from "./GoalRenderer";
import { GrepRenderer } from "./GrepRenderer";
import { HubRenderer } from "./HubRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { LspRenderer } from "./LspRenderer";
import { MemoryRenderer } from "./MemoryRenderer";
import { ReadRenderer } from "./ReadRenderer";
import { ResolveRenderer } from "./ResolveRenderer";
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

/**
 * Tool name → renderer. Names cover the built-in tool set plus common
 * aliases; anything unmapped falls back to GenericRenderer.
 */
const REGISTRY: Record<string, ComponentType<ToolRendererProps>> = {
	read: ReadRenderer,
	edit: EditRenderer,
	ast_edit: AstEditRenderer,
	apply_patch: EditRenderer,
	goal: GoalRenderer,
	write: WriteRenderer,
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
	ask: AskRenderer,
	computer: ComputerRenderer,
	image: ImageRenderer,
	image_gen: ImageRenderer,
	inspect_image: ImageRenderer,
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
};

export function getToolRenderer(name: string): ComponentType<ToolRendererProps> {
	return REGISTRY[name] ?? GenericRenderer;
}
