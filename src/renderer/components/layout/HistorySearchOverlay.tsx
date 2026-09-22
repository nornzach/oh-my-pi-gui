import { History } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx, escapeRegExp, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import type { InputHistoryEntry } from "../../stores/input-history";
import { filterHistory, useInputHistoryStore } from "../../stores/input-history";

/**
 * Ctrl+R history search overlay (GUI counterpart of the TUI
 * HistorySearchComponent): token-AND fuzzy filter over sent prompts,
 * ↑↓ navigate, Enter inserts into the composer, Esc closes.
 */

const MAX_RESULTS = 50;

interface HistorySearchOverlayProps {
	onSelect: (prompt: string) => void;
	onClose: () => void;
}

/** Wrap fuzzy-match tokens in <mark>, mirroring the TUI's token highlighting. */
function HighlightedPrompt({ text, tokens }: { text: string; tokens: string[] }) {
	if (tokens.length === 0) return <>{text}</>;
	const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
	const parts = text.split(pattern);
	return (
		<>
			{parts.map((part, index) =>
				index % 2 === 1 ? (
					<mark key={index} className="bg-transparent text-[var(--omp-accent)]">
						{part}
					</mark>
				) : (
					part
				),
			)}
		</>
	);
}

export function HistorySearchOverlay({ onSelect, onClose }: HistorySearchOverlayProps) {
	const t = useT();
	const entries = useInputHistoryStore(s => s.entries);
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	const tokens = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
	const results = useMemo(() => filterHistory(entries, query, MAX_RESULTS), [entries, query]);
	const selected = Math.min(index, Math.max(0, results.length - 1));

	useEffect(() => {
		listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	const pick = (entry: InputHistoryEntry | undefined) => {
		if (entry) onSelect(entry.prompt);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (isImeKeyEvent(event)) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setIndex(current => Math.min(current + 1, Math.max(0, results.length - 1)));
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setIndex(current => Math.max(0, current - 1));
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			pick(results[selected]);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
		}
	};

	return (
		<div
			className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] shadow-[var(--omp-shadow-lg)]"
			onKeyDown={handleKeyDown}
		>
			<div className="flex items-center gap-2 border-b border-[var(--omp-border-muted)] px-3 py-2">
				<History size={13} className="shrink-0 text-[var(--omp-accent)]" />
				<input
					autoFocus
					value={query}
					onChange={event => {
						setQuery(event.target.value);
						setIndex(0);
					}}
					placeholder={t("input.history.placeholder")}
					className="min-w-0 flex-1 bg-transparent text-omp-lg text-[var(--omp-text)] outline-none placeholder:text-[var(--omp-dim)]"
				/>
				<span className="shrink-0 text-omp-xs font-medium text-[var(--omp-dim)]">{t("input.history.title")}</span>
			</div>

			<div ref={listRef} className="max-h-64 overflow-y-auto p-1">
				{results.length === 0 ? (
					<div className="px-3 py-2.5 text-omp-md text-[var(--omp-muted)]">
						{tokens.length > 0 ? t("input.history.empty") : t("input.history.none")}
					</div>
				) : (
					results.map((entry, rowIndex) => (
						<button
							key={`${entry.ts}-${rowIndex}`}
							type="button"
							data-index={rowIndex}
							onMouseDown={event => event.preventDefault()}
							onClick={() => pick(entry)}
							onMouseEnter={() => setIndex(rowIndex)}
							className={cx(
								"flex w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left",
								rowIndex === selected ? "bg-[var(--omp-selected-bg)]" : "",
							)}
						>
							<span
								className={cx(
									"min-w-0 flex-1 truncate font-mono text-omp-md",
									rowIndex === selected ? "text-[var(--omp-text)]" : "text-[var(--omp-muted)]",
								)}
							>
								<HighlightedPrompt text={entry.prompt.replace(/\s+/g, " ").trim()} tokens={tokens} />
							</span>
							{entry.ts > 0 && (
								<span className="shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
									{formatTimeAgo(new Date(entry.ts).toISOString())}
								</span>
							)}
						</button>
					))
				)}
			</div>

			<div className="border-t border-[var(--omp-border-muted)] px-3 py-1.5 text-omp-xs text-[var(--omp-dim)]">
				{t("input.history.hint")}
			</div>
		</div>
	);
}
