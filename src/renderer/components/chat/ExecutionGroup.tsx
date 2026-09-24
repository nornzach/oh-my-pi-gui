import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useToolsStore } from "../../stores/tools";

interface ExecutionGroupProps {
	children: ReactNode;
	className?: string;
	expanded: boolean;
	failureCount?: number;
	live?: boolean;
	onExpandedChange: (expanded: boolean) => void;
	stepCount: number;
	toolCallIds: readonly string[];
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

	const active = live || running > 0;
	const state = active ? "running" : failed > 0 ? "failed" : "complete";

	const summary =
		failed > 0
			? t("chat.process.statusFailed", { failed, total: stepCount })
			: running > 0 || live
				? t("chat.process.statusRunning", { running: Math.max(1, running), total: stepCount })
				: t("chat.process.statusComplete", { total: stepCount });

	return (
		<section className={cx("omp-execution-group", className)} data-state={state}>
			<button
				aria-expanded={expanded}
				className="omp-execution-group-header omp-pressable flex w-full min-w-0 items-center gap-2 text-left"
				onClick={() => onExpandedChange(!expanded)}
				type="button"
				aria-label={`${t("chat.process.title")}: ${summary}`}
			>
				{active && (
					<span
						aria-hidden="true"
						className="omp-execution-group-live-dot h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--omp-accent)]"
					/>
				)}
				<span className="omp-execution-group-title shrink-0 text-omp-sm font-medium text-[var(--omp-text)]">
					{t("chat.process.title")}
				</span>
				<span
					aria-atomic="true"
					aria-live="polite"
					className={cx(
						"omp-execution-group-summary min-w-0 flex-1 truncate text-omp-xs",
						state === "running" && "text-[var(--omp-accent)]",
						state === "failed" && "text-[var(--omp-error)]",
						state === "complete" && "text-[var(--omp-muted)]",
					)}
					role="status"
				>
					{summary}
				</span>
				<ChevronRight
					aria-hidden="true"
					className={cx("omp-disclosure-chevron shrink-0 text-[var(--omp-dim)]", expanded && "rotate-90")}
					size={14}
				/>
			</button>
			{expanded && <div className="omp-execution-group-body">{children}</div>}
		</section>
	);
}
