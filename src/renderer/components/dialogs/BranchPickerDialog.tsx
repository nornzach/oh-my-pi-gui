import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Branch picker: lists the current session's user messages (via
 * rpc.getBranchMessages) and branches the session from the chosen entry via
 * rpc.branch(entryId). Follows the ModelPicker overlay pattern.
 */

import { GitBranch, RotateCw, Search } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { branchSessionFromEntry } from "../../lib/messages";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner } from "../common";

interface BranchEntry {
	entryId: string;
	text: string;
}

export function BranchPickerDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const open = useUiStore(state => state.branchPickerOpen);
	const close = useUiStore(state => state.closeBranchPicker);

	const [query, setQuery] = useState("");
	const [entries, setEntries] = useState<BranchEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [branching, setBranching] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const listboxId = useId();

	const [attempt, setAttempt] = useState(0);

	/* The retry button's bump is the only reason this effect re-runs; nothing inside
	   reads it. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: retry re-reads by bump
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setLoading(true);
		setError(null);
		setBranching(null);
		setActiveIndex(0);
		requestAnimationFrame(() => inputRef.current?.focus());
		let cancelled = false;
		void tabRpc
			.getBranchMessages()
			.then(response => {
				if (cancelled) return;
				if (response.success) {
					const data = response.data as { messages?: BranchEntry[] } | undefined;
					setEntries(data?.messages ?? []);
				} else {
					setError(response.error);
				}
			})
			.catch(cause => {
				if (!cancelled) setError(String(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [attempt, open, tabRpc.getBranchMessages]);

	// Newest first — the RPC returns entries in session order.
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = q ? entries.filter(entry => entry.text.toLowerCase().includes(q)) : entries;
		return [...list].reverse();
	}, [entries, query]);

	// Clamp the highlight when the visible list shrinks (search, reload).
	useEffect(() => {
		setActiveIndex(index => Math.min(index, Math.max(0, filtered.length - 1)));
	}, [filtered.length]);

	useEffect(() => {
		listRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	const select = async (entry: BranchEntry) => {
		if (branching !== null) return;
		setBranching(entry.entryId);
		try {
			const result = await branchSessionFromEntry(entry.entryId);
			if (result === "cancelled") {
				toast({ variant: "info", message: t("branchPicker.cancelled") });
				return;
			}
			close();
		} catch (cause) {
			toast({ variant: "error", title: t("branchPicker.failed"), message: String(cause) });
		} finally {
			setBranching(null);
		}
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (isImeKeyEvent(event)) return;
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setActiveIndex(index => Math.min(index + 1, filtered.length - 1));
				break;
			case "ArrowUp":
				event.preventDefault();
				setActiveIndex(index => Math.max(index - 1, 0));
				break;
			case "Home":
				event.preventDefault();
				setActiveIndex(0);
				break;
			case "End":
				event.preventDefault();
				setActiveIndex(Math.max(0, filtered.length - 1));
				break;
			case "Enter": {
				event.preventDefault();
				const entry = filtered[activeIndex];
				if (entry) void select(entry);
				break;
			}
		}
	};

	// role="listbox" only when option rows actually render (loading / error /
	// empty states are plain status blocks, not listbox children).
	const showOptions = !error && !loading && filtered.length > 0;

	return (
		<Modal
			ariaLabel={t("branchPicker.searchLabel")}
			bodyClassName="p-0"
			chromeless
			onClose={close}
			open={open}
			placement="top"
			size="picker"
		>
			<div className="flex h-full flex-col">
				<div className="flex items-center gap-2.5 border-b border-(--omp-border-muted) px-3.5 py-2.5">
					<Search className="shrink-0 text-(--omp-dim)" size={14} />
					<input
						aria-activedescendant={filtered.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined}
						aria-controls={listboxId}
						aria-label={t("branchPicker.searchLabel")}
						className="min-w-0 flex-1 bg-transparent text-sm text-(--omp-text) placeholder:text-(--omp-dim) focus:outline-none"
						onChange={event => setQuery(event.target.value)}
						onKeyDown={onKeyDown}
						placeholder={t("branchPicker.placeholder")}
						ref={inputRef}
						value={query}
					/>
					<kbd className="shrink-0 rounded border border-(--omp-border-muted) px-1.5 py-0.5 text-omp-xxs text-(--omp-dim)">
						esc
					</kbd>
				</div>
				<div
					className="min-h-0 flex-1 overflow-y-auto p-1.5"
					id={listboxId}
					ref={listRef}
					role={showOptions ? "listbox" : undefined}
				>
					{error ? (
						<div className="flex flex-col items-center gap-2 py-10 text-center">
							<p role="alert" className="text-xs text-[var(--omp-error)]">
								{error}
							</p>
							<Button
								icon={<RotateCw size={12} />}
								onClick={() => setAttempt(count => count + 1)}
								size="sm"
								variant="secondary"
							>
								{t("common.retry")}
							</Button>
						</div>
					) : loading ? (
						<div className="flex items-center justify-center gap-2 py-10">
							<Spinner size="sm" />
							<span className="text-xs text-(--omp-dim)">{t("branchPicker.loading")}</span>
						</div>
					) : filtered.length === 0 ? (
						<div className="py-10 text-center text-xs text-(--omp-dim)">
							{entries.length === 0 ? t("branchPicker.empty") : t("branchPicker.noMatch", { query })}
						</div>
					) : (
						filtered.map((entry, index) => {
							const isActive = index === activeIndex;
							return (
								<button
									aria-selected={false}
									className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
										isActive ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)"
									}`}
									data-option-index={index}
									disabled={branching !== null}
									id={`${listboxId}-option-${index}`}
									key={entry.entryId}
									onClick={() => void select(entry)}
									onMouseEnter={() => setActiveIndex(index)}
									role="option"
									type="button"
								>
									<GitBranch
										className={`shrink-0 ${isActive ? "text-(--omp-accent)" : "text-(--omp-dim)"}`}
										size={13}
									/>
									<span className="min-w-0 flex-1 truncate text-xs text-(--omp-text)">{entry.text}</span>
									{branching === entry.entryId && <Spinner size="sm" />}
								</button>
							);
						})
					)}
				</div>
			</div>
		</Modal>
	);
}
