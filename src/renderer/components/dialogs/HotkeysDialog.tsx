import { Check, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../lib/i18n";
import {
	chordFromEvent,
	detectConflicts,
	KEYMAP_ACTION_BY_ID,
	KEYMAP_ACTIONS,
	type KeymapActionId,
	type KeymapConflict,
} from "../../lib/keymap";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Input, Modal } from "../common";

interface StaticHotkeyRow {
	keys: string;
	labelKey: string;
}

/** Remappable row: label + current chords resolve from the keymap action table. */
interface RemapHotkeyRow {
	actionId: KeymapActionId;
}

type HotkeyRow = StaticHotkeyRow | RemapHotkeyRow;

function isRemapRow(row: HotkeyRow): row is RemapHotkeyRow {
	return "actionId" in row;
}

interface HotkeyGroup {
	titleKey: string;
	rows: HotkeyRow[];
}

// GUI shortcut reference (plan/17 §6.2): the data-driven replacement for the
// TUI's static /hotkeys markdown. Remappable rows reference lib/keymap.ts's
// action table (single source for App.tsx's dispatch and this dialog);
// composer rows (InputArea's handleKeyDown) and the hardcoded global keys
// (Esc abort, ⇧Tab thinking cycle) stay static — terminal-only TUI rows
// (suspend, display reset, $EDITOR) are deliberately absent.
const HOTKEY_GROUPS: HotkeyGroup[] = [
	{
		titleKey: "hotkeys.group.input",
		rows: [
			{ keys: "Enter", labelKey: "hotkeys.row.send" },
			{ keys: "⇧Enter", labelKey: "hotkeys.row.newline" },
			{ keys: "⌃Enter", labelKey: "hotkeys.row.followUpSend" },
			{ keys: "-> / =>", labelKey: "hotkeys.row.queueShorthand" },
			{ keys: "!", labelKey: "hotkeys.row.bashMode" },
			{ keys: "$", labelKey: "hotkeys.row.pythonMode" },
			{ keys: "@", labelKey: "hotkeys.row.mention" },
			{ keys: "/", labelKey: "hotkeys.row.commands" },
			{ keys: "⌃R", labelKey: "hotkeys.row.history" },
			{ keys: "↑ / ↓", labelKey: "hotkeys.row.historyNav" },
		],
	},
	{
		titleKey: "hotkeys.group.generation",
		rows: [
			{ keys: "Esc", labelKey: "hotkeys.row.abort" },
			{ keys: "⇧Tab", labelKey: "hotkeys.row.thinkingCycle" },
			{ actionId: "thinking.toggle" },
			{ actionId: "retry" },
			{ actionId: "dequeue" },
			{ actionId: "plan.toggle" },
			{ actionId: "model.cycleForward" },
			{ actionId: "model.cycleBackward" },
		],
	},
	{
		titleKey: "hotkeys.group.view",
		rows: [
			{ actionId: "palette" },
			{ actionId: "settings" },
			{ actionId: "sidebar.toggle" },
			{ actionId: "panel.toggle" },
			{ actionId: "tools.expand" },
			{ actionId: "hotkeys" },
		],
	},
	{
		titleKey: "hotkeys.group.session",
		rows: [{ actionId: "model.select" }, { actionId: "agents.hub" }],
	},
];

interface ResolvedRow {
	label: string;
	keys: string;
	actionId: KeymapActionId | null;
}

interface CaptureState {
	actionId: KeymapActionId;
	chord: string | null;
}

/** Searchable shortcut reference panel with per-row keybinding remap (B3). */
export function HotkeysDialog({ open }: { open: boolean }) {
	const t = useT();
	const close = useUiStore(s => s.closeHotkeys);
	const overrides = useUiStore(s => s.keymapOverrides);
	const setKeymapOverride = useUiStore(s => s.setKeymapOverride);
	const resetKeymapOverrides = useUiStore(s => s.resetKeymapOverrides);
	const [query, setQuery] = useState("");
	const [capture, setCapture] = useState<CaptureState | null>(null);
	const [confirmingResetAll, setConfirmingResetAll] = useState(false);

	// Stays mounted through its exit animation, so every open starts from a clean
	// filter rather than the previous visit's search, capture or confirm state.
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setCapture(null);
		setConfirmingResetAll(false);
	}, [open]);

	// Capture mode: swallow every key at window-capture phase so nothing leaks
	// to App's global handler (window bubble) or the modal's own Escape-close
	// (document capture — later phase than window capture). Esc cancels.
	useEffect(() => {
		if (!capture) return;
		const onCaptureKey = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				setCapture(null);
				return;
			}
			const chord = chordFromEvent(event);
			if (chord) setCapture(current => (current ? { ...current, chord } : current));
		};
		window.addEventListener("keydown", onCaptureKey, true);
		return () => window.removeEventListener("keydown", onCaptureKey, true);
	}, [capture]);

	const captureAction = capture ? KEYMAP_ACTION_BY_ID[capture.actionId] : null;

	// Live conflict display for the captured chord: error on a user-user
	// collision (blocks save), warning on shadowing another action's default.
	const captureConflict: KeymapConflict | null = useMemo(() => {
		if (!capture?.chord) return null;
		const candidate = { ...overrides, [capture.actionId]: [capture.chord] };
		return detectConflicts(KEYMAP_ACTIONS, candidate).find(conflict => conflict.chord === capture.chord) ?? null;
	}, [capture, overrides]);

	const captureConflictLabel = useMemo(() => {
		if (!capture || !captureConflict) return null;
		const otherId = captureConflict.actionIds.find(id => id !== capture.actionId);
		const other = otherId ? KEYMAP_ACTION_BY_ID[otherId as KeymapActionId] : null;
		const params = { action: other ? t(other.labelKey) : (otherId ?? "") };
		return captureConflict.kind === "error"
			? t("hotkeys.remap.conflictUser", params)
			: t("hotkeys.remap.conflictShadow", params);
	}, [capture, captureConflict, t]);

	const groups = useMemo(() => {
		const resolve = (row: HotkeyRow): ResolvedRow => {
			if (isRemapRow(row)) {
				const action = KEYMAP_ACTION_BY_ID[row.actionId];
				return {
					label: t(action.labelKey),
					keys: (overrides[action.id] ?? action.defaults).join(" / "),
					actionId: row.actionId,
				};
			}
			return { label: t(row.labelKey), keys: row.keys, actionId: null };
		};
		const q = query.trim().toLowerCase();
		return HOTKEY_GROUPS.map(group => ({
			...group,
			rows: group.rows
				.map(resolve)
				.filter(row => !q || row.label.toLowerCase().includes(q) || row.keys.toLowerCase().includes(q)),
		})).filter(group => group.rows.length > 0);
	}, [query, t, overrides]);

	const saveCapture = () => {
		if (!capture?.chord || !captureAction || captureConflict?.kind === "error") return;
		setKeymapOverride(capture.actionId, [capture.chord]);
		toast({
			variant: "success",
			message: t("hotkeys.remap.saved", { action: t(captureAction.labelKey), chord: capture.chord }),
		});
		setCapture(null);
	};

	const resetRow = (actionId: KeymapActionId) => {
		setKeymapOverride(actionId, []);
		toast({
			variant: "success",
			message: t("hotkeys.remap.resetDone", { action: t(KEYMAP_ACTION_BY_ID[actionId].labelKey) }),
		});
	};

	const confirmResetAll = () => {
		resetKeymapOverrides();
		setConfirmingResetAll(false);
		setCapture(null);
		toast({ variant: "success", message: t("hotkeys.remap.resetAllDone") });
	};

	return (
		<Modal onClose={close} open={open} title={t("hotkeys.title")}>
			<div className="mb-3 flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<Input
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder={t("hotkeys.search")}
					/>
				</div>
				{confirmingResetAll ? (
					// Inline ✓/✕ confirm (0.3.0 convention): the confirm sits exactly
					// where "reset all" was; ✕ or clicking elsewhere cancels.
					<span className="flex shrink-0 items-center gap-0.5">
						<button
							type="button"
							title={t("common.confirm")}
							aria-label={t("common.confirm")}
							onClick={confirmResetAll}
							className="flex h-6 w-6 items-center justify-center rounded bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)] hover:brightness-110"
						>
							<Check size={12} strokeWidth={3} />
						</button>
						<button
							type="button"
							title={t("common.cancel")}
							aria-label={t("common.cancel")}
							onClick={() => setConfirmingResetAll(false)}
							className="flex h-6 w-6 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)]"
						>
							<X size={12} strokeWidth={3} />
						</button>
					</span>
				) : (
					<Button size="sm" variant="ghost" onClick={() => setConfirmingResetAll(true)}>
						{t("hotkeys.remap.resetAll")}
					</Button>
				)}
			</div>

			{capture && captureAction && (
				<div className="mb-3 rounded-lg border border-[var(--omp-border)] px-3 py-2">
					<div className="flex items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-omp-md text-[var(--omp-text)]">
							{t("hotkeys.remap.rebinding", { action: t(captureAction.labelKey) })}
						</span>
						<kbd className="shrink-0 rounded-md border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] px-2 py-0.5 font-mono text-omp-sm text-[var(--omp-muted)]">
							{capture.chord ?? t("hotkeys.remap.pressChord")}
						</kbd>
						<Button
							size="sm"
							variant="primary"
							disabled={!capture.chord || captureConflict?.kind === "error"}
							onClick={saveCapture}
						>
							{t("common.save")}
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setCapture(null)}>
							{t("common.cancel")}
						</Button>
					</div>
					<div className="mt-1 text-omp-sm text-[var(--omp-dim)]">{t("hotkeys.remap.captureHint")}</div>
					{captureConflictLabel && (
						<div
							className={`mt-1 text-omp-sm ${
								captureConflict?.kind === "error" ? "text-[var(--omp-error)]" : "text-[var(--omp-warning)]"
							}`}
						>
							{captureConflictLabel}
						</div>
					)}
				</div>
			)}

			{groups.length === 0 && (
				<div className="py-6 text-center text-omp-md text-[var(--omp-dim)]">{t("hotkeys.empty")}</div>
			)}
			{groups.map(group => (
				<div key={group.titleKey} className="mb-4 last:mb-0">
					<div className="mb-1.5 text-omp-sm font-semibold uppercase tracking-wide text-[var(--omp-dim)]">
						{t(group.titleKey)}
					</div>
					<div className="overflow-hidden rounded-lg border border-[var(--omp-border-muted)]">
						{group.rows.map(row => {
							const actionId = row.actionId;
							const hasOverride = actionId ? overrides[actionId] !== undefined : false;
							return (
								<div
									key={actionId ?? row.label}
									className="group flex items-center justify-between gap-4 px-3 py-2 text-omp-md"
								>
									<span className="text-[var(--omp-text)]">{row.label}</span>
									<span className="flex shrink-0 items-center gap-1">
										{actionId && (
											<>
												<button
													type="button"
													title={t("hotkeys.remap.rebind")}
													aria-label={t("hotkeys.remap.rebind")}
													onClick={() => setCapture({ actionId, chord: null })}
													className="hidden h-5 w-5 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)] group-hover:flex"
												>
													<Pencil size={11} />
												</button>
												{hasOverride && (
													<button
														type="button"
														title={t("hotkeys.remap.reset")}
														aria-label={t("hotkeys.remap.reset")}
														onClick={() => resetRow(actionId)}
														className="hidden h-5 w-5 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)] group-hover:flex"
													>
														<RotateCcw size={11} />
													</button>
												)}
											</>
										)}
										<kbd className="rounded-md border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] px-2 py-0.5 font-mono text-omp-sm text-[var(--omp-muted)]">
											{row.keys}
										</kbd>
									</span>
								</div>
							);
						})}
					</div>
				</div>
			))}
		</Modal>
	);
}
