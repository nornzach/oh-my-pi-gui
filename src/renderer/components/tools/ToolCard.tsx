import { Ban, Check, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cx, durationBetween } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useNowTick } from "../../lib/now-tick";
import { useToolsStore } from "../../stores/tools";
import { useUiStore } from "../../stores/ui";
import { GenericRenderer } from "./GenericRenderer";
import { getToolRenderer, getToolSummary } from "./index";

export interface ToolRendererProps {
	args: Record<string, unknown>;
	result: unknown;
	isError?: boolean;
	isPartial?: boolean;
	partialResult?: unknown;
	/**
	 * The call ended without ever reporting a result (interrupted turn, dead
	 * process). Renderers must stop showing live text — the run is over, but
	 * no `result` arrives to replace it.
	 */
	interrupted?: boolean;
}

export interface ToolCardProps {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	/** A parent activity indicator can own animation for a live tool group. */
	runningIndicator?: RunningIndicator;
}

export type RunningIndicator = "spinner" | "dot";

/**
 * Chrome around every tool invocation: status rail, name, summary, duration,
 * expand/collapse. The body comes from the tool registry; the tool_result
 * arrives via the tools store keyed by toolCallId.
 */
export function ToolCard({ toolCallId, toolName, args, runningIndicator = "spinner" }: ToolCardProps) {
	const t = useT();
	const entry = useToolsStore(s => s.activeTools.get(toolCallId));
	const expandAll = useUiStore(s => s.toolsExpandAll);
	const [expanded, setExpanded] = useState(expandAll.expanded);

	// ⌃O expand/collapse-all: every card snaps to the latest shared target.
	useEffect(() => {
		setExpanded(expandAll.expanded);
	}, [expandAll]);

	const entryStatus = entry?.status ?? "running";
	// "pending" (args still streaming) is a live sub-state: spinner, not a check.
	const status = entryStatus === "pending" ? "running" : entryStatus;
	const isError = Boolean(entry?.isError);
	const isPartial = status === "running";
	const isAborted = status === "aborted";
	const now = useNowTick(isPartial);
	const duration = entry ? durationBetween(entry.startTime, isPartial ? now : entry.endTime) : null;
	// While args stream in, `args` is still {} — surface the raw partial JSON
	// (truncated) so a long bash/edit call doesn't sit as an empty card until
	// message_end.
	const streamingSummary =
		entry?.status === "pending" && typeof entry.streamingArgs === "string"
			? entry.streamingArgs.slice(0, 160)
			: undefined;
	const Renderer = getToolRenderer(toolName);
	const summary = getToolSummary(toolName, args);

	const railColor =
		status === "error" || isError
			? "var(--omp-tool-rail-error)"
			: status === "aborted"
				? "var(--omp-warning)"
				: status === "done"
					? "var(--omp-tool-rail-done)"
					: "var(--omp-tool-rail-running)";

	const statusBg =
		status === "error" || isError
			? "var(--omp-tool-error-bg)"
			: status === "aborted"
				? "var(--omp-warning-dim)"
				: status === "done"
					? "var(--omp-tool-success-bg)"
					: "var(--omp-tool-pending-bg)";

	return (
		<div
			className={cx(
				"omp-tool-card omp-fade-up relative my-2 overflow-hidden rounded-[10px] border border-[var(--omp-border-muted)] transition-[border-color,box-shadow,background-color] duration-200",
				status === "running" && "border-[var(--omp-border-accent)]/60",
			)}
			data-tool-status={status}
			data-tool-error={isError ? "true" : undefined}
			style={{
				background: statusBg,
				boxShadow: status === "running" ? "0 0 12px var(--omp-input-glow)" : "var(--omp-shadow-sm)",
			}}
		>
			{/* 2px status rail pinned to the card's left edge */}
			<span
				aria-hidden
				className="absolute inset-y-0 left-0 w-[2px] transition-colors duration-300"
				style={{ background: railColor }}
			/>
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setExpanded(v => !v)}
				className="omp-tool-header flex w-full items-center gap-2 py-2 pl-3.5 pr-2.5 text-left transition-colors duration-150 hover:bg-[var(--omp-selected-bg)]/40"
			>
				{status === "running" && runningIndicator === "spinner" ? (
					<Loader2 size={12} className="omp-tool-status-icon shrink-0 animate-spin text-[var(--omp-accent)]" />
				) : status === "running" ? (
					<span aria-hidden className="omp-tool-status-icon flex h-3 w-3 shrink-0 items-center justify-center">
						<span className="h-1.5 w-1.5 rounded-full bg-[var(--omp-accent)]" />
					</span>
				) : status === "aborted" ? (
					<span className="omp-tool-status-icon flex shrink-0 items-center">
						<Ban size={12} className="text-[var(--omp-warning)]" />
						<span className="sr-only">{t("tools.status.interrupted")}</span>
					</span>
				) : isError ? (
					<X size={12} className="omp-tool-status-icon shrink-0 text-[var(--omp-error)]" />
				) : (
					<Check size={12} className="omp-tool-status-icon shrink-0 text-[var(--omp-success)]" />
				)}
				<span className="omp-tool-name shrink-0 font-mono text-omp-md font-semibold tracking-tight text-[var(--omp-text)]">
					{toolName}
				</span>
				{summary && (
					<span className="omp-tool-summary min-w-0 flex-1 truncate font-mono text-omp-sm text-[var(--omp-tool-output)]">
						{summary}
					</span>
				)}
				{!summary && streamingSummary && (
					<span className="omp-tool-summary min-w-0 flex-1 truncate font-mono text-omp-sm opacity-60 text-[var(--omp-tool-output)]">
						{streamingSummary}…
					</span>
				)}
				{!summary && !streamingSummary && <span className="flex-1" />}
				{duration && (
					<span
						className="omp-tool-duration shrink-0 rounded-md bg-[var(--omp-bg-tertiary)] px-1.5 py-0.5 font-mono text-omp-xxs tabular-nums text-[var(--omp-muted)]" // surface-ok: tiny duration pill
					>
						{duration}
					</span>
				)}
				<ChevronRight
					size={13}
					className={cx(
						"omp-tool-chevron omp-disclosure-chevron shrink-0 text-[var(--omp-dim)]",
						expanded && "rotate-90",
					)}
				/>
			</button>
			{expanded && (
				<div className="omp-tool-body omp-fade-in border-t border-[var(--omp-border-muted)]/70 px-3.5 py-2.5">
					{isAborted && (
						<div className="mb-1.5 flex items-center gap-1.5 font-mono text-omp-sm text-[var(--omp-warning)]">
							<Ban size={11} className="shrink-0" />
							{t("tools.status.interrupted")}
						</div>
					)}
					{/* A specialized renderer would claim "no matches" for a call that never
					 * returned, so an output-less abort shows only what was asked for. */}
					{isAborted && entry?.result == null && entry?.partialResult == null ? (
						<GenericRenderer args={args} result={null} interrupted />
					) : (
						<Renderer
							args={args}
							result={entry?.result}
							isError={isError}
							isPartial={isPartial}
							partialResult={entry?.partialResult}
							interrupted={isAborted}
						/>
					)}
				</div>
			)}
		</div>
	);
}
