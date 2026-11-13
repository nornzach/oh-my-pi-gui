/**
 * Log panel: subscribes to batched log:line IPC, keeps a 1000-line ring buffer,
 * with search filtering, level filter, and pin-aware auto-scroll.
 */

import { ArrowDown, Copy, Download, RotateCw, ScrollText, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogBatch } from "../../../shared/ipc-types";
import { describeError } from "../../lib/errors";
import { copyText, cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { toast } from "../../stores/toast";
import { Button } from "../common";
import { Glide } from "../common/Glide";
import { type LogLevel, type ParsedLogLine, parseLogLine } from "./log-line";
import { PanelEmpty, PanelSearch, PanelToolbar, ToolbarIconButton } from "./workspace-ui";

const MAX_LINES = 1000;

interface LogLine extends ParsedLogLine {
	seq: number;
	text: string;
}

const LEVEL_CLASS: Record<LogLevel, string> = {
	info: "text-(--omp-text-secondary)",
	warn: "text-(--omp-warning)",
	error: "text-(--omp-error)",
	other: "text-(--omp-muted)",
};

const LEVEL_LABEL_KEY = {
	all: "logPanel.level.all",
	info: "logPanel.level.info",
	warn: "logPanel.level.warn",
	error: "logPanel.level.error",
} as const;

export function LogPanel() {
	const t = useT();
	const [lines, setLines] = useState<LogLine[]>([]);
	const [query, setQuery] = useState("");
	const [levelFilter, setLevelFilter] = useState<"all" | LogLevel>("all");
	const [pinned, setPinned] = useState(true);
	const [openLines, setOpenLines] = useState<ReadonlySet<number>>(new Set());
	const scrollRef = useRef<HTMLDivElement>(null);

	const [error, setError] = useState<string | null>(null);

	const applyBatch = useCallback((batch: LogBatch): void => {
		setLines(previous => {
			const all = new Map(previous.map(line => [line.seq, line]));
			batch.lines.forEach((text, index) => {
				const seq = batch.nextSequence - batch.lines.length + index;
				all.set(seq, { seq, text, ...parseLogLine(text) });
			});
			return [...all.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_LINES);
		});
	}, []);

	const reload = useCallback((): void => {
		setError(null);
		void window.omp.runtime
			.logSnapshot()
			.then(applyBatch)
			.catch(cause => setError(describeError(cause)));
	}, [applyBatch]);

	useEffect(() => {
		const unsubscribe = window.omp.events.onLogBatch(applyBatch);
		void reload();
		return unsubscribe;
	}, [applyBatch, reload]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return lines.filter(line => {
			if (levelFilter !== "all" && line.level !== levelFilter) return false;
			return q.length === 0 || line.text.toLowerCase().includes(q);
		});
	}, [lines, query, levelFilter]);

	// Follow the tail whenever pinned and new (filtered) lines render.
	useEffect(() => {
		if (!pinned) return;
		const el = scrollRef.current;
		if (el) el.scrollTop = filtered.length === 0 ? 0 : el.scrollHeight;
	}, [pinned, filtered]);

	const exportLogs = () => {
		const url = URL.createObjectURL(
			new Blob([filtered.map(line => line.text).join("\n")], { type: "text/plain;charset=utf-8" }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `omp-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
		anchor.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
	};

	const jumpToBottom = () => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
		setPinned(true);
	};

	const counts = useMemo(() => {
		const out: Record<"all" | LogLevel, number> = { all: lines.length, info: 0, warn: 0, error: 0, other: 0 };
		for (const line of lines) out[line.level]++;
		return out;
	}, [lines]);

	return (
		<div className="flex h-full flex-col">
			<span className="sr-only">{t("logPanel.title")}</span>
			<PanelToolbar>
				<PanelSearch
					label={t("logPanel.searchLabel")}
					placeholder={t("logPanel.placeholder")}
					value={query}
					onChange={setQuery}
				/>
				<ToolbarIconButton
					label={t("logPanel.copy")}
					disabled={filtered.length === 0}
					onClick={() =>
						void copyText(filtered.map(line => line.text).join("\n")).then(ok => {
							if (!ok) toast({ variant: "error", message: t("copySelector.failed") });
						})
					}
				>
					<Copy size={14} />
				</ToolbarIconButton>
				<ToolbarIconButton label={t("logPanel.export")} disabled={filtered.length === 0} onClick={exportLogs}>
					<Download size={14} />
				</ToolbarIconButton>
			</PanelToolbar>
			<div className="flex h-8 shrink-0 items-center gap-2 px-3 pb-1">
				<div className="omp-segmented" role="group" aria-label={t("logPanel.levelLabel")}>
					<Glide activeKey={levelFilter} selector='[aria-pressed="true"]' variant="thumb" />
					{(["all", "info", "warn", "error"] as const).map(level => (
						<button
							className="flex h-6 items-center gap-1 px-2 text-omp-xs font-medium"
							aria-pressed={levelFilter === level}
							key={level}
							onClick={() => setLevelFilter(level)}
							type="button"
						>
							{t(LEVEL_LABEL_KEY[level])}
							{level !== "all" && counts[level] > 0 && (
								<span
									className={cx(
										"tabular-nums",
										level === "error"
											? "text-(--omp-error)"
											: level === "warn"
												? "text-(--omp-warning)"
												: "text-(--omp-dim)",
									)}
								>
									{counts[level]}
								</span>
							)}
						</button>
					))}
				</div>
				<span className="ml-auto truncate text-omp-xs tabular-nums text-(--omp-dim)" title={t("logPanel.scope")}>
					{t("logPanel.lines", { count: filtered.length })}
				</span>
			</div>
			<div className="relative min-h-0 flex-1 border-t border-(--omp-border-muted) bg-(--omp-code-bg)">
				<div
					className="h-full overflow-y-auto py-1.5 font-mono text-omp-xs leading-[1.55]"
					onScroll={onScroll}
					ref={scrollRef}
				>
					{error ? (
						<PanelEmpty
							icon={TriangleAlert}
							tone="error"
							title={<span role="alert">{error}</span>}
							action={
								<Button icon={<RotateCw size={12} />} onClick={reload} size="sm" variant="secondary">
									{t("common.retry")}
								</Button>
							}
						/>
					) : filtered.length === 0 ? (
						<PanelEmpty
							icon={ScrollText}
							title={lines.length === 0 ? t("logPanel.waiting") : t("logPanel.noMatch")}
						/>
					) : (
						filtered.map(line => {
							const open = openLines.has(line.seq);
							return (
								<div
									className={cx("omp-log-line px-3 py-0.5", line.fields && "cursor-pointer")}
									data-level={line.level}
									data-open={open || undefined}
									key={line.seq}
									onClick={() => {
										if (!line.fields || window.getSelection()?.toString()) return;
										setOpenLines(previous => {
											const next = new Set(previous);
											if (next.has(line.seq)) next.delete(line.seq);
											else next.add(line.seq);
											return next;
										});
									}}
								>
									<div className="flex min-w-0 items-baseline gap-2">
										{line.time && <span className="shrink-0 tabular-nums text-(--omp-dim)">{line.time}</span>}
										{line.levelName && (
											<span className={cx("w-[5ch] shrink-0 truncate", LEVEL_CLASS[line.level])}>
												{line.levelName}
											</span>
										)}
										<span
											className={cx(
												"min-w-0 flex-1 break-words whitespace-pre-wrap",
												line.levelName ? "text-(--omp-text)" : LEVEL_CLASS[line.level],
											)}
										>
											{line.message}
										</span>
									</div>
									{line.fields && (
										<div
											className={cx(
												"omp-log-fields break-all text-(--omp-dim)",
												line.time && "pl-[calc(8ch+0.5rem)]",
												!open && "line-clamp-1",
											)}
										>
											{line.fields}
										</div>
									)}
								</div>
							);
						})
					)}
				</div>
				{!pinned && (
					<button
						aria-label={t("logPanel.jumpLabel")}
						className="omp-pressable omp-pop-in absolute right-3 bottom-3 flex items-center gap-1 rounded-full border border-(--omp-border-muted) bg-(--omp-bg-elevated) px-2.5 py-1 text-omp-xs text-(--omp-muted) shadow-(--omp-shadow-sm) hover:text-(--omp-text)"
						onClick={jumpToBottom}
						type="button"
					>
						<ArrowDown size={11} />
						{t("logPanel.latest")}
					</button>
				)}
			</div>
		</div>
	);
}
