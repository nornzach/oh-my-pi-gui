/**
 * Searchable dropdown for string settings whose value domain is enumerable
 * (theme names, shell paths, …) — the "don't make me hand-type this" control.
 * Options are fetched on every open; concurrent opens share one request.
 * Current value is pinned when it isn't in the list; a custom value can be
 * committed verbatim when `allowCustom` is set.
 */

import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { isImeKeyEvent } from "../../../lib/ime";

export interface EnumerableOption {
	value: string;
	label?: string;
	detail?: string;
}

export interface EnumerableSelectProps {
	/** Fetch the option list (lazy, cached). */
	fetchOptions: () => Promise<EnumerableOption[]>;
	/** Current committed value; "" means unset. */
	value: string;
	disabled?: boolean;
	onCommit: (value: string) => void;
	/** Allow committing a value not in the list (typed verbatim). */
	allowCustom?: boolean;
	noun?: string;
	/**
	 * Live-browse hook (theme preview parity): called with the highlighted
	 * row's commit value while the dropdown is open, and with null when it
	 * closes (commit, Escape, or outside click) so the caller reverts.
	 */
	onPreview?: (value: string | null) => void;
}

type OptionsFetcher = () => Promise<EnumerableOption[]>;

/**
 * Dedupes requests that overlap, and nothing more. Caching settled results here
 * made a shell installed after the first open invisible until a reload, and an
 * empty answer indistinguishable from a fetcher that never ran.
 */
const inflight = new WeakMap<OptionsFetcher, Promise<EnumerableOption[]>>();
function fetchOnce(fetcher: OptionsFetcher): Promise<EnumerableOption[]> {
	const pending = inflight.get(fetcher);
	if (pending) return pending;
	const request = fetcher();
	const settle = (): void => {
		if (inflight.get(fetcher) === request) inflight.delete(fetcher);
	};
	request.then(settle, settle);
	inflight.set(fetcher, request);
	return request;
}

const TRIGGER_CLASS =
	"flex w-full items-center justify-between gap-2 rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-2.5 py-1.5 text-left text-xs text-(--omp-text) transition-colors hover:border-(--omp-input-focus-border) disabled:opacity-50";

/** One selectable row in the dropdown, in render/tab order. */
type EnumerableItem =
	| { kind: "clear"; value: "" }
	| { kind: "current"; value: string }
	| { kind: "option"; option: EnumerableOption }
	| { kind: "custom"; value: string };

const itemCommitValue = (item: EnumerableItem): string => (item.kind === "option" ? item.option.value : item.value);

export function EnumerableSelect({
	fetchOptions,
	value,
	disabled,
	onCommit,
	allowCustom,
	noun,
	onPreview,
}: EnumerableSelectProps) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [options, setOptions] = useState<EnumerableOption[] | null>(null);
	const [error, setError] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const listboxId = useId();

	// `fetchOptions` is usually an inline arrow, so its identity changes with every
	// parent render; the ref keeps that to one request per open and a fresh read
	// on the next one.
	const requestedForOpen = useRef(false);

	useEffect(() => {
		if (!open) {
			requestedForOpen.current = false;
			return;
		}
		let cancelled = false;
		setError(false);
		setActiveIndex(0);
		if (!requestedForOpen.current) {
			requestedForOpen.current = true;
			fetchOnce(fetchOptions)
				.then(result => {
					if (!cancelled) setOptions(result);
				})
				.catch(() => {
					if (!cancelled) setError(true);
				});
		}
		requestAnimationFrame(() => searchRef.current?.focus());
		return () => {
			cancelled = true;
		};
	}, [open, fetchOptions]);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (isImeKeyEvent(e)) return;
			if (e.key !== "Escape") return;
			// Only a keypress made inside this popup dismisses it, and capture +
			// stopPropagation runs the claim before the dialog behind it (registered
			// earlier on the same node) can take the same Escape.
			if (!rootRef.current?.contains(e.target as Node)) return;
			e.stopPropagation();
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [open]);

	const trimmedQuery = query.trim();

	const filtered = useMemo(() => {
		const list = options ?? [];
		const q = trimmedQuery.toLowerCase();
		if (!q) return list;
		return list.filter(o => o.value.toLowerCase().includes(q) || (o.label ?? "").toLowerCase().includes(q));
	}, [options, trimmedQuery]);

	const hasCurrent = value !== "" && (options ?? []).some(o => o.value === value);

	// The dropdown rows as one flat list so arrow-key navigation covers the
	// clear / pinned-current / option / custom rows uniformly.
	const items = useMemo<EnumerableItem[]>(() => {
		const list: EnumerableItem[] = [];
		if (value !== "") list.push({ kind: "clear", value: "" });
		if (value !== "" && !hasCurrent) list.push({ kind: "current", value });
		for (const option of filtered) list.push({ kind: "option", option });
		if (allowCustom && trimmedQuery !== "" && !filtered.some(o => o.value === trimmedQuery)) {
			list.push({ kind: "custom", value: trimmedQuery });
		}
		return list;
	}, [value, hasCurrent, filtered, allowCustom, trimmedQuery]);

	// Clamp the highlight when the visible list shrinks (search, reload).
	useEffect(() => {
		setActiveIndex(index => Math.min(index, Math.max(0, items.length - 1)));
	}, [items.length]);

	useEffect(() => {
		listRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	// Live preview: report the highlighted row while browsing; null on close.
	// The ref gates the null call so mount and never-opened rows stay silent.
	const previewingRef = useRef(false);
	useEffect(() => {
		if (!onPreview) return;
		if (open && options !== null) {
			previewingRef.current = true;
			const item = items[activeIndex];
			if (item) onPreview(itemCommitValue(item));
		} else if (previewingRef.current) {
			previewingRef.current = false;
			onPreview(null);
		}
	}, [onPreview, open, options, items, activeIndex]);
	// Revert on unmount (e.g. the row disappears behind a condition gate
	// mid-browse, or the window closes with the dropdown open).
	useEffect(
		() => () => {
			if (previewingRef.current) onPreview?.(null);
		},
		[onPreview],
	);

	const commit = (next: string) => {
		onCommit(next);
		setOpen(false);
		setQuery("");
	};

	const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setActiveIndex(index => Math.min(index + 1, items.length - 1));
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
				setActiveIndex(Math.max(0, items.length - 1));
				break;
			case "Enter": {
				event.preventDefault();
				const item = items[activeIndex];
				if (item) commit(itemCommitValue(item));
				break;
			}
		}
	};

	const renderItem = (item: EnumerableItem, index: number) => {
		const isActive = index === activeIndex;
		const rowProps = {
			"aria-selected": item.kind === "option" ? item.option.value === value : item.kind === "current",
			"data-option-index": index,
			id: `${listboxId}-option-${index}`,
			onClick: () => commit(itemCommitValue(item)),
			onMouseEnter: () => setActiveIndex(index),
			role: "option",
			type: "button",
		} as const;
		switch (item.kind) {
			case "clear":
				return (
					<button
						{...rowProps}
						className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${isActive ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)"}`}
						key="__clear__"
					>
						<span className="text-(--omp-dim)">{t("settings.editors.clear")}</span>
					</button>
				);
			case "current":
				return (
					<button
						{...rowProps}
						className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-mono text-xs ${isActive ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)"}`}
						key="__current__"
					>
						<span>{item.value}</span>
						<Check size={12} className="text-(--omp-accent)" />
					</button>
				);
			case "option":
				return (
					<button
						{...rowProps}
						className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-mono text-xs ${isActive ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)"}`}
						key={item.option.value}
					>
						<span className="min-w-0 flex-1 truncate">{item.option.label ?? item.option.value}</span>
						{item.option.value === value && <Check size={12} className="shrink-0 text-(--omp-accent)" />}
					</button>
				);
			case "custom":
				return (
					<button
						{...rowProps}
						className={`w-full rounded px-2 py-1.5 text-left font-mono text-xs text-(--omp-accent) ${isActive ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)"}`}
						key="__custom__"
					>
						{t("settings.editors.useCustom", { value: item.value })}
					</button>
				);
		}
	};

	return (
		<div className="relative" ref={rootRef}>
			<button
				aria-controls={listboxId}
				aria-expanded={open}
				aria-haspopup="listbox"
				className={TRIGGER_CLASS}
				disabled={disabled}
				onClick={() => setOpen(o => !o)}
				type="button"
			>
				<span className={cx("truncate font-mono", value === "" && "text-(--omp-dim)")}>
					{value === "" ? t("settings.editors.unset") : value}
				</span>
				<ChevronDown size={13} className="shrink-0 text-(--omp-dim)" />
			</button>
			{open && (
				<div className="absolute right-0 z-40 mt-1 w-72 overflow-hidden rounded-lg border border-(--omp-modal-border) bg-(--omp-modal-bg) shadow-(--omp-shadow-lg)">
					<div className="border-b border-(--omp-border-muted) px-2 py-1.5">
						<input
							aria-activedescendant={items.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined}
							aria-controls={listboxId}
							aria-label={t("settings.editors.search")}
							className="w-full bg-transparent text-xs text-(--omp-text) outline-none placeholder:text-(--omp-dim)"
							onChange={e => setQuery(e.target.value)}
							onKeyDown={onSearchKeyDown}
							placeholder={t("settings.editors.search")}
							ref={searchRef}
							spellCheck={false}
							value={query}
						/>
					</div>
					{options === null && !error && (
						<div className="px-2 py-2 text-xs text-(--omp-dim)">
							{t("settings.editors.loading", { noun: noun ?? t("settings.editors.options") })}
						</div>
					)}
					{error && (
						<button
							className="w-full rounded px-2 py-1.5 text-left text-xs text-(--omp-error) hover:bg-(--omp-bg-tertiary)"
							onClick={() => {
								setOptions(null);
								setError(false);
								void fetchOnce(fetchOptions)
									.then(setOptions)
									.catch(() => setError(true));
							}}
							type="button"
						>
							{t("settings.editors.retry")}
						</button>
					)}
					{options !== null && (
						<>
							<div
								className="max-h-56 overflow-y-auto p-1"
								id={listboxId}
								ref={listRef}
								role={items.length > 0 ? "listbox" : undefined}
							>
								{items.map(renderItem)}
							</div>
							{filtered.length === 0 && trimmedQuery !== "" && !allowCustom && (
								<div className="px-2 py-2 text-xs text-(--omp-dim)">{t("settings.editors.noMatch")}</div>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}
