/**
 * Settings → Keyboard shortcuts: every shortcut the app knows, with a switch to
 * turn it off and a recorder to change it. In-app, composer and app-level
 * (menu and system-wide) shortcuts all save to the same two prefs keys; the
 * main process re-applies the menu and the show/hide shortcut on each save, and
 * other windows re-read them.
 */

import { Check, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { IpcWindowToggleStatus } from "../../../shared/ipc-types";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import {
	actionChords,
	type BuiltInShortcut,
	chordFromEvent,
	defaultChords,
	findShortcutConflict,
	parseChord,
	SHORTCUT_SECTIONS,
	type ShortcutConflict,
	type ShortcutEntry,
	serializeChord,
	shortcutEntry,
	shortcutSectionRows,
} from "../../lib/keymap";
import { toast } from "../../stores/toast";
import { useEffectiveKeymapOverrides, useUiStore } from "../../stores/ui";
import { Button, Input } from "../common";
import { Section } from "./editors/Section";

interface Recording {
	id: string;
	/** The last chord pressed, kept while it conflicts. */
	chord: string | null;
	conflict: ShortcutConflict | null;
}

const KBD =
	"rounded-md border border-(--omp-border) bg-(--omp-bg-elevated) px-2 py-0.5 font-mono text-omp-sm text-(--omp-muted)";

function sameChords(a: readonly string[], b: readonly string[]): boolean {
	const canonical = (list: readonly string[]) =>
		list.map(chord => {
			const parsed = parseChord(chord);
			return parsed ? serializeChord(parsed) : chord;
		});
	const left = canonical(a);
	const right = canonical(b);
	return left.length === right.length && left.every((chord, index) => chord === right[index]);
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
	return (
		<button
			aria-checked={checked}
			aria-label={label}
			className="flex h-6 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--omp-accent)"
			onClick={() => onChange(!checked)}
			role="switch"
			type="button"
		>
			<span
				aria-hidden
				className={cx(
					"omp-switch-track relative h-5 w-9 rounded-full",
					checked ? "bg-(--omp-switch-on)" : "bg-(--omp-switch-off)", // surface-ok: toggle switch track fill
				)}
			>
				<span
					className={cx(
						"omp-switch-thumb absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow",
						checked ? "translate-x-4" : "translate-x-0",
					)}
				/>
			</span>
		</button>
	);
}

export function ShortcutsSettingsPage() {
	const t = useT();
	const saved = useUiStore(s => s.keymapOverrides);
	const disabled = useUiStore(s => s.keymapDisabled);
	const effective = useEffectiveKeymapOverrides();
	const setKeymapOverride = useUiStore(s => s.setKeymapOverride);
	const setShortcutEnabled = useUiStore(s => s.setShortcutEnabled);
	const resetKeymapOverrides = useUiStore(s => s.resetKeymapOverrides);
	const [query, setQuery] = useState("");
	const [recording, setRecording] = useState<Recording | null>(null);
	const [confirmingReset, setConfirmingReset] = useState(false);
	const [toggleStatus, setToggleStatus] = useState<IpcWindowToggleStatus | null>(null);

	const label = (id: string) => {
		const entry = shortcutEntry(id);
		return entry ? t(entry.labelKey) : id;
	};

	const save = (entry: ShortcutEntry, chord: string) => {
		// Picking the default again clears the override, so a later default change reaches this user.
		setKeymapOverride(entry.id, sameChords([chord], defaultChords(entry)) ? [] : [chord]);
		setRecording(null);
		toast({ variant: "success", message: t("hotkeys.remap.saved", { action: t(entry.labelKey), chord }) });
	};

	// Recording: swallow every key at window-capture phase so nothing reaches the
	// app's own shortcuts (window bubble) or the Settings window's Escape-close.
	// biome-ignore lint/correctness/useExhaustiveDependencies: save is rebuilt each render and reads the same state.
	useEffect(() => {
		if (!recording) return;
		const entry = shortcutEntry(recording.id);
		if (!entry) return;
		const onKey = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				setRecording(null);
				return;
			}
			const chord = chordFromEvent(event);
			if (!chord) return;
			const conflict = findShortcutConflict(entry.id, chord, effective);
			if (conflict) setRecording({ id: entry.id, chord, conflict });
			else save(entry, chord);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [recording, effective]);

	// The show/hide shortcut works system-wide, so another app may already hold it.
	const toggleKeys = actionChords(shortcutEntry("window.toggle") ?? { id: "", defaults: [] }, effective).join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-read whenever the shortcut's keys change.
	useEffect(() => {
		const read = window.omp?.prefs?.windowToggleStatus;
		if (typeof read !== "function") return;
		let current = true;
		read()
			.then(status => {
				if (current) setToggleStatus(status);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [toggleKeys]);

	const sections = useMemo(() => {
		const q = query.trim().toLowerCase();
		return SHORTCUT_SECTIONS.map(section => ({
			section,
			rows: shortcutSectionRows(section).filter(row => {
				if (!q) return true;
				const name = t(row.kind === "entry" ? row.entry.labelKey : row.row.labelKey).toLowerCase();
				const keys = row.kind === "entry" ? actionChords(row.entry, effective).join(" ") : row.row.keys;
				return name.includes(q) || keys.toLowerCase().includes(q);
			}),
		})).filter(section => section.rows.length > 0);
	}, [query, t, effective]);

	const conflictText = (conflict: ShortcutConflict) =>
		t(`shortcuts.conflict.${conflict.reason}`, { action: label(conflict.otherId) });

	const renderBuiltIn = (row: BuiltInShortcut) => (
		<div className="flex items-center gap-3 px-3 py-2" key={row.labelKey}>
			<span className="min-w-0 flex-1 text-omp-md text-(--omp-text)">{t(row.labelKey)}</span>
			<kbd className={KBD}>{row.keys}</kbd>
			<span className="w-[4.75rem] shrink-0 text-right text-omp-xs text-(--omp-dim)">{t("shortcuts.builtIn")}</span>
		</div>
	);

	const renderEntry = (entry: ShortcutEntry) => {
		if (entry.fixed) {
			return renderBuiltIn({
				section: entry.group,
				keys: defaultChords(entry).join(" / "),
				labelKey: entry.labelKey,
			});
		}
		const on = !disabled.includes(entry.id);
		const customized = saved[entry.id] !== undefined;
		// A turned-off shortcut still shows its chord, struck through, so turning it back on is predictable.
		const keys = actionChords(entry, saved).join(" / ");
		const active = recording?.id === entry.id ? recording : null;
		const hint =
			entry.id === "window.toggle"
				? t("shortcuts.globalHint")
				: entry.kind === "composer"
					? t("shortcuts.composerHint")
					: null;
		const globalTaken =
			entry.id === "window.toggle" && on && toggleStatus?.accelerator !== undefined && !toggleStatus.registered;
		return (
			<div className="px-3 py-2" key={entry.id}>
				<div className="flex items-center gap-3">
					<div className="min-w-0 flex-1">
						<div className={cx("text-omp-md", on ? "text-(--omp-text)" : "text-(--omp-muted)")}>
							{t(entry.labelKey)}
						</div>
						{hint && <div className="text-omp-sm text-(--omp-dim)">{hint}</div>}
					</div>
					{active ? (
						<span className="flex shrink-0 items-center gap-1">
							<kbd className={cx(KBD, "border-(--omp-border-accent) text-(--omp-text)")}>
								{active.chord ?? t("hotkeys.remap.pressChord")}
							</kbd>
							<button
								aria-label={t("common.cancel")}
								className="flex size-6 items-center justify-center rounded text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
								onClick={() => setRecording(null)}
								title={t("common.cancel")}
								type="button"
							>
								<X size={12} />
							</button>
						</span>
					) : (
						<button
							aria-label={t("shortcuts.change", { action: t(entry.labelKey) })}
							className={cx(
								KBD,
								"shrink-0 transition-colors enabled:hover:border-(--omp-border-accent) enabled:hover:text-(--omp-text) disabled:cursor-not-allowed disabled:line-through disabled:opacity-60",
							)}
							disabled={!on}
							onClick={() => setRecording({ id: entry.id, chord: null, conflict: null })}
							title={on ? t("shortcuts.change", { action: t(entry.labelKey) }) : undefined}
							type="button"
						>
							{keys}
						</button>
					)}
					<span className="flex w-6 shrink-0 justify-center">
						{customized && !active && (
							<button
								aria-label={t("hotkeys.remap.reset")}
								className="flex size-6 items-center justify-center rounded text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
								onClick={() => {
									setKeymapOverride(entry.id, []);
									toast({
										variant: "success",
										message: t("hotkeys.remap.resetDone", { action: t(entry.labelKey) }),
									});
								}}
								title={t("hotkeys.remap.reset")}
								type="button"
							>
								<RotateCcw size={12} />
							</button>
						)}
					</span>
					<Switch
						checked={on}
						label={t(entry.labelKey)}
						onChange={value => {
							if (!value && active) setRecording(null);
							setShortcutEnabled(entry.id, value);
						}}
					/>
				</div>
				{active && (
					<div className="mt-1.5 flex items-center gap-2 text-omp-sm">
						{active.conflict ? (
							<>
								<span
									className={cx(
										"min-w-0 flex-1",
										active.conflict.kind === "error" ? "text-(--omp-error)" : "text-(--omp-warning)",
									)}
								>
									{conflictText(active.conflict)}
								</span>
								{active.conflict.kind === "warning" && active.chord && (
									<Button
										onClick={() => active.chord && save(entry, active.chord)}
										size="sm"
										variant="secondary"
									>
										{t("shortcuts.useAnyway")}
									</Button>
								)}
							</>
						) : (
							<span className="text-(--omp-dim)">{t("hotkeys.remap.captureHint")}</span>
						)}
					</div>
				)}
				{globalTaken && !active && (
					<div className="mt-1 text-omp-sm text-(--omp-warning)">{t("shortcuts.globalTaken")}</div>
				)}
			</div>
		);
	};

	return (
		<>
			<p className="mb-3 px-1 text-omp-sm text-(--omp-muted)">{t("shortcuts.intro")}</p>
			{/* Settings search lands here: the filter takes focus. */}
			<div className="mb-5 flex items-center gap-2" id="setting-gui-shortcuts">
				<div className="min-w-0 flex-1">
					<Input
						aria-label={t("hotkeys.search")}
						onChange={event => setQuery(event.target.value)}
						placeholder={t("hotkeys.search")}
						value={query}
					/>
				</div>
				{confirmingReset ? (
					<span className="flex shrink-0 items-center gap-1">
						<span className="text-omp-sm text-(--omp-muted)">{t("shortcuts.resetAllConfirm")}</span>
						<button
							aria-label={t("common.confirm")}
							className="flex size-6 items-center justify-center rounded bg-(--omp-tool-error-bg) text-(--omp-error) hover:brightness-110"
							onClick={() => {
								resetKeymapOverrides();
								setConfirmingReset(false);
								setRecording(null);
								toast({ variant: "success", message: t("hotkeys.remap.resetAllDone") });
							}}
							title={t("common.confirm")}
							type="button"
						>
							<Check size={12} strokeWidth={3} />
						</button>
						<button
							aria-label={t("common.cancel")}
							className="flex size-6 items-center justify-center rounded text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
							onClick={() => setConfirmingReset(false)}
							title={t("common.cancel")}
							type="button"
						>
							<X size={12} strokeWidth={3} />
						</button>
					</span>
				) : (
					<Button
						disabled={Object.keys(saved).length === 0 && disabled.length === 0}
						onClick={() => setConfirmingReset(true)}
						size="sm"
						variant="ghost"
					>
						{t("hotkeys.remap.resetAll")}
					</Button>
				)}
			</div>
			{sections.length === 0 && (
				<div className="py-6 text-center text-omp-md text-(--omp-dim)">{t("hotkeys.empty")}</div>
			)}
			{sections.map(({ section, rows }) => (
				<Section key={section} title={t(`hotkeys.group.${section}`)}>
					<div className="divide-y divide-(--omp-border-muted) overflow-hidden rounded-lg border border-(--omp-border-muted)">
						{rows.map(row => (row.kind === "entry" ? renderEntry(row.entry) : renderBuiltIn(row.row)))}
					</div>
				</Section>
			))}
		</>
	);
}
