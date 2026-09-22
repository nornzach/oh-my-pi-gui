import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useDisplayPreference } from "../../lib/display-preferences";
import { onEscape } from "../../lib/keymap";
/**
 * Compact composer entry for session modes and lower-frequency coding
 * toggles. The trigger surfaces active mode count; the menu keeps every
 * existing control reachable without turning the primary toolbar into a
 * second settings row.
 */

import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RpcResponse, RpcSessionState } from "../../../shared/rpc-types";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { loopLimitText, parseLoopLimit } from "../../lib/loop-mode";
import { useTabRpc } from "../../lib/tab-rpc";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { type SettingsStore, useSettingsStore } from "../../stores/settings";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";

const triggerClass = (active: boolean) =>
	cx(
		"omp-pressable flex h-8 items-center gap-1.5 rounded-lg border px-2 text-omp-md font-medium",
		active
			? "border-[var(--omp-border-accent)] bg-[var(--omp-accent-dim)] text-[var(--omp-accent)]"
			: "border-transparent text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)]",
	);

export function ComposerModes() {
	const t = useT();
	const rpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const planModeEnabled = useSessionStore(s => s.planModeEnabled);
	const goalActive = useSessionStore(s => s.goalState?.status === "active" || !!s.goal);
	const goalObjective = useSessionStore(s => s.goal?.objective ?? null);
	const loopMode = useSessionStore(s => s.loopMode);
	const loopActive = loopMode?.enabled === true;
	const vibeModeEnabled = useSessionStore(s => s.vibeModeEnabled);
	const goalStatusInFooter = useDisplayPreference("goalStatusInFooter");
	const autoCompaction = useSettingsStore(s => s.autoCompaction);
	const autoRetry = useSettingsStore(s => s.autoRetry);
	const steeringMode = useSettingsStore(s => s.steeringMode);
	const interruptMode = useSettingsStore(s => s.interruptMode);
	const openModelRoles = useUiStore(s => s.openModelRoles);
	const openModes = useUiStore(s => s.openModes);

	const [pending, setPending] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const { mounted: menuMounted, closing: menuClosing } = useOverlayPresence(menuOpen);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

	const loopLimit = loopMode ? parseLoopLimit(loopMode.limit) : null;
	const loopArgs = loopLimit ? loopLimitText(t, loopLimit) : t("modesPanel.loop.noLimit");
	const activeModeLabels = [
		planModeEnabled ? t("input.plan.label") : null,
		goalStatusInFooter && goalActive ? t("modesPanel.tabs.goal") : null,
		loopActive ? t("modesPanel.tabs.loop") : null,
		vibeModeEnabled ? t("modesPanel.tabs.vibe") : null,
	].filter((label): label is string => label !== null);
	const triggerTitle =
		activeModeLabels.length > 0
			? t("input.modes.activeTitle", { modes: activeModeLabels.join(" · ") })
			: t("input.modes.title");

	useLayoutEffect(() => {
		if (!menuOpen || !triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		const viewportWidth = Number.isFinite(window.innerWidth) ? window.innerWidth : rect.left + 264;
		const viewportHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : rect.top;
		setPos({
			left: Math.max(8, Math.min(rect.left, viewportWidth - 264)),
			bottom: viewportHeight - rect.top + 6,
		});
	}, [menuOpen]);

	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
			setMenuOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			onEscape(event, () => setMenuOpen(false));
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [menuOpen]);

	const update = async (action: () => Promise<RpcResponse>, mode: "settings" | "plan" = "settings") => {
		if (pending) return;
		const session = sessionRuntimeStore<SessionStore>(tabId, "session") ?? useSessionStore;
		const settings = sessionRuntimeStore<SettingsStore>(tabId, "settings") ?? useSettingsStore;
		const originSession = session.getState().sessionId;
		setPending(true);
		try {
			const response = await action();
			if (!response.success) throw new Error(response.error);
			const plan = response.data as { enabled?: boolean } | undefined;
			if (mode === "plan" && typeof plan?.enabled === "boolean") {
				if (session.getState().sessionId === originSession) session.setState({ planModeEnabled: plan.enabled });
				return;
			}
			const current = await rpc.getState();
			if (!current.success) throw new Error(current.error);
			if (session.getState().sessionId !== originSession) return;
			const state = current.data as RpcSessionState;
			settings.getState().setFromState(state);
			session.setState({ planModeEnabled: state.planModeEnabled });
		} catch (cause) {
			toast({ variant: "error", title: t("modesPanel.actionFailed"), message: String(cause) });
		} finally {
			setPending(false);
		}
	};

	const togglePlan = () => void update(() => rpc.setPlanMode(!planModeEnabled), "plan");

	const select = (action: () => void) => {
		setMenuOpen(false);
		action();
	};

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={menuOpen}
				aria-haspopup="menu"
				onClick={() => setMenuOpen(value => !value)}
				title={triggerTitle}
				className={triggerClass(activeModeLabels.length > 0)}
			>
				<SlidersHorizontal size={14} />
				<span className="omp-composer-control-label">{t("modesPanel.title")}</span>
				{activeModeLabels.length > 0 && (
					<span className="rounded-full bg-(--omp-btn-primary-bg) px-1.5 text-omp-xs leading-4 text-(--omp-btn-primary-text) tabular-nums">
						{activeModeLabels.length}
					</span>
				)}
				<ChevronDown size={12} className="shrink-0 text-[var(--omp-dim)]" />
			</button>

			{menuMounted && pos
				? createPortal(
						<div
							ref={menuRef}
							style={{ left: pos.left, bottom: pos.bottom }}
							aria-hidden={menuClosing || undefined}
							className={cx(
								"fixed z-[100] w-64 overflow-hidden rounded-xl border border-[var(--omp-border)] bg-[var(--omp-panel-bg)] p-1 shadow-[var(--omp-shadow-md)]",
								menuClosing ? "omp-scale-out pointer-events-none" : "omp-pop-in",
							)}
							role="menu"
							aria-busy={pending}
							inert={pending || menuClosing}
						>
							<ModeRow
								label={t("input.plan.label")}
								title={t("input.plan.title")}
								checked={planModeEnabled}
								onSelect={() => select(togglePlan)}
							/>
							{goalStatusInFooter && (
								<ModeRow
									label={t("modesPanel.tabs.goal")}
									title={
										goalActive && goalObjective
											? t("input.goal.activeTitle", { objective: goalObjective })
											: t("input.goal.title")
									}
									checked={goalActive}
									onSelect={() => select(() => openModes("goal"))}
								/>
							)}
							<ModeRow
								label={t("modesPanel.tabs.loop")}
								title={loopActive ? t("input.loop.activeTitle", { args: loopArgs }) : t("input.loop.title")}
								checked={loopActive}
								onSelect={() => select(() => openModes("loop"))}
							/>
							<ModeRow
								label={t("modesPanel.tabs.vibe")}
								title={t("modesPanel.tabs.vibe")}
								checked={vibeModeEnabled}
								onSelect={() => select(() => openModes("vibe"))}
							/>
							<ModeRow
								label={t("input.roles.label")}
								title={t("input.roles.title")}
								checked={false}
								onSelect={() => select(openModelRoles)}
							/>
							<div className="mx-2 my-1 border-t border-[var(--omp-border-muted)]" />
							<div className="px-2.5 pt-1 pb-0.5 text-omp-xs font-semibold uppercase tracking-wide text-[var(--omp-dim)]">
								{t("input.more.label")}
							</div>
							<MoreRow
								label={t("input.more.autoCompact")}
								checked={autoCompaction}
								onToggle={() => void update(() => rpc.setAutoCompaction(!autoCompaction))}
							/>
							<MoreRow
								label={t("input.more.autoRetry")}
								checked={autoRetry}
								onToggle={() => void update(() => rpc.setAutoRetry(!autoRetry))}
							/>
							<MoreRow
								label={t("input.more.steeringAll")}
								checked={steeringMode === "all"}
								onToggle={() => {
									const next = steeringMode === "all" ? "one-at-a-time" : "all";
									void update(() => rpc.setSteeringMode(next));
								}}
							/>
							<MoreRow
								label={t("input.more.interruptImmediate")}
								checked={interruptMode === "immediate"}
								onToggle={() => {
									const next = interruptMode === "immediate" ? "wait" : "immediate";
									void update(() => rpc.setInterruptMode(next));
								}}
							/>
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}

function ModeRow({
	label,
	title,
	checked,
	onSelect,
}: {
	label: string;
	title: string;
	checked: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={checked}
			className="omp-pressable flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-omp-md font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
			onClick={onSelect}
			title={title}
			role="menuitem"
		>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{checked && <Check size={13} className="shrink-0 text-[var(--omp-accent)]" strokeWidth={3} />}
		</button>
	);
}

function MoreRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			onClick={onToggle}
			role="menuitemcheckbox"
			aria-checked={checked}
			className="omp-pressable flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-omp-md font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
		>
			<span className="truncate">{label}</span>
			<span
				className={cx(
					"relative h-4 w-7 shrink-0 rounded-full transition-colors",
					checked ? "bg-[var(--omp-accent)]" : "bg-[var(--omp-border-strong)]",
				)}
			>
				<span
					className={cx(
						"absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left]",
						checked ? "left-3.5" : "left-0.5",
					)}
				/>
			</span>
		</button>
	);
}
