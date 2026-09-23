/**
 * Grouped read-tool card (TUI read-tool-group parity): one collapsible read
 * renders inline (`● Read <path:sel>`); consecutive reads fold into a
 * `Read (N)` tree with same-file selector merges. Per-call status resolves
 * from the tools store (same source as ToolCard). Expanding reveals the
 * individual read cards with full content.
 */

import { ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { mergeReadGroupEntries, type ReadGroupEntry, type ReadGroupUsage, readGroupTitle } from "../../lib/read-group";
import { useToolsStore } from "../../stores/tools";
import { UsageRow } from "../chat/UsageRow";
import { type RunningIndicator, ToolCard } from "./ToolCard";

function statusOf(status: string | undefined): "pending" | "success" | "error" | "aborted" {
	if (status === "error") return "error";
	if (status === "aborted") return "aborted";
	if (status === "pending" || status === "running") return "pending";
	return "success";
}

/** Header dot for a folded read group: live, failed, interrupted, or done. */
function statusDot(status: "pending" | "success" | "error" | "aborted" | undefined): string {
	if (status === "error") return "bg-(--omp-error)";
	if (status === "aborted") return "bg-(--omp-warning)";
	return "bg-(--omp-accent)";
}

export function ReadGroupCard({
	entries,
	inset,
	runningIndicator = "spinner",
	usage,
}: {
	entries: ReadGroupEntry[];
	inset?: boolean;
	runningIndicator?: RunningIndicator;
	/** Usage carried from fully-consumed assistant turns (TUI parity). */
	usage?: ReadGroupUsage[];
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const rows = mergeReadGroupEntries(entries);
	const single = entries.length === 1;
	const pad = inset ? "py-0.5" : "ps-(--omp-editorial-inset) pe-(--omp-editorial-edge) py-0.5";

	// One primitive snapshot for this group's calls: unrelated tool events may
	// replace the store Map without re-rendering historical read groups.
	const statusKey = useToolsStore(s =>
		entries.map(entry => statusOf(s.activeTools.get(entry.toolKey)?.status)).join("|"),
	);
	const statuses = useMemo(() => {
		const values = statusKey.split("|") as Array<"pending" | "success" | "error" | "aborted">;
		return new Map(entries.map((entry, index) => [entry.toolKey, values[index] ?? "success"]));
	}, [entries, statusKey]);
	const anyPending = entries.some(entry => statuses.get(entry.toolKey) === "pending");
	const anyError = entries.some(entry => statuses.get(entry.toolKey) === "error");
	const anyAborted = entries.some(entry => statuses.get(entry.toolKey) === "aborted");
	const groupStatus = anyError ? "error" : anyAborted ? "aborted" : "success";

	if (single) {
		const entry = entries[0]!;
		const status = statuses.get(entry.toolKey);
		return (
			<div className={cx("omp-read-group", pad)}>
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(value => !value)}
					className="omp-read-group-header flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-omp-md text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-text)"
				>
					{status === "pending" && runningIndicator === "spinner" ? (
						<Loader2 size={11} className="shrink-0 animate-spin text-(--omp-accent)" />
					) : status === "pending" ? (
						<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--omp-accent)" />
					) : (
						<span aria-hidden className={cx("h-1.5 w-1.5 shrink-0 rounded-full", statusDot(status))} />
					)}
					<span className="font-medium">{t("tools.read.label")}</span>
					<span className="truncate font-mono text-omp-sm text-(--omp-accent)">
						{entry.path}
						{entry.selector ? `:${entry.selector}` : ""}
					</span>
					<ChevronRight size={12} className={cx("omp-disclosure-chevron ml-auto shrink-0", open && "rotate-90")} />
				</button>
				{open && (
					<div className="omp-read-group-body ml-4 mt-1">
						<ToolCard toolCallId={entry.toolKey} toolName="read" args={entry.args} runningIndicator="dot" />
					</div>
				)}
				{usage?.map((item, index) => (
					<UsageRow key={index} message={item} />
				))}
			</div>
		);
	}

	return (
		<div className={cx("omp-read-group", pad)}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(value => !value)}
				className="omp-read-group-header flex w-full items-center gap-2 rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-1.5 text-left text-omp-md text-(--omp-muted) hover:border-(--omp-border) hover:text-(--omp-text)"
			>
				<ChevronRight size={13} className={cx("omp-disclosure-chevron shrink-0", open && "rotate-90")} />
				{anyPending && runningIndicator === "spinner" ? (
					<Loader2 size={12} className="shrink-0 animate-spin text-(--omp-accent)" />
				) : anyPending ? (
					<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--omp-accent)" />
				) : (
					<span aria-hidden className={cx("h-1.5 w-1.5 shrink-0 rounded-full", statusDot(groupStatus))} />
				)}
				<span className="font-medium text-(--omp-text)">{readGroupTitle(entries)}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-omp-xs text-(--omp-dim)">
					{rows.length === 1 ? rows[0]!.path : t("readGroup.files", { count: rows.length })}
				</span>
			</button>
			{/* Tree preview rows (always visible, TUI parity) */}
			<div className="omp-read-group-preview ml-6 mt-0.5 font-mono text-omp-sm leading-[1.6] text-(--omp-muted)">
				{rows.map((row, index) => (
					<div key={`${row.path}:${index}`} className="flex items-baseline gap-2 truncate">
						<span className="shrink-0 text-(--omp-dim)">{index === rows.length - 1 ? "└─" : "├─"}</span>
						<span className="truncate text-(--omp-accent)">{row.path}</span>
						{row.selector && <span className="shrink-0 text-(--omp-dim)">:{row.selector}</span>}
						{row.toolKeys.some(key => statuses.get(key) === "pending") && (
							<span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--omp-accent)" />
						)}
						{!row.toolKeys.some(key => statuses.get(key) === "pending") &&
							row.toolKeys.some(key => statuses.get(key) === "error") && (
								<span className="shrink-0 text-(--omp-error)">✗</span>
							)}
						{!row.toolKeys.some(key => statuses.get(key) === "pending") &&
							!row.toolKeys.some(key => statuses.get(key) === "error") &&
							row.toolKeys.some(key => statuses.get(key) === "aborted") && (
								<span className="shrink-0 text-(--omp-warning)">⊘</span>
							)}
					</div>
				))}
			</div>
			{open && (
				<div className="omp-read-group-body ml-6 mt-1 space-y-1.5">
					{entries.map(entry => (
						<ToolCard
							key={entry.toolKey}
							toolCallId={entry.toolKey}
							toolName="read"
							args={entry.args}
							runningIndicator="dot"
						/>
					))}
				</div>
			)}
			{usage?.map((item, index) => (
				<UsageRow key={index} message={item} />
			))}
		</div>
	);
}
