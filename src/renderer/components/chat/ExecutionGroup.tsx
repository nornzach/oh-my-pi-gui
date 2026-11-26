import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useToolsStore } from "../../stores/tools";
import { Collapse, CollapseButton } from "../common/Collapse";
import { getToolSummary } from "../tools";

interface ExecutionGroupProps {
	children: ReactNode;
	className?: string;
	expanded: boolean;
	failureCount?: number;
	live?: boolean;
	onExpandedChange: (expanded: boolean) => void;
	stepCount: number;
	toolCallIds: readonly string[];
	tool?: { id: string; name: string; args: Record<string, unknown>; intent?: string };
}

/**
 * One quiet disclosure for a reasoning/tool phase. Its open state is owned by
 * ChatStream so streaming updates and live-to-final row replacement cannot
 * override the user's choice.
 */
export function ExecutionGroup({
	children,
	className,
	expanded,
	failureCount = 0,
	live = false,
	onExpandedChange,
	stepCount,
	toolCallIds,
	tool,
}: ExecutionGroupProps) {
	const t = useT();
	// Primitive selector: encode (running, failed) so unrelated tool events —
	// partial results on cards outside this group — never re-render the group.
	const encoded = useToolsStore(s => {
		let running = 0;
		let failed = 0;
		for (const id of toolCallIds) {
			const entry = s.activeTools.get(id);
			if (entry?.status === "pending" || entry?.status === "running") running++;
			else if (entry?.status === "error" || entry?.isError) failed++;
		}
		return `${running}:${failed}`;
	});
	const [running, toolFailures] = encoded.split(":").map(Number);
	const failed = toolFailures + failureCount;
	const activity = useToolsStore(s => {
		if (!tool) return undefined;
		const entry = s.activeTools.get(tool.id);
		const detail = getToolSummary(tool.name, entry?.args ?? tool.args, entry?.result, entry?.intent ?? tool.intent);
		return detail ? `${tool.name} · ${detail}` : tool.name;
	});

	const active = live || running > 0;
	const state = active ? "running" : failed > 0 ? "failed" : "complete";

	const plural = stepCount === 1 ? "" : "s";
	const summary =
		failed > 0
			? t("chat.process.statusFailed", { failed, total: stepCount, plural })
			: running > 0 || live
				? t("chat.process.statusRunning", { running: Math.max(1, running), total: stepCount, plural })
				: t("chat.process.statusComplete", { total: stepCount, plural });

	return (
		<section className={cx("omp-execution-group", className)} data-state={state}>
			<button
				aria-expanded={expanded}
				className="omp-execution-group-header omp-pressable flex w-full min-w-0 items-center gap-2 text-left"
				onClick={() => onExpandedChange(!expanded)}
				type="button"
				aria-label={[summary, activity].filter(Boolean).join(" · ")}
			>
				<ChevronRight
					aria-hidden="true"
					className={cx("omp-disclosure-chevron shrink-0 text-[var(--omp-dim)]", expanded && "rotate-90")}
					size={12}
				/>
				{active && (
					<span aria-hidden="true" className="omp-execution-group-live-dot omp-working-dot omp-working-dot--sm" />
				)}
				<span className="omp-execution-group-title shrink-0 text-omp-sm font-medium text-[var(--omp-text)]">
					{t("chat.process.title")}
				</span>
				<span
					aria-atomic="true"
					aria-live="polite"
					className={cx(
						"omp-execution-group-summary min-w-0 flex-1 truncate text-omp-xs",
						state === "running" && "omp-shimmer-text",
						state === "failed" && "text-[var(--omp-error)]",
						state === "complete" && "text-[var(--omp-muted)]",
					)}
					role="status"
				>
					{summary}
				</span>
				{activity && (
					<span className="min-w-0 truncate text-omp-xs text-(--omp-muted)" title={activity}>
						{activity}
					</span>
				)}
			</button>
			<Collapse open={expanded}>
				<div className="omp-execution-group-body">
					{children}
					<CollapseButton label={t("chat.process.collapse")} onClick={() => onExpandedChange(false)} />
				</div>
			</Collapse>
		</section>
	);
}
