import { Bot, Check, Wrench, X } from "lucide-react";
import type { ReactNode } from "react";
import { basename, cx, formatDuration, formatTokens, headLines, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useNowTick } from "../../lib/now-tick";
import { resultDetails } from "./result";
import type { ToolRendererProps } from "./ToolCard";
import {
	asArray,
	asNumber,
	asRecord,
	asString,
	extractMissingYieldWarning,
	extractReviewResult,
	FINDING_CAP,
	formatTaskId,
	MAX_NESTED_DEPTH,
	normalizeYieldData,
	OUTPUT_PREVIEW_LINES,
	orderProgressForDisplay,
	orderResultsForDisplay,
	PRIORITY_COLOR,
	PRIORITY_ORD,
	type RenderYieldItem,
	type ReviewResult,
	YIELD_CAP,
	yieldLabels,
} from "./task-render-utils";

/**
 * Task (subagent spawn): live agent tree. Mirrors the TUI task renderer
 * (packages/coding-agent/src/task/render.ts): per-agent stats
 * (tools/requests/context%/$cost/model), current tool + elapsed, retry
 * badge/countdown, nested task trees, yields/review findings, and a
 * run-summary footer `[N succeeded · N failed · N req · duration]`.
 *
 * Wire shape: `{ content, details }` where details is `TaskToolDetails`:
 *   { results: SingleResult[], progress?: AgentProgress[], totalDurationMs }
 * Live updates arrive in `partialResult` while the call runs.
 */

function AgentBadge({ agent }: { agent: string }) {
	return <span className="shrink-0 font-mono text-omp-xxs text-[var(--omp-dim)]">[{agent}]</span>;
}

function StatusBadge({ color, children }: { color: string; children: string }) {
	return (
		<span
			className="shrink-0 rounded px-1 py-px font-mono text-omp-xxs font-semibold"
			style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
		>
			{children}
		</span>
	);
}

interface StatOpts {
	toolCount?: number;
	requests?: number;
	contextTokens?: number;
	contextWindow?: number;
	cost?: number;
	resolvedModel?: string;
}

/** Per-agent stats: `12 🔧 · 3 req · 5.1%/1M · $0.42 · model` (TUI appendAgentStats). */
function AgentStats({ stats }: { stats: StatOpts }) {
	const t = useT();
	const context =
		stats.contextTokens != null && stats.contextTokens > 0
			? stats.contextWindow != null && stats.contextWindow > 0
				? `${((stats.contextTokens / stats.contextWindow) * 100).toFixed(1)}%/${formatTokens(stats.contextWindow)}`
				: formatTokens(stats.contextTokens)
			: null;
	const model = stats.resolvedModel
		? stats.resolvedModel.length > 30
			? `${stats.resolvedModel.slice(0, 29)}…`
			: stats.resolvedModel
		: null;
	return (
		<span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-omp-xxs tabular-nums text-[var(--omp-dim)]">
			{stats.toolCount != null && stats.toolCount > 0 && (
				<span className="flex shrink-0 items-center gap-0.5">
					{stats.toolCount}
					<Wrench size={9} />
				</span>
			)}
			{stats.requests != null && stats.requests > 0 && (
				<span className="shrink-0">{t("tools.task.requests", { count: stats.requests })}</span>
			)}
			{context && <span className="shrink-0">{context}</span>}
			{stats.cost != null && stats.cost > 0 && (
				<span className="shrink-0 text-[var(--omp-warning)]">${stats.cost.toFixed(2)}</span>
			)}
			{model && (
				<span className="truncate" title={stats.resolvedModel}>
					{model}
				</span>
			)}
		</span>
	);
}

/** Usage cost from a SingleResult's aggregated `usage` envelope. */
function resultCost(row: Record<string, unknown>): number {
	return asNumber(asRecord(asRecord(row.usage)?.cost)?.total) ?? 0;
}

// ---------------------------------------------------------------------------
// Yields + review rendering
// ---------------------------------------------------------------------------

function yieldPreview(item: RenderYieldItem, lastTurnLabel: string): string {
	if (item.data === undefined) return lastTurnLabel;
	if (typeof item.data === "string") return item.data.replace(/\s+/g, " ").trim();
	try {
		return JSON.stringify(item.data) ?? "null";
	} catch {
		return String(item.data);
	}
}

/** `yield[label]: preview` lines for typed yield sections (last N). */
function YieldLines({ value }: { value: unknown }) {
	const t = useT();
	const typed: Array<{ item: RenderYieldItem; labels: string[] }> = [];
	for (const item of normalizeYieldData(value)) {
		const labels = yieldLabels(item.type);
		if (labels.length > 0) typed.push({ item, labels });
	}
	const visible = typed.slice(-YIELD_CAP);
	return (
		<>
			{visible.map(({ item, labels }, i) => (
				<div key={i} className="flex gap-1.5 font-mono text-omp-xs leading-[1.5]">
					<span className="shrink-0 text-[var(--omp-dim)]">└</span>
					<span className="min-w-0 truncate" title={yieldPreview(item, t("tools.task.yieldLastTurn"))}>
						<span className="text-[var(--omp-dim)]">
							{t("tools.task.yieldLabel", { suffix: Array.isArray(item.type) ? "+" : "" })}[{labels.join(", ")}]:
						</span>{" "}
						<span className="text-[var(--omp-muted)]">{yieldPreview(item, t("tools.task.yieldLastTurn"))}</span>
					</span>
				</div>
			))}
			{typed.length > visible.length && (
				<div className="pl-3.5 font-mono text-omp-xs text-[var(--omp-dim)]">
					{t("tools.task.moreYields", {
						count: typed.length - visible.length,
						plural: typed.length - visible.length === 1 ? "" : "s",
					})}
				</div>
			)}
		</>
	);
}

/** Review verdict + findings list (submit_review data carried by yields). */
function ReviewBlock({ review }: { review: ReviewResult }) {
	const t = useT();
	const correct = review.correctness === "correct";
	const verdictColor = correct ? "var(--omp-success)" : "var(--omp-error)";
	const sorted = [...review.findings].sort(
		(a, b) => (PRIORITY_ORD[a.priority] ?? 3) - (PRIORITY_ORD[b.priority] ?? 3),
	);
	const visible = sorted.slice(0, FINDING_CAP);
	const counts: Record<string, number> = {};
	for (const finding of review.findings) {
		counts[finding.priority] = (counts[finding.priority] ?? 0) + 1;
	}
	const flat = review.explanation.replace(/\s+/g, " ").trim();
	const preview = flat.split(/[.!?]/)[0]?.trim();
	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex items-center gap-1.5 text-omp-sm">
				{correct ? (
					<Check size={11} className="shrink-0 text-[var(--omp-success)]" />
				) : (
					<X size={11} className="shrink-0 text-[var(--omp-error)]" />
				)}
				<span className="font-medium" style={{ color: verdictColor }}>
					{t("tools.task.patchVerdict", {
						verdict: t(correct ? "tools.task.verdict.correct" : "tools.task.verdict.incorrect"),
					})}
				</span>
				<span className="font-mono text-omp-xs text-[var(--omp-dim)]">
					({t("tools.task.confidence", { pct: (review.confidence * 100).toFixed(0) })})
				</span>
			</div>
			{preview && (
				<div className="truncate pl-4 text-omp-xs text-[var(--omp-dim)]" title={flat}>
					{preview}.
				</div>
			)}
			<div className="flex items-center gap-1.5 pl-4 font-mono text-omp-xs">
				<span className="text-[var(--omp-dim)]">
					{review.findings.length === 0 ? t("tools.task.findingsNone") : t("tools.task.findings")}
				</span>
				{review.findings.length > 0 &&
					["P0", "P1", "P2", "P3"].map(label => (
						<span key={label} style={{ color: PRIORITY_COLOR[label] }}>
							{label}:{counts[label] ?? 0}
						</span>
					))}
			</div>
			{visible.map((finding, i) => (
				<div key={i} className="flex min-w-0 items-center gap-1.5 pl-4 text-omp-xs leading-[1.5]">
					<span className="shrink-0 font-mono font-semibold" style={{ color: PRIORITY_COLOR[finding.priority] }}>
						[{finding.priority}]
					</span>
					<span className="min-w-0 truncate text-[var(--omp-text)]" title={finding.title}>
						{finding.title}
					</span>
					<span className="shrink-0 font-mono text-omp-xxs text-[var(--omp-dim)]">
						{basename(finding.filePath)}:{finding.lineStart}
					</span>
				</div>
			))}
			{sorted.length > visible.length && (
				<div className="pl-4 font-mono text-omp-xs text-[var(--omp-dim)]">
					{t("tools.task.moreFindings", {
						count: sorted.length - visible.length,
						plural: sorted.length - visible.length === 1 ? "" : "s",
					})}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Nested task trees
// ---------------------------------------------------------------------------

interface TreeCtx {
	seen: Set<object>;
	now: number;
}

/** A TaskToolDetails-shaped record carries a results and/or progress array. */
function asTaskDetails(value: unknown): Record<string, unknown> | undefined {
	const r = asRecord(value);
	if (!r) return undefined;
	if (!Array.isArray(r.results) && !Array.isArray(r.progress)) return undefined;
	return r;
}

/** Interleaved completed/in-flight nested subagent snapshots, indented one level. */
function NestedTaskTree({ list, depth, ctx }: { list: Record<string, unknown>[]; depth: number; ctx: TreeCtx }) {
	const t = useT();
	return (
		<div className="ml-1.5 flex flex-col gap-1.5 border-l border-[var(--omp-border-muted)] pl-2">
			{list.map((details, i) => {
				if (ctx.seen.has(details)) {
					return (
						<div key={i} className="font-mono text-omp-xs text-[var(--omp-dim)]">
							{t("tools.task.cycle")}
						</div>
					);
				}
				if (depth >= MAX_NESTED_DEPTH) {
					return (
						<div key={i} className="font-mono text-omp-xs text-[var(--omp-dim)]">
							{t("tools.task.depthLimit")}
						</div>
					);
				}
				ctx.seen.add(details);
				try {
					const results = asArray(details.results)
						.map(asRecord)
						.filter((r): r is Record<string, unknown> => r != null);
					const progress = asArray(details.progress)
						.map(asRecord)
						.filter((r): r is Record<string, unknown> => r != null);
					if (results.length > 0) {
						return (
							<div key={i} className="flex flex-col gap-1.5">
								{orderResultsForDisplay(results).map((row, j) => (
									<ResultAgentRow
										key={`${asString(row.id) ?? j}-${j}`}
										ctx={ctx}
										depth={depth + 1}
										row={row}
									/>
								))}
							</div>
						);
					}
					if (progress.length > 0) {
						return (
							<div key={i} className="flex flex-col gap-1.5">
								{orderProgressForDisplay(progress).map((row, j) => (
									<ProgressAgentRow
										key={`${asString(row.id) ?? j}-${j}`}
										ctx={ctx}
										depth={depth + 1}
										row={row}
									/>
								))}
							</div>
						);
					}
					return null;
				} finally {
					ctx.seen.delete(details);
				}
			})}
		</div>
	);
}

/** Nested snapshots = completed `task` extractions plus the in-flight call. */
function nestedSnapshots(row: Record<string, unknown>): Record<string, unknown>[] {
	const extracted = asRecord(row.extractedToolData);
	const completed = asArray(extracted?.task)
		.map(asTaskDetails)
		.filter((r): r is Record<string, unknown> => r != null);
	const inflight = asTaskDetails(row.inflightTaskDetails);
	return inflight ? [...completed, inflight] : completed;
}

// ---------------------------------------------------------------------------
// Agent rows
// ---------------------------------------------------------------------------

/** Live agent row: status line + stats + current tool + retry + yields + nested tree. */
function ProgressAgentRow({ row, depth, ctx }: { row: Record<string, unknown>; depth: number; ctx: TreeCtx }) {
	const t = useT();
	const status = asString(row.status) ?? "running";
	const running = status === "running" || status === "pending";
	const id = formatTaskId(asString(row.id) ?? "?");
	const description = asString(row.description)?.trim() || undefined;
	const agent = asString(row.agent);
	const retryState = asRecord(row.retryState);
	const retryFailure = asRecord(row.retryFailure);
	const currentTool = asString(row.currentTool);
	const toolDetail = asString(row.lastIntent) ?? asString(row.currentToolArgs);
	const currentToolStartMs = asNumber(row.currentToolStartMs);
	const recentTool = asRecord(asArray(row.recentTools)[0]);
	const assignment = asString(row.assignment) ?? asString(row.task);
	const yieldValue = asRecord(row.extractedToolData)?.yield;
	const review = status === "completed" ? extractReviewResult(normalizeYieldData(yieldValue)) : undefined;
	const nested = nestedSnapshots(row);

	const dotColor = running ? "var(--omp-accent)" : status === "completed" ? "var(--omp-success)" : "var(--omp-error)";
	const nameColor = status === "completed" ? "text-[var(--omp-text)]" : "text-[var(--omp-accent)]";
	const elapsed = currentToolStartMs != null ? ctx.now - currentToolStartMs : 0;
	const retryRemainingMs =
		retryState != null
			? Math.max(0, (asNumber(retryState.startedAtMs) ?? 0) + (asNumber(retryState.delayMs) ?? 0) - ctx.now)
			: 0;

	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex min-w-0 items-center gap-1.5 text-omp-sm">
				<span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dotColor }} />
				<span className={cx("shrink-0 font-mono font-semibold", nameColor)}>{id}</span>
				{description && (
					<span className="min-w-0 truncate text-[var(--omp-muted)]" title={description}>
						: {description}
					</span>
				)}
				{agent && agent !== "task" && <AgentBadge agent={agent} />}
				{retryState && status === "running" ? (
					<StatusBadge color="var(--omp-warning)">{t("tools.task.badge.retrying")}</StatusBadge>
				) : retryFailure && (status === "failed" || status === "aborted") ? (
					<StatusBadge color="var(--omp-error)">{t("tools.task.badge.rateLimited")}</StatusBadge>
				) : status === "failed" ? (
					<StatusBadge color="var(--omp-error)">{t("subagent.status.failed")}</StatusBadge>
				) : status === "aborted" ? (
					<StatusBadge color="var(--omp-error)">{t("subagent.status.cancelled")}</StatusBadge>
				) : null}
				{status === "running" && !description && assignment && (
					<span className="min-w-0 truncate text-[var(--omp-dim)]" title={assignment}>
						{assignment}
					</span>
				)}
				{(status === "running" || status === "completed") && (
					<AgentStats
						stats={{
							toolCount: asNumber(row.toolCount),
							requests: asNumber(row.requests),
							contextTokens: asNumber(row.contextTokens),
							contextWindow: asNumber(row.contextWindow),
							cost: asNumber(row.cost),
							resolvedModel: asString(row.resolvedModel),
						}}
					/>
				)}
			</div>

			{assignment && !(status === "running" && !description) && (
				<div className="truncate pl-3 text-omp-xs text-[var(--omp-dim)]" title={assignment}>
					{assignment}
				</div>
			)}

			{status === "running" &&
				(currentTool ? (
					<div className="flex min-w-0 items-center gap-1.5 pl-1 font-mono text-omp-xs leading-[1.5]">
						<span className="shrink-0 text-[var(--omp-accent)]">└</span>
						<span
							className="min-w-0 truncate text-[var(--omp-muted)]"
							title={toolDetail ? `${currentTool}: ${toolDetail}` : currentTool}
						>
							{currentTool}
							{toolDetail && <span className="text-[var(--omp-dim)]">: {toolDetail}</span>}
						</span>
						{elapsed > 5000 && (
							<span className="shrink-0 text-[var(--omp-warning)] tabular-nums">
								· {formatDuration(elapsed)}
							</span>
						)}
					</div>
				) : (
					recentTool && (
						<div className="flex min-w-0 items-center gap-1.5 pl-1 font-mono text-omp-xs leading-[1.5]">
							<span className="shrink-0 text-[var(--omp-dim)]">└</span>
							<span className="min-w-0 truncate text-[var(--omp-dim)]">
								{asString(recentTool.tool)}
								{(asString(row.lastIntent) ?? asString(recentTool.args)) && (
									<span>: {asString(row.lastIntent) ?? asString(recentTool.args)}</span>
								)}
							</span>
						</div>
					)
				))}

			{retryState && status === "running" && (
				<div className="flex min-w-0 items-center gap-1.5 pl-1 font-mono text-omp-xs leading-[1.5]">
					<span className="shrink-0 text-[var(--omp-warning)]">└</span>
					<span className="min-w-0 truncate text-[var(--omp-warning)]" title={asString(retryState.errorMessage)}>
						{t(retryRemainingMs > 0 ? "tools.task.retryWait" : "tools.task.retryNow", {
							attempt: asNumber(retryState.attempt) ?? 0,
							max: asNumber(retryState.maxAttempts) ?? 0,
							duration: formatDuration(retryRemainingMs),
							message: asString(retryState.errorMessage) ?? "",
						})}
					</span>
				</div>
			)}
			{retryFailure && status !== "running" && (
				<div className="flex min-w-0 items-center gap-1.5 pl-1 font-mono text-omp-xs leading-[1.5]">
					<span className="shrink-0 text-[var(--omp-error)]">└</span>
					<span className="min-w-0 truncate text-[var(--omp-error)]" title={asString(retryFailure.errorMessage)}>
						{t("tools.task.retryGaveUp", {
							count: asNumber(retryFailure.attempt) ?? 0,
							plural: (asNumber(retryFailure.attempt) ?? 0) === 1 ? "" : "s",
							message: asString(retryFailure.errorMessage) ?? "",
						})}
					</span>
				</div>
			)}

			{review ? (
				<div className="pl-1">
					<ReviewBlock review={review} />
				</div>
			) : (
				<YieldLines value={yieldValue} />
			)}

			{nested.length > 0 && <NestedTaskTree ctx={ctx} depth={depth} list={nested} />}
		</div>
	);
}

/** Finalized agent row: status + verdict/output + nested results + error. */
function ResultAgentRow({ row, depth, ctx }: { row: Record<string, unknown>; depth: number; ctx: TreeCtx }) {
	const t = useT();
	const id = formatTaskId(asString(row.id) ?? "?");
	const description = asString(row.description)?.trim() || undefined;
	const agent = asString(row.agent);
	const aborted = row.aborted === true;
	const error = asString(row.error);
	const mergeFailed = !aborted && (asNumber(row.exitCode) ?? 0) === 0 && !!error;
	const success = !aborted && (asNumber(row.exitCode) ?? 0) === 0 && !error;
	const output = asString(row.output) ?? "";
	const { warning: missingYieldWarning, rest: outputRest } = extractMissingYieldWarning(output);
	const needsWarning = Boolean(missingYieldWarning) && success;
	const assignment = asString(row.assignment) ?? asString(row.task);
	const yieldValue = asRecord(row.extractedToolData)?.yield;
	const yieldItems = normalizeYieldData(yieldValue);
	const review = extractReviewResult(yieldItems);
	const nested = nestedSnapshots(row);
	const retryFailure = asRecord(row.retryFailure);

	const statusKey = aborted
		? "cancelled"
		: needsWarning
			? "warning"
			: success
				? "done"
				: mergeFailed
					? "mergeFailed"
					: "failed";
	const statusColor =
		statusKey === "done"
			? "var(--omp-success)"
			: statusKey === "failed"
				? "var(--omp-error)"
				: statusKey === "cancelled"
					? "var(--omp-error)"
					: "var(--omp-warning)";
	const statusLabel =
		statusKey === "cancelled"
			? t("subagent.status.cancelled")
			: statusKey === "failed"
				? t("subagent.status.failed")
				: statusKey === "done"
					? t("tools.task.badge.done")
					: statusKey === "mergeFailed"
						? t("tools.task.badge.mergeFailed")
						: t("tools.task.badge.warning");

	const hasCustomRendering = review != null || yieldItems.some(item => yieldLabels(item.type).length > 0);

	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex min-w-0 items-center gap-1.5 text-omp-sm">
				<span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
				<span
					className={cx(
						"shrink-0 font-mono font-semibold",
						success && !needsWarning ? "text-[var(--omp-text)]" : "text-[var(--omp-accent)]",
					)}
				>
					{id}
				</span>
				{description && (
					<span className="min-w-0 truncate text-[var(--omp-muted)]" title={description}>
						: {description}
					</span>
				)}
				{agent && agent !== "task" && <AgentBadge agent={agent} />}
				<StatusBadge color={statusColor}>{statusLabel}</StatusBadge>
				{retryFailure && (aborted || !success) && (
					<StatusBadge color="var(--omp-error)">{t("tools.task.badge.rateLimited")}</StatusBadge>
				)}
				<AgentStats
					stats={{
						requests: asNumber(row.requests),
						contextTokens: asNumber(row.contextTokens),
						contextWindow: asNumber(row.contextWindow),
						cost: resultCost(row),
						resolvedModel: asString(row.resolvedModel),
					}}
				/>
				<span className="shrink-0 font-mono text-omp-xxs text-[var(--omp-dim)] tabular-nums">
					· {formatDuration(asNumber(row.durationMs) ?? 0)}
				</span>
				{row.truncated === true && (
					<span className="shrink-0 font-mono text-omp-xxs text-[var(--omp-warning)]">
						[{t("tools.task.badge.truncated")}]
					</span>
				)}
			</div>

			{assignment && (
				<div className="truncate pl-3 text-omp-xs text-[var(--omp-dim)]" title={assignment}>
					{assignment}
				</div>
			)}

			{aborted && asString(row.abortReason) && (
				<div className="flex min-w-0 items-center gap-1.5 pl-1 text-omp-xs">
					<X size={10} className="shrink-0 text-[var(--omp-error)]" />
					<span className="min-w-0 truncate text-[var(--omp-dim)]" title={asString(row.abortReason)}>
						{asString(row.abortReason)}
					</span>
				</div>
			)}

			{review ? (
				<div className="pl-1">
					<ReviewBlock review={review} />
				</div>
			) : (
				<>
					<YieldLines value={yieldValue} />
					{!hasCustomRendering && outputRest.trim() && <ResultOutputPreview text={outputRest} />}
				</>
			)}

			{missingYieldWarning && (
				<div className="truncate pl-3 font-mono text-omp-xs text-[var(--omp-warning)]" title={missingYieldWarning}>
					{missingYieldWarning}
				</div>
			)}

			{nested.length > 0 && <NestedTaskTree ctx={ctx} depth={depth} list={nested} />}

			{!aborted && (asNumber(row.exitCode) ?? 0) === 0 && asString(row.patchPath) && (
				<div className="truncate pl-3 font-mono text-omp-xs text-[var(--omp-dim)]" title={asString(row.patchPath)}>
					{t("tools.task.patch", { path: asString(row.patchPath) ?? "" })}
				</div>
			)}
			{!aborted && (asNumber(row.exitCode) ?? 0) === 0 && !asString(row.patchPath) && asString(row.branchName) && (
				<div className="truncate pl-3 font-mono text-omp-xs text-[var(--omp-dim)]" title={asString(row.branchName)}>
					{t("tools.task.branch", { name: asString(row.branchName) ?? "" })}
				</div>
			)}

			{error && (!success || mergeFailed) && (!aborted || error !== asString(row.abortReason)) && (
				<div
					className={cx(
						"truncate pl-3 text-omp-xs",
						mergeFailed ? "text-[var(--omp-warning)]" : "text-[var(--omp-error)]",
					)}
					title={error}
				>
					{error}
				</div>
			)}
		</div>
	);
}

/** Collapsed output preview: first lines + "… N more lines". */
function ResultOutputPreview({ text }: { text: string }) {
	const t = useT();
	const { head, omitted } = headLines(text, OUTPUT_PREVIEW_LINES);
	return (
		<div className="rounded bg-[var(--omp-code-bg)] px-2 py-1">
			<pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-omp-xs leading-[1.45] text-[var(--omp-tool-output)]">
				{head}
			</pre>
			{omitted > 0 && (
				<div className="font-mono text-omp-xs text-[var(--omp-dim)]">
					{t("tools.read.more", { count: omitted, plural: omitted === 1 ? "" : "s" })}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Task renderer
// ---------------------------------------------------------------------------

/** Task (subagent spawn): agent badge, name, status, live agent tree. */
export function TaskRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const agent = typeof args.agent === "string" ? args.agent : "task";
	const name = typeof args.name === "string" ? args.name : null;
	const description =
		typeof args.i === "string" ? args.i : typeof args.description === "string" ? args.description : "";
	const taskText = typeof args.task === "string" ? args.task : "";

	const statusLabel = isError
		? t("subagent.status.failed")
		: isPartial
			? t("subagent.status.started")
			: t("subagent.status.completed");
	const statusColor = isError ? "var(--omp-error)" : isPartial ? "var(--omp-accent)" : "var(--omp-success)";

	const effective = isPartial && partialResult != null ? partialResult : result;
	const details = resultDetails(result) ?? resultDetails(partialResult);
	const text = resultText(effective);

	const results = asArray(details?.results)
		.map(asRecord)
		.filter((r): r is Record<string, unknown> => r != null);
	const progress = asArray(details?.progress)
		.map(asRecord)
		.filter((r): r is Record<string, unknown> => r != null);
	const totalDurationMs = asNumber(details?.totalDurationMs) ?? 0;
	const hasResults = results.length > 0;
	// Result rows win once any exist; progress rows for spawns without a result
	// (a mixed call's async subset) render as a supplement below.
	const supplemental = hasResults
		? progress.filter(row => !results.some(res => asString(res.id) === asString(row.id)))
		: [];

	// Live rows carry elapsed times and retry countdowns — tick once a second
	// while the call runs so they stay fresh between partial emissions.
	const now = useNowTick(isPartial);

	// Run-summary counts: one pass derives footer counts + request total.
	let abortedCount = 0;
	let failCount = 0;
	let mergeFailedCount = 0;
	let successCount = 0;
	let requestTotal = 0;
	for (const row of results) {
		requestTotal += asNumber(row.requests) ?? 0;
		if (row.aborted === true) abortedCount++;
		else if ((asNumber(row.exitCode) ?? 0) !== 0) failCount++;
		else if (asString(row.error)) mergeFailedCount++;
		else successCount++;
	}
	const summaryParts: ReactNode[] = [];
	if (abortedCount > 0)
		summaryParts.push(
			<span key="aborted" className="text-[var(--omp-error)]">
				{t("tools.task.footer.aborted", { count: abortedCount })}
			</span>,
		);
	if (successCount > 0)
		summaryParts.push(
			<span key="succeeded" className="text-[var(--omp-success)]">
				{t("tools.task.footer.succeeded", { count: successCount })}
			</span>,
		);
	if (mergeFailedCount > 0)
		summaryParts.push(
			<span key="merge" className="text-[var(--omp-warning)]">
				{t("tools.task.footer.mergeFailed", { count: mergeFailedCount })}
			</span>,
		);
	if (failCount > 0)
		summaryParts.push(
			<span key="failed" className="text-[var(--omp-error)]">
				{t("tools.task.footer.failed", { count: failCount })}
			</span>,
		);
	if (requestTotal > 0)
		summaryParts.push(<span key="req">{t("tools.task.footer.requests", { count: requestTotal })}</span>);
	summaryParts.push(<span key="duration">{formatDuration(totalDurationMs)}</span>);

	// Cycle guard for nested task trees: one set per render pass, threaded down.
	const ctx: TreeCtx = { seen: new Set<object>(), now };

	const markerIndex = (() => {
		const lines = text.split("\n");
		return lines.findIndex(
			line =>
				line.includes("<system-notification>") ||
				line.startsWith("Applied patches:") ||
				line.startsWith("No changes to apply."),
		);
	})();
	const trailingLines =
		markerIndex >= 0
			? text
					.split("\n")
					.slice(markerIndex)
					.filter(line => line.trim())
			: [];

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 text-omp-sm">
				<Bot size={12} className="shrink-0 text-[var(--omp-status-subagents)]" />
				{name && <span className="font-mono font-semibold text-[var(--omp-text)]">{name}</span>}
				<span className="rounded bg-[var(--omp-status-subagents)]/15 px-1 py-px font-mono text-omp-xxs font-medium text-[var(--omp-status-subagents)]">
					{agent}
				</span>
				<span
					className={cx("ml-auto flex items-center gap-1 text-omp-xs font-medium")}
					style={{ color: statusColor }}
				>
					<span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
					{statusLabel}
				</span>
			</div>
			{description && <div className="text-omp-sm text-[var(--omp-muted)]">{description}</div>}
			{taskText && (
				<div className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--omp-code-bg)] px-2 py-1.5 text-omp-sm leading-[1.45] text-[var(--omp-tool-output)]">
					{taskText}
				</div>
			)}

			{!hasResults && progress.length > 0 && (
				<div className="flex max-h-80 flex-col gap-1.5 overflow-auto pr-0.5">
					{orderProgressForDisplay(progress).map((row, i) => (
						<ProgressAgentRow key={`${asString(row.id) ?? i}-${i}`} ctx={ctx} depth={0} row={row} />
					))}
				</div>
			)}

			{hasResults && (
				<div className="flex max-h-96 flex-col gap-1.5 overflow-auto pr-0.5">
					{orderResultsForDisplay(results).map((row, i) => (
						<ResultAgentRow key={`${asString(row.id) ?? i}-${i}`} ctx={ctx} depth={0} row={row} />
					))}
					{supplemental.length > 0 &&
						orderProgressForDisplay(supplemental).map((row, i) => (
							<ProgressAgentRow key={`sup-${asString(row.id) ?? i}-${i}`} ctx={ctx} depth={0} row={row} />
						))}
				</div>
			)}

			{hasResults && (
				<div className="font-mono text-omp-xs text-[var(--omp-dim)]">
					[
					{summaryParts.map((part, i) => (
						<span key={i}>
							{part}
							{i < summaryParts.length - 1 && " · "}
						</span>
					))}
					]
				</div>
			)}

			{trailingLines.map((line, i) => (
				<div key={i} className="font-mono text-omp-xs text-[var(--omp-dim)]">
					{line}
				</div>
			))}

			{!hasResults && progress.length === 0 && !text.trim() && details != null && (
				<div className="text-omp-sm text-[var(--omp-dim)]">{t("tools.task.noResults")}</div>
			)}

			{details == null && text && (
				<pre
					className={cx(
						"max-h-40 overflow-auto whitespace-pre-wrap rounded px-2 py-1.5 font-mono text-omp-sm leading-[1.45]",
						isError
							? "bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)]"
							: "bg-[var(--omp-code-bg)] text-[var(--omp-tool-output)]",
					)}
				>
					{text}
				</pre>
			)}
		</div>
	);
}
