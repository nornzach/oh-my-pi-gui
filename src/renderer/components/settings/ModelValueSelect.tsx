/**
 * Searchable dropdown for string-typed settings whose value references a
 * model or a provider (e.g. providers.webSearchGeminiModel, mnemopi.llmModel).
 * Options are fetched (forced) on every open through the model store, so
 * credential and models.yml changes never leave a process-lifetime cache.
 * Custom values stay allowed: the current value is pinned when it is not in
 * the fetched list, and the search text can be committed verbatim. Commits go
 * through the caller's setSetting flow.
 */

import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvailableModelsResult, ProvidersResult } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { useModelStore } from "../../stores/model";
import { Spinner } from "../common";

export type SettingRefKind = "model" | "provider";

/**
 * Classify a setting path as a model/provider reference. Conservative by
 * design: only the last path segment is inspected, so `model.loopGuard.*`
 * (a namespace, and boolean/number-typed anyway) or `stt.language` never
 * match. Callers apply this to string-typed, non-secret entries only.
 */
export function settingRefKind(path: string): SettingRefKind | null {
	const segment = path.slice(path.lastIndexOf(".") + 1);
	if (/model$/i.test(segment)) return "model";
	if (/provider$/i.test(segment)) return "provider";
	return null;
}

interface SelectOption {
	value: string;
	detail?: string;
	disabled?: boolean;
}

type FetchState = "idle" | "loading" | "error" | "ready";

/** Both readers force a catalog refresh: a non-forced read is answered by a
 * still-fresh cache row, which is exactly the stale provider/model list this
 * dropdown exists to avoid. They read through the model store so the committed
 * catalog and these options can never disagree. */
async function modelOptions(read: () => Promise<AvailableModelsResult>): Promise<SelectOption[]> {
	const { models } = await read();
	const seen = new Set<string>();
	const options: SelectOption[] = [];
	for (const model of models) {
		const value = `${model.provider}/${model.id}`;
		if (seen.has(value)) continue;
		seen.add(value);
		options.push({ value, detail: model.provider });
	}
	return options;
}

async function providerOptions(read: () => Promise<ProvidersResult>): Promise<SelectOption[]> {
	const { providers } = await read();
	return providers.map(provider => ({
		value: provider.id,
		detail: provider.name,
		disabled: provider.disabled,
	}));
}

const PANEL_WIDTH = 288;
const PANEL_MAX_HEIGHT = 264;

const ROW_CLASS =
	"flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-(--omp-bg-tertiary)";

export interface ModelValueSelectProps {
	kind: SettingRefKind;
	/** Current committed value; "" means unset. */
	value: string;
	disabled?: boolean;
	/** Commit a new value via the row's setSetting flow ("" clears). */
	onCommit: (value: string) => void;
	/** Trigger text shown while value is "" (defaults to the unset label). */
	placeholder?: string;
}

export function ModelValueSelect({ kind, value, disabled, onCommit, placeholder }: ModelValueSelectProps) {
	const t = useT();
	const refreshAvailableModels = useModelStore(state => state.refreshAvailableModels);
	const refreshProviders = useModelStore(state => state.refreshProviders);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [options, setOptions] = useState<SelectOption[]>([]);
	const [fetchState, setFetchState] = useState<FetchState>("idle");
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const requestIdRef = useRef(0);

	const fetchOptions = useCallback(() => {
		const requestId = ++requestIdRef.current;
		setFetchState("loading");
		setFetchError(null);
		const load = kind === "model" ? modelOptions(refreshAvailableModels) : providerOptions(refreshProviders);
		return load
			.then(result => {
				if (requestIdRef.current !== requestId) return;
				setOptions(result);
				setFetchState("ready");
			})
			.catch((cause: unknown) => {
				if (requestIdRef.current !== requestId) return;
				setFetchError(cause instanceof Error ? cause.message : String(cause));
				setFetchState("error");
			});
	}, [kind, refreshAvailableModels, refreshProviders]);

	// Fetch on every open. A provider/model edit can happen while this settings
	// row remains mounted, so retaining a previous "ready" result is stale.
	useEffect(() => {
		if (!open) return;
		void fetchOptions();
		return () => {
			requestIdRef.current++;
		};
	}, [fetchOptions, open]);

	// Focus the filter input once the panel is up.
	useEffect(() => {
		if (!open) return;
		requestAnimationFrame(() => searchRef.current?.focus());
	}, [open]);

	// Close on outside click and on any scroll (the panel is viewport-fixed,
	// so it would otherwise detach from the trigger inside the scrolling
	// settings column).
	useEffect(() => {
		if (!open) return;
		const onMouseDown = (event: MouseEvent) => {
			if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
				setOpen(false);
			}
		};
		const onScroll = () => setOpen(false);
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("scroll", onScroll, true);
		};
	}, [open]);

	const openPanel = () => {
		const rect = triggerRef.current?.getBoundingClientRect();
		if (rect) {
			const openUp = window.innerHeight - rect.bottom < PANEL_MAX_HEIGHT + 16 && rect.top > PANEL_MAX_HEIGHT + 16;
			const left = Math.max(8, Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8));
			setPlacement({
				left,
				top: openUp ? Math.max(8, rect.top - PANEL_MAX_HEIGHT - 4) : rect.bottom + 4,
			});
		}
		setOpen(true);
	};

	const choose = (next: string) => {
		setOpen(false);
		setQuery("");
		if (next !== value) onCommit(next);
	};

	const trimmedQuery = query.trim();
	const loweredQuery = trimmedQuery.toLowerCase();
	const filtered = useMemo(() => {
		if (loweredQuery.length === 0) return options;
		return options.filter(
			option =>
				option.value.toLowerCase().includes(loweredQuery) ||
				(option.detail ?? "").toLowerCase().includes(loweredQuery),
		);
	}, [options, loweredQuery]);

	// The current value is pinned as a custom row when the fetched catalog
	// does not contain it (hand-written overrides stay selectable/clearable).
	const currentIsCustom = value !== "" && !options.some(option => option.value === value);
	// The search text doubles as a custom-value entry when it is not an exact
	// known option.
	const queryIsCustom = trimmedQuery !== "" && !options.some(option => option.value.toLowerCase() === loweredQuery);

	const noun = kind === "model" ? t("modelValue.noun.models") : t("modelValue.noun.providers");

	const renderOption = (option: SelectOption) => {
		const selected = option.value === value;
		// `disabled` is a recognition label, not a lock: choosing a disabled
		// provider for a `*Provider` setting only fails when something later
		// tries to call it.
		const unavailable = option.disabled === true;
		return (
			<button
				aria-selected={selected}
				className={`${ROW_CLASS} ${selected ? "bg-(--omp-selected-bg)" : ""} disabled:cursor-not-allowed disabled:opacity-50`}
				disabled={unavailable}
				key={option.value}
				onClick={() => choose(option.value)}
				role="option"
				type="button"
			>
				<span
					className={`min-w-0 flex-1 truncate font-mono text-xs ${
						selected ? "font-semibold text-(--omp-accent)" : "text-(--omp-text)"
					}`}
				>
					{option.value}
				</span>
				{option.detail !== undefined && kind === "provider" && (
					<span className="shrink-0 text-omp-xs text-(--omp-dim)">
						{option.disabled ? t("modelValue.providerDisabled", { name: option.detail }) : option.detail}
					</span>
				)}
				{selected && <Check className="shrink-0 text-(--omp-accent)" size={13} />}
			</button>
		);
	};

	return (
		<div className="relative" ref={rootRef}>
			<button
				aria-expanded={open}
				aria-haspopup="listbox"
				className="flex w-full items-center gap-1.5 rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) px-2.5 py-1.5 text-left text-xs transition-colors duration-100 focus:border-(--omp-border-accent) focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
				disabled={disabled}
				onClick={() => (open ? setOpen(false) : openPanel())}
				ref={triggerRef}
				type="button"
			>
				<span
					className={`min-w-0 flex-1 truncate font-mono ${value === "" ? "text-(--omp-dim)" : "text-(--omp-text)"}`}
				>
					{value === "" ? (placeholder ?? t("modelValue.unset")) : value}
				</span>
				<ChevronDown className="shrink-0 text-(--omp-dim)" size={12} />
			</button>
			{open && placement !== null && (
				<div
					className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-(--omp-border-muted) bg-(--omp-bg-elevated) shadow-xl shadow-black/40"
					style={{ top: placement.top, left: placement.left, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT }}
				>
					<div className="flex items-center gap-2 border-b border-(--omp-border-muted) px-2.5 py-2">
						<Search className="shrink-0 text-(--omp-dim)" size={12} />
						<input
							aria-label={t("modelValue.searchAria", { noun })}
							className="min-w-0 flex-1 bg-transparent text-xs text-(--omp-text) placeholder:text-(--omp-dim) focus:outline-none"
							onChange={event => setQuery(event.target.value)}
							onKeyDown={event => {
								if (isImeKeyEvent(event)) return;
								if (event.key === "Escape") {
									event.stopPropagation();
									setOpen(false);
								}
							}}
							placeholder={t("modelValue.searchPlaceholder", { noun })}
							ref={searchRef}
							value={query}
						/>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox">
						{fetchState === "error" ? (
							<div className="flex flex-col items-center gap-2 py-6">
								<span className="px-3 text-center text-xs text-(--omp-error)">
									{fetchError ?? t("modelValue.loadFailed", { noun })}
								</span>
								<button
									className="rounded-md border border-(--omp-border-muted) px-2.5 py-1 text-omp-sm font-medium text-(--omp-text) hover:bg-(--omp-bg-tertiary)"
									onClick={() => void fetchOptions()}
									type="button"
								>
									{t("modelValue.retry")}
								</button>
							</div>
						) : fetchState !== "ready" ? (
							<div className="flex items-center justify-center gap-2 py-6">
								<Spinner size="sm" />
								<span className="text-xs text-(--omp-dim)">{t("modelValue.loading", { noun })}</span>
							</div>
						) : (
							<>
								{currentIsCustom && (
									<>
										<div className="px-2 pt-1 pb-0.5 text-omp-xxs font-semibold tracking-widest text-(--omp-dim) uppercase">
											{t("modelValue.currentCustom")}
										</div>
										{renderOption({ value })}
									</>
								)}
								{filtered.map(renderOption)}
								{filtered.length === 0 && !queryIsCustom && (
									<div className="px-2 py-6 text-center text-xs text-(--omp-dim)">
										{options.length === 0
											? t("modelValue.noneAvailable", { noun })
											: t("modelValue.noMatch", { noun, query: trimmedQuery })}
									</div>
								)}
								{queryIsCustom && (
									<button className={ROW_CLASS} onClick={() => choose(trimmedQuery)} type="button">
										<span className="min-w-0 flex-1 truncate text-xs text-(--omp-text)">
											{t("modelValue.useCustom", { query: trimmedQuery })}
										</span>
									</button>
								)}
								{value !== "" && (
									<button
										className={`${ROW_CLASS} mt-0.5 border-t border-(--omp-border-muted) rounded-t-none`}
										onClick={() => choose("")}
										type="button"
									>
										<span className="min-w-0 flex-1 text-xs text-(--omp-dim)">{t("modelValue.clear")}</span>
									</button>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
