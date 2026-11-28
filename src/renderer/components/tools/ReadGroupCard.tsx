/**
 * Grouped read-tool card (TUI read-tool-group parity): one collapsible read
 * renders inline (`● Read <path:sel>`); consecutive reads fold into a
 * `Read (N)` tree with same-file selector merges. Per-call status resolves
 * from the tools store (same source as ToolCard). Expanding reveals the
 * individual read cards with full content.
 */

import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { mergeReadGroupEntries, type ReadGroupEntry, type ReadGroupUsage } from "../../lib/read-group";
import { useToolsStore } from "../../stores/tools";
import { UsageRow } from "../chat/UsageRow";
import { Collapse, CollapseButton } from "../common/Collapse";
import { type RunningIndicator, ToolCard } from "./ToolCard";

function statusOf(status: string | undefined): "pending" | "success" | "error" | "aborted" {
	if (status === "error") return "error";
	if (status === "aborted") return "aborted";
	if (status === "pending" || status === "running") return "pending";
	return "success";
}

/** Header dot for a folded read group: live, failed, interrupted, or done. */
function statusDot(status: "pending" | "success" | "error" | "aborted"): string {
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
	const [firstFile] = rows;
	const summary =
		rows.length === 1 && firstFile
			? single && firstFile.selector
				? `${firstFile.path}:${firstFile.selector}`
				: firstFile.path
			: t("readGroup.files", { count: rows.length });

	// One primitive snapshot for this group's calls: unrelated tool events may
	// replace the store Map without re-rendering historical read groups.
	const statusKey = useToolsStore(s =>
		entries.map(entry => statusOf(s.activeTools.get(entry.toolKey)?.status)).join("|"),
	);
	const statuses = statusKey.split("|");
	const anyPending = statuses.includes("pending");
	const groupStatus = statuses.includes("error") ? "error" : statuses.includes("aborted") ? "aborted" : "success";

	return (
		<div className="omp-read-group" data-inset={inset || undefined}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(value => !value)}
				className="omp-read-group-header omp-tool-header flex w-full items-center gap-2 px-2 py-1 text-left text-omp-sm"
			>
				<span aria-hidden className="flex h-3 w-3 shrink-0 items-center justify-center">
					{anyPending && runningIndicator === "spinner" ? (
						<Loader2 size={12} className="shrink-0 animate-spin text-(--omp-accent)" />
					) : (
						<span className={cx("h-1.5 w-1.5 rounded-full", statusDot(anyPending ? "pending" : groupStatus))} />
					)}
				</span>
				<span className="omp-tool-name shrink-0 font-medium text-(--omp-text)">{t("tools.read.label")}</span>
				<span
					title={summary}
					className="omp-tool-summary min-w-0 flex-1 truncate font-mono text-omp-sm text-(--omp-muted)"
				>
					{summary}
				</span>
				{!single && <span className="shrink-0 text-omp-xs tabular-nums text-(--omp-dim)">({entries.length})</span>}
				<ChevronRight
					size={13}
					className={cx("omp-tool-chevron omp-disclosure-chevron shrink-0 text-(--omp-dim)", open && "rotate-90")}
				/>
			</button>
			<Collapse open={open}>
				<div className="omp-read-group-body ml-4 mt-1 space-y-1.5">
					{entries.map(entry => (
						<ToolCard
							key={entry.toolKey}
							toolCallId={entry.toolKey}
							toolName="read"
							args={entry.args}
							runningIndicator="dot"
						/>
					))}
					<CollapseButton label={t("readGroup.collapse")} onClick={() => setOpen(false)} />
				</div>
			</Collapse>
			{usage?.map((item, index) => (
				<UsageRow key={index} message={item} />
			))}
		</div>
	);
}
