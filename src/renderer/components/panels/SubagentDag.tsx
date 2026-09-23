/**
 * Graphical subagent DAG: nodes are subagents (status-colored, live elapsed),
 * edges are spawn relationships, anchored at a synthetic main-session node.
 * Click a node to inspect its transcript in the detail pane below the canvas.
 *
 * Layout is a hand-rolled layered tidy tree (depth columns left→right,
 * parents centered on children) rendered as HTML nodes over an SVG edge
 * layer — no graph dependency. Live-updates as subagent frames arrive.
 */

import { Bot, RefreshCw, Terminal, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { SubagentSnapshot } from "../../../shared/rpc-types";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useNowTick } from "../../lib/now-tick";
import { useMessagesStore } from "../../stores/messages";
import { useSubagentsStore } from "../../stores/subagents";
import { Badge, Button } from "../common";
import { SubagentTranscript } from "./SubagentTranscript";
import {
	buildSubagentDag,
	DAG_NODE_HEIGHT,
	DAG_NODE_WIDTH,
	type DagEdge,
	type DagNode,
	extractTaskToolCallIds,
	formatElapsed,
	isLiveSubagentStatus,
	statusMeta,
	subagentElapsedMs,
	subagentPrimaryLabel,
	useSubagentGraphStore,
} from "./subagent-graph";

function nodeBorderClass(agent: SubagentSnapshot): string {
	if (isLiveSubagentStatus(agent.status)) {
		return "border-[color-mix(in_srgb,var(--omp-link)_35%,transparent)]";
	}
	switch (agent.status) {
		case "failed":
			return "border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)]";
		default:
			return "border-(--omp-border-muted)";
	}
}

function edgePath(edge: DagEdge): string {
	const bend = Math.max(24, (edge.x2 - edge.x1) / 2);
	return `M ${edge.x1} ${edge.y1} C ${edge.x1 + bend} ${edge.y1}, ${edge.x2 - bend} ${edge.y2}, ${edge.x2} ${edge.y2}`;
}

const DagAgentNode = memo(function DagAgentNode({
	agent,
	x,
	y,
	selected,
	now,
	onSelect,
}: {
	agent: SubagentSnapshot;
	x: number;
	y: number;
	selected: boolean;
	now: number;
	onSelect: () => void;
}) {
	const t = useT();
	const meta = statusMeta(agent.status);
	const elapsed = subagentElapsedMs(agent, now);
	const line =
		isLiveSubagentStatus(agent.status) && agent.progress?.description
			? agent.progress.description
			: `${agent.agent} #${agent.index + 1}`;

	return (
		<button
			aria-pressed={selected}
			className={cx(
				"absolute flex flex-col rounded-md border px-2 py-1.5 text-left transition-colors duration-150 hover:bg-(--omp-bg-tertiary)",
				nodeBorderClass(agent),
				(agent.status === "completed" || agent.status === "cancelled") && "opacity-70",
				selected && "ring-1 ring-(--omp-link)",
			)}
			onClick={onSelect}
			style={{ left: x, top: y, width: DAG_NODE_WIDTH, height: DAG_NODE_HEIGHT }}
			type="button"
		>
			<div className="flex items-center gap-1.5">
				<Bot className="shrink-0 text-(--omp-status-subagents)" size={12} />
				<span className="min-w-0 flex-1 truncate text-omp-sm font-medium text-(--omp-text)">
					{subagentPrimaryLabel(agent, 36)}
					{agent.index > 0 && <span className="ml-1 text-omp-xxs text-(--omp-dim)">#{agent.index + 1}</span>}
				</span>
				<Badge dot={meta.live} pulse={meta.live} variant={meta.variant}>
					{t(meta.labelKey)}
				</Badge>
			</div>
			<div className="mt-1 flex items-center gap-1.5 pl-[18px]">
				<span
					className={cx(
						"min-w-0 flex-1 truncate text-omp-xxs",
						isLiveSubagentStatus(agent.status) && agent.progress?.description
							? "text-(--omp-muted) italic"
							: "text-(--omp-dim)",
					)}
				>
					{line ?? ""}
				</span>
				{elapsed !== null && (
					<span className="shrink-0 text-omp-xxs tabular-nums text-(--omp-dim)">{formatElapsed(elapsed)}</span>
				)}
			</div>
		</button>
	);
});

function MainNode({ x, y }: { x: number; y: number }) {
	const t = useT();
	return (
		<div
			className="absolute flex flex-col justify-center rounded-md border border-dashed border-(--omp-border-muted) bg-transparent px-2 py-1.5"
			style={{ left: x, top: y, width: DAG_NODE_WIDTH, height: DAG_NODE_HEIGHT }}
		>
			<div className="flex items-center gap-1.5">
				<Terminal className="shrink-0 text-(--omp-dim)" size={12} />
				<span className="truncate text-omp-sm font-medium text-(--omp-muted)">{t("dag.main")}</span>
			</div>
			<div className="truncate pl-[18px] text-omp-xxs text-(--omp-dim)">{t("dag.mainSub")}</div>
		</div>
	);
}

export function SubagentDag() {
	const t = useT();
	const subagents = useSubagentsStore(state => state.subagents);
	const loadError = useSubagentsStore(state => state.error);
	const refresh = useSubagentsStore(state => state.refresh);
	const toolCallOwners = useSubagentGraphStore(state => state.toolCallOwners);
	const messages = useMessagesStore(state => state.messages);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const agents = useMemo(() => [...subagents.values()].sort((a, b) => a.index - b.index), [subagents]);
	const hasRunning = agents.some(agent => isLiveSubagentStatus(agent.status));
	const now = useNowTick(hasRunning);

	useEffect(() => {
		if (selectedId && !subagents.has(selectedId)) setSelectedId(null);
	}, [selectedId, subagents]);

	// Top-level spawn edges resolve against the main session's `task` tool calls.
	const rootToolCallIds = useMemo(() => new Set(extractTaskToolCallIds(messages)), [messages]);
	const layout = useMemo(
		() => buildSubagentDag(agents, rootToolCallIds, toolCallOwners),
		[agents, rootToolCallIds, toolCallOwners],
	);

	const selected = selectedId ? (subagents.get(selectedId) ?? null) : null;

	if (agents.length === 0 && loadError) {
		return (
			<div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-omp-sm leading-relaxed text-(--omp-error)">
				<p role="alert">
					{t("subagent.loadFailed")}
					<br />
					{loadError}
				</p>
				<Button icon={<RefreshCw size={12} />} onClick={() => void refresh()} size="sm" variant="secondary">
					{t("common.retry")}
				</Button>
			</div>
		);
	}

	if (agents.length === 0) {
		return (
			<div className="px-3 py-8 text-center text-omp-sm leading-relaxed text-(--omp-dim)">
				{t("subagent.empty")}
				<br />
				{t("subagent.emptyHint")}
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1 overflow-auto">
				<div className="relative" style={{ width: layout.width, height: layout.height }}>
					<svg aria-hidden className="absolute top-0 left-0" height={layout.height} width={layout.width}>
						<defs>
							<marker id="subagent-dag-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
								<path d="M 0 0 L 6 3 L 0 6 z" fill="context-stroke" />
							</marker>
						</defs>
						{layout.edges.map(edge => (
							<path
								d={edgePath(edge)}
								fill="none"
								key={edge.id}
								markerEnd="url(#subagent-dag-arrow)"
								stroke={edge.childId === selectedId ? "var(--omp-link)" : "var(--omp-border-muted)"}
								strokeWidth={edge.childId === selectedId ? 2 : 1.25}
							/>
						))}
					</svg>
					{layout.nodes.map((node: DagNode) =>
						node.agent === null ? (
							<MainNode key={node.id} x={node.x} y={node.y} />
						) : (
							<DagAgentNode
								agent={node.agent}
								key={node.id}
								now={now}
								onSelect={() => setSelectedId(node.id === selectedId ? null : node.id)}
								selected={node.id === selectedId}
								x={node.x}
								y={node.y}
							/>
						),
					)}
				</div>
			</div>
			{selected ? (
				<div className="flex max-h-[45%] shrink-0 flex-col border-t border-(--omp-border-muted)">
					<div className="flex items-center gap-2 px-3 pt-1.5">
						<Bot className="shrink-0 text-(--omp-status-subagents)" size={13} />
						<span className="min-w-0 flex-1 truncate text-xs font-medium text-(--omp-text)">
							{subagentPrimaryLabel(selected)}
						</span>
						<Badge
							dot={statusMeta(selected.status).live}
							pulse={statusMeta(selected.status).live}
							variant={statusMeta(selected.status).variant}
						>
							{t(statusMeta(selected.status).labelKey)}
						</Badge>
						<button
							aria-label={t("dag.closeTranscript")}
							className="shrink-0 text-(--omp-dim) transition-colors hover:text-(--omp-text)"
							onClick={() => setSelectedId(null)}
							type="button"
						>
							<X size={12} />
						</button>
					</div>
					{selected.description && (
						<div className="truncate px-3 pb-1 text-omp-xs text-(--omp-dim)">{selected.description}</div>
					)}
					<div className="min-h-0 flex-1 overflow-y-auto">
						<SubagentTranscript agent={selected} />
					</div>
				</div>
			) : (
				<div className="shrink-0 space-y-0.5 border-t border-(--omp-border-muted) px-3 py-1.5">
					<div className="text-omp-xs text-(--omp-dim)">{t("dag.clickNode")}</div>
					{layout.unresolved.length > 0 && (
						<div className="text-omp-xxs text-(--omp-dim) italic">
							{t("dag.unresolved", {
								count: layout.unresolved.length,
								plural: layout.unresolved.length === 1 ? "agent" : "agents",
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
