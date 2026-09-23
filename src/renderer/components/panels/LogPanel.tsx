/**
 * Log panel: subscribes to batched log:line IPC, keeps a 1000-line ring buffer,
 * with search filtering, level filter, and pin-aware auto-scroll.
 */

import { ArrowDown, RotateCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogBatch } from "../../../shared/ipc-types";
import { copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { Button } from "../common";

const MAX_LINES = 1000;

type LogLevel = "info" | "warn" | "error" | "other";

interface LogLine {
	seq: number;
	text: string;
	level: LogLevel;
}

const LEVEL_CLASS: Record<LogLevel, string> = {
	info: "text-(--omp-muted)",
	warn: "text-(--omp-warning)",
	error: "text-(--omp-error)",
	other: "text-(--omp-dim)",
};

const LEVEL_LABEL_KEY = {
	all: "logPanel.level.all",
	info: "logPanel.level.info",
	warn: "logPanel.level.warn",
	error: "logPanel.level.error",
} as const;

function detectLevel(text: string): LogLevel {
	const lower = text.toLowerCase();
	if (/\b(error|err!|fatal)\b/.test(lower)) return "error";
	if (/\b(warn|warning)\b/.test(lower)) return "warn";
	if (/\binfo\b/.test(lower)) return "info";
	return "other";
}

export function LogPanel() {
	const t = useT();
	const [lines, setLines] = useState<LogLine[]>([]);
	const [query, setQuery] = useState("");
	const [levelFilter, setLevelFilter] = useState<"all" | LogLevel>("all");
	const [pinned, setPinned] = useState(true);
	const scrollRef = useRef<HTMLDivElement>(null);

	const [error, setError] = useState<string | null>(null);

	const applyBatch = useCallback((batch: LogBatch): void => {
		setLines(previous => {
			const all = new Map(previous.map(line => [line.seq, line]));
			batch.lines.forEach((text, index) => {
				const seq = batch.nextSequence - batch.lines.length + index;
				all.set(seq, { seq, text, level: detectLevel(text) });
			});
			return [...all.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_LINES);
		});
	}, []);

	const reload = useCallback((): void => {
		setError(null);
		void window.omp.runtime
			.logSnapshot()
			.then(applyBatch)
			.catch(cause => setError(String(cause)));
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

	return (
		<div className="flex h-full flex-col">
			{error && (
				<p role="alert" className="px-3 text-omp-sm text-(--omp-error)">
					{error}
				</p>
			)}
			<div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
				<span className="text-omp-xs font-medium tracking-widest text-(--omp-dim) uppercase">
					{t("logPanel.title")}
				</span>
				<span className="text-omp-xs tabular-nums text-(--omp-dim)">{filtered.length}</span>
				<div className="ml-auto flex items-center gap-0.5">
					{(["all", "info", "warn", "error"] as const).map(level => (
						<button
							className={`rounded px-1.5 py-0.5 text-omp-xs transition-colors ${
								levelFilter === level
									? "bg-(--omp-selected-bg) text-(--omp-text)"
									: "text-(--omp-dim) hover:text-(--omp-text)"
							}`}
							aria-pressed={levelFilter === level}
							key={level}
							onClick={() => setLevelFilter(level)}
							type="button"
						>
							{t(LEVEL_LABEL_KEY[level])}
						</button>
					))}
				</div>
			</div>
			<div className="flex flex-wrap gap-2 px-3 pb-2 text-omp-xs">
				<button
					type="button"
					disabled={filtered.length === 0}
					onClick={() =>
						void copyText(filtered.map(line => line.text).join("\n")).then(ok => {
							if (!ok) setError(t("copySelector.failed"));
						})
					}
				>
					{t("logPanel.copy")}
				</button>
				<button type="button" disabled={filtered.length === 0} onClick={exportLogs}>
					{t("logPanel.export")}
				</button>
				<span className="text-(--omp-dim)">{t("logPanel.scope")}</span>
			</div>
			<div className="relative px-3 pb-1.5">
				<Search
					className="pointer-events-none absolute top-1/2 left-5.5 -translate-y-1/2 text-(--omp-dim)"
					size={11}
				/>
				<input
					aria-label={t("logPanel.searchLabel")}
					className="w-full rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) py-1 pr-7 pl-6.5 text-omp-sm text-(--omp-text) placeholder:text-(--omp-dim) focus:border-(--omp-border-accent) focus:outline-none"
					onChange={event => setQuery(event.target.value)}
					placeholder={t("logPanel.placeholder")}
					value={query}
				/>
				{query && (
					<button
						aria-label={t("logPanel.clearSearch")}
						className="absolute top-1/2 right-5 -translate-y-1/2 text-(--omp-dim) hover:text-(--omp-text)"
						onClick={() => setQuery("")}
						type="button"
					>
						<X size={11} />
					</button>
				)}
			</div>
			<div className="relative min-h-0 flex-1">
				<div
					className="h-full overflow-y-auto px-3 py-1 font-mono text-omp-xs leading-[1.5]"
					onScroll={onScroll}
					ref={scrollRef}
				>
					{error ? (
						<div className="flex flex-col items-center gap-2 py-8 text-center font-sans">
							<p role="alert" className="text-omp-sm text-(--omp-error)">
								{error}
							</p>
							<Button icon={<RotateCw size={12} />} onClick={reload} size="sm" variant="secondary">
								{t("common.retry")}
							</Button>
						</div>
					) : filtered.length === 0 ? (
						<div className="py-8 text-center font-sans text-omp-sm text-(--omp-dim)">
							{lines.length === 0 ? t("logPanel.waiting") : t("logPanel.noMatch")}
						</div>
					) : (
						filtered.map(line => (
							<div className={`break-all whitespace-pre-wrap ${LEVEL_CLASS[line.level]}`} key={line.seq}>
								{line.text}
							</div>
						))
					)}
				</div>
				{!pinned && (
					<button
						aria-label={t("logPanel.jumpLabel")}
						className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full border border-(--omp-border-muted) bg-(--omp-bg-elevated) px-2 py-1 text-omp-xs text-(--omp-muted) shadow-(--omp-shadow-sm) transition-colors hover:text-(--omp-text)"
						onClick={jumpToBottom}
						type="button"
					>
						<ArrowDown size={10} />
						{t("logPanel.latest")}
					</button>
				)}
			</div>
		</div>
	);
}
