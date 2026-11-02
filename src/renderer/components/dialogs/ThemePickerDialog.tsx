/**
 * Theme picker: searchable overlay of the GUI's named themes, "system", and
 * the custom themes in ~/.omp/gui/themes (gui#38). Each card shows a live
 * swatch preview from the theme's token set. Selecting a theme applies it
 * live (inline `--omp-*` tokens), persists the choice, and keeps the legacy
 * dark/light/system store coherent so the App effect and the settings window
 * stay in sync. A custom theme file that cannot be used is listed with why.
 */

import { AlertTriangle, Check, FolderOpen, Monitor, Search } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { cx, shortenPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import {
	applyThemeByName,
	customTheme,
	getPersistedThemeSelection,
	isCustomThemeSelection,
	resolveTokenColor,
	THEMES,
	type ThemeDefinition,
	type ThemeName,
	type ThemeSelection,
} from "../../lib/themes";
import { useCustomThemesStore } from "../../stores/custom-themes";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal } from "../common";

const SWATCH_KEYS = ["--omp-accent", "--omp-syntax-string", "--omp-syntax-function", "--omp-syntax-number"] as const;

interface ThemeEntry {
	selection: ThemeSelection;
	label: string;
	description: string;
	/** null for "system", which has no fixed palette. */
	theme: ThemeDefinition | null;
	custom?: boolean;
	/** A custom theme's token entries that were left out. */
	skipped?: string[];
}

/**
 * Where the list opens when the chosen theme has no row (its file is broken
 * or gone): on its notice, until a key moves the cursor or a search starts.
 */
type NoticeLanding = "none" | "pending" | "landed";

/** Scrolls the chosen theme's notice into view once it is pending and rendered. */
function landOnNotice(landing: RefObject<NoticeLanding>, list: HTMLElement | null): void {
	if (landing.current !== "pending") return;
	const notice = list?.querySelector("[data-chosen-theme]");
	if (!notice) return;
	landing.current = "landed";
	notice.scrollIntoView({ block: "nearest" });
}

export function ThemePickerDialog() {
	const t = useT();
	const open = useUiStore(s => s.themePickerOpen);
	const close = useUiStore(s => s.closeThemePicker);
	const setTheme = useUiStore(s => s.setTheme);

	const customDir = useCustomThemesStore(s => s.dir);
	const customEntries = useCustomThemesStore(s => s.entries);

	const [query, setQuery] = useState("");
	const [current, setCurrent] = useState<ThemeSelection>("system");
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const landingRef = useRef<NoticeLanding>("none");

	const entries = useMemo<ThemeEntry[]>(
		() => [
			{ selection: "system", label: t("themePicker.system"), description: t("themePicker.systemDesc"), theme: null },
			// Locale keys mirror each stable built-in theme id.
			...(Object.keys(THEMES) as ThemeName[]).map(name => ({
				selection: name,
				label: t(`themePicker.theme.${name}.label`),
				description: t(`themePicker.theme.${name}.description`),
				theme: THEMES[name],
			})),
			...customEntries.flatMap(entry =>
				entry.theme
					? [
							{
								selection: entry.selection,
								label: entry.theme.label,
								description: entry.theme.description || t("themePicker.custom.from", { file: entry.fileName }),
								theme: entry.theme,
								custom: true,
								skipped: entry.skipped,
							},
						]
					: [],
			),
		],
		[t, customEntries],
	);
	const entriesRef = useRef(entries);
	entriesRef.current = entries;
	const broken = customEntries.filter(entry => !entry.theme);
	// The chosen custom theme's file is gone or broken: say what is on screen instead.
	const chosenId = isCustomThemeSelection(current) && customDir !== null ? current.slice("custom:".length) : null;
	const chosenFile = chosenId === null || /\.json$/i.test(chosenId) ? chosenId : `${chosenId}.json`;
	const chosenMissing = chosenFile !== null && !customEntries.some(entry => entry.selection === current);
	const chosenNote = isCustomThemeSelection(current)
		? t(customTheme(current) ? "themePicker.custom.keptLastGood" : "themePicker.custom.fallback")
		: "";

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return entries;
		return entries.filter(e => e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
	}, [entries, query]);
	const firstCustom = filtered.findIndex(entry => entry.custom);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setQuery("");
		setActive(0);
		landingRef.current = "none";
		void getPersistedThemeSelection().then(sel => {
			if (cancelled) return;
			setCurrent(sel);
			// Read once per open: the custom list changing underneath keeps the cursor where it is.
			const index = entriesRef.current.findIndex(e => e.selection === sel);
			if (index < 0 && isCustomThemeSelection(sel)) landingRef.current = "pending";
			setActive(Math.max(0, index));
			// Reopened on the same theme, nothing re-renders, so the effect below would not run.
			requestAnimationFrame(() => landOnNotice(landingRef, listRef.current));
		});
		requestAnimationFrame(() => inputRef.current?.focus());
		return () => {
			cancelled = true;
		};
	}, [open]);

	const select = (entry: ThemeEntry) => {
		const sel = entry.selection;
		applyThemeByName(sel);
		setTheme(entry.theme ? entry.theme.scheme : "system");
		setCurrent(sel);
		toast({ variant: "success", message: t("themePicker.applied", { name: entry.label }) });
		close();
	};

	const onKey = (e: React.KeyboardEvent) => {
		if (isImeKeyEvent(e)) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") landingRef.current = "none";
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive(i => Math.min(filtered.length - 1, i + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive(i => Math.max(0, i - 1));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const entry = filtered[active];
			if (entry) select(entry);
		}
	};

	useEffect(() => {
		if (landingRef.current !== "none") return;
		listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
	}, [active]);

	// The notice renders once the theme files are in, so this checks after every render until it lands.
	useEffect(() => landOnNotice(landingRef, listRef.current));

	return (
		<Modal
			open={open}
			onClose={close}
			chromeless
			ariaLabel={t("themePicker.aria")}
			size="picker"
			placement="top"
			bodyClassName="p-0"
		>
			<div onKeyDown={onKey}>
				<div className="flex items-center gap-2 border-b border-[var(--omp-border-muted)] px-4 py-3">
					<Search size={15} className="shrink-0 text-[var(--omp-dim)]" />
					<input
						ref={inputRef}
						value={query}
						onChange={e => {
							landingRef.current = "none";
							setQuery(e.target.value);
							setActive(0);
						}}
						placeholder={t("themePicker.search")}
						className="w-full bg-transparent text-omp-lg text-[var(--omp-text)] outline-none placeholder:text-[var(--omp-dim)]"
					/>
				</div>
				<div ref={listRef} className="omp-command-list overflow-y-auto p-2">
					{filtered.length === 0 && (
						<div className="px-3 py-8 text-center text-omp-lg text-[var(--omp-dim)]">
							{t("themePicker.empty")}
						</div>
					)}
					{filtered.map((entry, i) => {
						const theme = entry.theme;
						const isSystem = theme === null;
						const isCurrent = entry.selection === current;
						const row = (
							<button
								key={entry.selection}
								type="button"
								data-index={i}
								aria-pressed={isCurrent}
								onClick={() => select(entry)}
								onMouseEnter={() => setActive(i)}
								className={cx(
									"flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
									i === active ? "bg-[var(--omp-selected-bg)]" : "hover:bg-[var(--omp-bg-tertiary)]",
								)}
							>
								<span
									aria-hidden="true"
									className="flex h-14 w-24 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border"
									style={{
										background: theme ? resolveTokenColor(theme, "--omp-bg-primary") : "var(--omp-input-bg)",
										borderColor: theme ? resolveTokenColor(theme, "--omp-border") : "var(--omp-border)",
										color: theme ? resolveTokenColor(theme, "--omp-text") : "var(--omp-text)",
									}}
								>
									{isSystem ? (
										<span className="flex h-full w-full items-center justify-center text-[var(--omp-dim)]">
											<Monitor size={15} />
										</span>
									) : (
										<>
											<span className="font-display text-omp-xl font-medium">Aa</span>
											<span className="flex gap-1">
												{SWATCH_KEYS.map(key => (
													<span
														key={key}
														className="h-1.5 w-3 rounded-full"
														style={{ background: resolveTokenColor(theme!, key) }}
													/>
												))}
											</span>
										</>
									)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="flex items-center gap-2 text-omp-lg font-medium text-[var(--omp-text)]">
										{entry.label}
										{isCurrent && <Check size={14} className="text-[var(--omp-accent)]" />}
									</span>
									<span className="block text-omp-md leading-relaxed text-[var(--omp-muted)]">
										{entry.description}
									</span>
									{entry.skipped && entry.skipped.length > 0 && (
										<span className="block truncate text-omp-sm text-[var(--omp-warning)]">
											{t("themePicker.custom.skipped", {
												count: entry.skipped.length,
												plural: entry.skipped.length === 1 ? "y" : "ies",
												names: entry.skipped.join(", "),
											})}
										</span>
									)}
								</span>
							</button>
						);
						if (i !== firstCustom) return row;
						return [
							<div
								key="custom-heading"
								className="px-3 pt-3 pb-1 text-omp-xs font-medium tracking-wide text-[var(--omp-dim)] uppercase"
							>
								{t("themePicker.custom.heading")}
							</div>,
							row,
						];
					})}
					{!query.trim() &&
						broken.map(entry => (
							<div
								key={entry.selection}
								data-custom-theme-problem={entry.problem}
								data-chosen-theme={entry.selection === current || undefined}
								className="flex items-start gap-3 px-3 py-2 text-omp-md text-[var(--omp-muted)]"
							>
								<AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--omp-warning)]" />
								<span className="min-w-0 break-words">
									{t(`themePicker.custom.problem.${entry.problem}`, {
										file: entry.fileName,
										detail: entry.detail ?? "",
									})}
									{entry.selection === current && (
										<span className="block text-[var(--omp-text-secondary)]">{chosenNote}</span>
									)}
								</span>
							</div>
						))}
					{!query.trim() && chosenMissing && (
						<div
							data-custom-theme-problem="missing"
							data-chosen-theme
							className="flex items-start gap-3 px-3 py-2 text-omp-md text-[var(--omp-muted)]"
						>
							<AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--omp-warning)]" />
							<span className="min-w-0 break-words">
								{t("themePicker.custom.missing", { file: chosenFile ?? "" })}
							</span>
						</div>
					)}
				</div>
				<div className="flex items-center gap-3 border-t border-[var(--omp-border-muted)] px-4 py-2.5">
					<span className="min-w-0 flex-1 text-omp-sm text-[var(--omp-dim)]">
						{t("themePicker.custom.hint", { dir: customDir ? shortenPath(customDir) : "~/.omp/gui/themes" })}
					</span>
					<Button
						size="sm"
						variant="secondary"
						onClick={() => {
							void window.omp.themes
								.openFolder()
								.then(result => {
									if (!result.ok)
										toast({
											variant: "error",
											message: t("themePicker.custom.openFailed", { error: result.error ?? "" }),
										});
								})
								.catch(cause =>
									toast({
										variant: "error",
										message: t("themePicker.custom.openFailed", { error: String(cause) }),
									}),
								);
						}}
					>
						<FolderOpen size={13} />
						{t("themePicker.custom.openFolder")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
