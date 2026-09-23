import { History } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx, escapeRegExp, formatTimeAgo, shortenPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import type { InputHistoryEntry } from "../../stores/input-history";
import { filterHistory, useInputHistoryStore, workspaceHistory } from "../../stores/input-history";

/**
 * Ctrl+R history search overlay (GUI counterpart of the TUI
 * HistorySearchComponent): token-AND fuzzy filter over sent prompts,
 * ↑↓ navigate, Enter inserts into the composer, Esc closes.
 */

const MAX_RESULTS = 50;

interface HistorySearchOverlayProps {
	cwd: string;
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

export function HistorySearchOverlay({ cwd, onSelect, onClose }: HistorySearchOverlayProps) {
	const t = useT();
	const entries = useInputHistoryStore(s => s.entries);
	const [query, setQuery] = useState("");
	const [allWorkspaces, setAllWorkspaces] = useState(false);
	const [index, setIndex] = useState(0);
	const overlayRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const listId = useId();

	const tokens = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
	const results = useMemo(
		() => filterHistory(workspaceHistory(entries, allWorkspaces ? undefined : cwd), query, MAX_RESULTS),
		[entries, query, allWorkspaces, cwd],
	);
	const selected = Math.min(index, Math.max(0, results.length - 1));

	useEffect(() => {
		listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	// This surface lives above the composer rather than inside Modal. Give it the
	// same dismissal guarantees: outside click closes it, and Escape is consumed
	// during capture so the app-level Escape handler cannot abort a running turn.
	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (overlayRef.current?.contains(event.target as Node)) return;
			onClose();
		};
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (isImeKeyEvent(event) || event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			onClose();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [onClose]);

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
			ref={overlayRef}
			className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] shadow-[var(--omp-shadow-lg)]"
			role="dialog"
			aria-label={t("input.history.title")}
			aria-modal="false"
		>
			<div className="flex items-center gap-2 border-b border-[var(--omp-border-muted)] px-3 py-2">
				<History size={13} className="shrink-0 text-[var(--omp-accent)]" />
				<input
					ref={inputRef}
					autoFocus
					aria-activedescendant={results.length > 0 ? `${listId}-option-${selected}` : undefined}
					aria-controls={listId}
					role="combobox"
					aria-expanded
					aria-autocomplete="list"
					aria-label={t("input.history.placeholder")}
					onKeyDown={handleKeyDown}
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
			<div className="flex items-center gap-2 border-b border-[var(--omp-border-muted)] px-3 py-1.5">
				<select
					aria-label={t("input.history.scope")}
					className="rounded border border-[var(--omp-border-muted)] bg-[var(--omp-input-bg)] px-2 py-1 text-omp-sm text-[var(--omp-text)]"
					value={allWorkspaces ? "all" : "workspace"}
					onChange={event => {
						setAllWorkspaces(event.target.value === "all");
						setIndex(0);
					}}
				>
					<option value="workspace">{t("input.history.workspace")}</option>
					<option value="all">{t("input.history.all")}</option>
				</select>
				<span className="min-w-0 truncate text-omp-xs text-[var(--omp-dim)]" title={shortenPath(cwd)}>
					{allWorkspaces ? t("input.history.includesLegacy") : shortenPath(cwd)}
				</span>
			</div>

			<div
				id={listId}
				ref={listRef}
				className="max-h-64 overflow-y-auto p-1"
				role="listbox"
				aria-label={t("input.history.title")}
			>
				{results.length === 0 ? (
					<div className="px-3 py-2.5 text-omp-md text-[var(--omp-muted)]">
						{tokens.length > 0 ? t("input.history.empty") : t("input.history.none")}
					</div>
				) : (
					results.map((entry, rowIndex) => (
						<button
							key={`${entry.ts}-${rowIndex}`}
							type="button"
							id={`${listId}-option-${rowIndex}`}
							role="option"
							aria-selected={rowIndex === selected}
							data-index={rowIndex}
							onMouseDown={event => event.preventDefault()}
							onClick={() => pick(entry)}
							onMouseEnter={() => setIndex(rowIndex)}
							title={entry.cwd ? shortenPath(entry.cwd) : t("input.history.legacy")}
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
								{allWorkspaces && (
									<span className="block truncate text-omp-xs text-[var(--omp-dim)]">
										{entry.cwd ? shortenPath(entry.cwd) : t("input.history.legacy")}
									</span>
								)}
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
