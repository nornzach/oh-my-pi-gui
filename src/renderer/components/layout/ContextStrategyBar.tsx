/**
 * Context strategy row under the composer: the running model, what happens to
 * history when its context fills, and where that happens — one line, always
 * visible. Clicking it opens the controls (strategy, threshold, retention).
 *
 * The strategy logic lives in `lib/context-strategy`; this file renders it and
 * writes the chosen settings back through `set_setting`.
 */

import { Check, ChevronRight, Layers } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCompactionConfig } from "../../hooks/use-compaction-config";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import {
	CONTEXT_SETTING_PATHS,
	type CompactionConfig,
	compactionThreshold,
	detectStrategy,
	type ExpectedMethod,
	expectedMethod,
	isLossless,
	type ModelProfile,
	modelProfile,
	recommendStrategy,
	STRATEGY_IDS,
	type StrategyId,
	strategyPatch,
} from "../../lib/context-strategy";
import { cx, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { onEscape } from "../../lib/keymap";
import { useTabRpc } from "../../lib/tab-rpc";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { type SettingsStore, useSettingsStore } from "../../stores/settings";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";

const POPOVER_WIDTH = 400;
const EDGE = 12;
const THRESHOLD_CHOICES = [70, 80, 90];
const KEEP_RECENT_CHOICES = [20_000, 40_000, 80_000];

function Segmented<T extends number>({
	label,
	value,
	options,
	format,
	autoLabel,
	onChange,
	disabled,
}: {
	label: string;
	value: T | -1;
	options: readonly T[];
	format: (value: T) => string;
	/** When set, a leading choice for the agent's default (`-1`). */
	autoLabel?: string;
	onChange: (value: T | -1) => void;
	disabled: boolean;
}) {
	// A value set outside the offered choices (edited in Settings) still shows, selected.
	const shown: Array<T | -1> = [...(autoLabel ? [-1 as const] : []), ...options];
	if (!shown.includes(value)) shown.push(value);
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-omp-sm text-(--omp-muted)">{label}</span>
			<div
				role="radiogroup"
				aria-label={label}
				className="flex overflow-hidden rounded-md border border-(--omp-border-muted)"
			>
				{shown.map(option => (
					<button
						key={option}
						type="button"
						role="radio"
						aria-checked={option === value}
						disabled={disabled}
						onClick={() => option !== value && onChange(option)}
						className={cx(
							"omp-pressable h-6 px-2 text-omp-xs tabular-nums disabled:opacity-50",
							option === value
								? "bg-(--omp-selected-bg) font-medium text-(--omp-text)"
								: "text-(--omp-muted) hover:bg-(--omp-bg-tertiary)",
						)}
					>
						{option === -1 ? autoLabel : format(option as T)}
					</button>
				))}
			</div>
		</div>
	);
}

function Switch({
	label,
	hint,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	hint?: string;
	checked: boolean;
	onChange: (next: boolean) => void;
	disabled: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className="omp-pressable flex w-full items-start justify-between gap-3 rounded-md py-1 text-left disabled:opacity-50"
		>
			<span className="min-w-0">
				<span className="block text-omp-sm text-(--omp-text-secondary)">{label}</span>
				{hint && <span className="block text-omp-xs text-(--omp-dim)">{hint}</span>}
			</span>
			<span
				aria-hidden
				className={cx(
					"relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors",
					checked ? "bg-(--omp-switch-on)" : "bg-(--omp-switch-off)",
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

function Chip({ on, children }: { on: boolean; children: ReactNode }) {
	return (
		<span
			className={cx(
				"inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-omp-xxs",
				on
					? "border-[color-mix(in_srgb,var(--omp-success)_35%,transparent)] text-(--omp-success)"
					: "border-(--omp-border-muted) text-(--omp-dim)",
			)}
		>
			{on && <Check size={9} strokeWidth={3} />}
			{children}
		</span>
	);
}

function methodKey(method: ExpectedMethod | null): string {
	return method ?? "none";
}

export function ContextStrategyBar() {
	const t = useT();
	const rpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const model = useModelStore(state => state.model);
	const ready = useSessionStore(state => state.status) === "ready";
	const autoCompaction = useSettingsStore(state => state.autoCompaction);
	const openSettings = useUiStore(state => state.openSettings);
	const { config, saving, write } = useCompactionConfig();
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
	const { mounted, closing } = useOverlayPresence(open);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (!open || !triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		const viewportWidth = Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1024;
		const viewportHeight = Number.isFinite(window.innerHeight) && window.innerHeight > 0 ? window.innerHeight : 768;
		const width = Math.min(POPOVER_WIDTH, viewportWidth - EDGE * 2);
		setPos({
			left: Math.max(EDGE, Math.min(rect.left, viewportWidth - width - EDGE)),
			bottom: viewportHeight - rect.top + 6,
			width,
		});
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => onEscape(event, () => setOpen(false));
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	// Reserve the row so the composer does not jump when the first read lands.
	if (!ready || !config || !model) return <div aria-hidden className="h-6" />;

	const profile: ModelProfile = modelProfile(model);
	const strategy = detectStrategy(config);
	const recommended = recommendStrategy(profile);
	const method = expectedMethod(config, profile);
	const threshold = compactionThreshold(config, profile);
	const modelName = model.name ?? model.id;
	const windowText = profile.windowTokens ? formatTokens(profile.windowTokens) : null;
	const methodName = t(`contextStrategy.method.${methodKey(method)}`);
	const atText = threshold !== null ? t("contextStrategy.at", { tokens: formatTokens(threshold) }) : null;
	// Nudge only a reader still on the defaults: someone who chose a strategy knows why.
	const suggest = strategy === "balanced" && recommended.strategy !== "balanced";

	const applyStrategy = async (id: StrategyId) => {
		if (strategy === id) return;
		await write(strategyPatch(id));
	};
	const toggleAutoCompaction = async (next: boolean) => {
		const settings = sessionRuntimeStore<SettingsStore>(tabId, "settings") ?? useSettingsStore;
		try {
			const response = await rpc.setAutoCompaction(next);
			if (!response.success) throw new Error(response.error);
			const state = await rpc.getState();
			if (state.success)
				settings.getState().setFromState(state.data as Parameters<SettingsStore["setFromState"]>[0]);
		} catch (cause) {
			toast({ variant: "error", title: t("contextStrategy.saveFailed"), message: String(cause) });
		}
	};

	return (
		<div className="omp-context-bar flex h-6 min-w-0 items-center px-1">
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={t("contextStrategy.title")}
				onClick={() => setOpen(value => !value)}
				title={t("contextStrategy.title")}
				className="omp-pressable flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-omp-xs text-(--omp-dim) hover:bg-(--omp-selected-bg) hover:text-(--omp-muted)"
			>
				<Layers aria-hidden size={12} className="shrink-0" />
				<span className="omp-context-bar-model flex min-w-0 items-center gap-1.5">
					<span className="max-w-40 truncate">{modelName}</span>
					{windowText && <span className="shrink-0 tabular-nums">{windowText}</span>}
					<span aria-hidden>·</span>
				</span>
				<span className="shrink-0 font-medium text-(--omp-muted)">{t(`contextStrategy.strategy.${strategy}`)}</span>
				{autoCompaction ? (
					<span className="omp-context-bar-detail flex min-w-0 items-center gap-1.5">
						<span aria-hidden>·</span>
						<span className="truncate">{methodName}</span>
						{atText && <span className="shrink-0 tabular-nums">{atText}</span>}
					</span>
				) : (
					<span className="omp-context-bar-detail flex items-center gap-1.5 text-(--omp-warning)">
						<span aria-hidden>·</span>
						{t("contextStrategy.off")}
					</span>
				)}
				{suggest && (
					<span
						role="img"
						aria-label={t("contextStrategy.suggested", {
							strategy: t(`contextStrategy.strategy.${recommended.strategy}`),
						})}
						className="size-1.5 shrink-0 rounded-full bg-(--omp-warning)"
					/>
				)}
			</button>

			{mounted &&
				pos &&
				createPortal(
					<div
						ref={popoverRef}
						role="dialog"
						aria-label={t("contextStrategy.title")}
						aria-hidden={closing || undefined}
						inert={closing}
						style={{ left: pos.left, bottom: pos.bottom, width: pos.width }}
						className={cx(
							"fixed z-[100] rounded-xl border border-(--omp-border) bg-(--omp-panel-bg) p-3 shadow-(--omp-shadow-md)",
							closing ? "omp-scale-out pointer-events-none" : "omp-pop-in",
						)}
					>
						<ModelSummary name={modelName} provider={model.provider} profile={profile} />

						<div role="radiogroup" aria-label={t("contextStrategy.strategyLabel")} className="mt-3 space-y-1">
							{STRATEGY_IDS.map(id => (
								<StrategyRow
									key={id}
									id={id}
									selected={strategy === id}
									recommended={recommended.strategy === id}
									disabled={saving}
									onSelect={() => void applyStrategy(id)}
								/>
							))}
							{strategy === "custom" && (
								<div
									role="radio"
									aria-checked
									className="rounded-lg bg-(--omp-selected-bg) px-2.5 py-1.5 text-omp-sm font-medium text-(--omp-text)"
								>
									{t("contextStrategy.strategy.custom")}
									<span className="block text-omp-xs font-normal text-(--omp-dim)">
										{t("contextStrategy.strategy.custom.desc")}
									</span>
								</div>
							)}
						</div>

						<Outcome
							config={config}
							method={method}
							threshold={threshold}
							suggestionKey={suggest ? recommended.reasonKey : null}
						/>

						<div className="mt-3 space-y-2 border-t border-(--omp-border-muted) pt-3">
							<Segmented
								label={t("contextStrategy.compactAt")}
								value={config.thresholdPercent}
								options={THRESHOLD_CHOICES}
								format={value => `${value}%`}
								autoLabel={t("contextStrategy.auto")}
								disabled={saving}
								onChange={value => void write([{ path: CONTEXT_SETTING_PATHS.thresholdPercent, value }])}
							/>
							<Segmented
								label={t("contextStrategy.keepRecent")}
								value={config.keepRecentTokens}
								options={KEEP_RECENT_CHOICES}
								format={formatTokens}
								disabled={saving}
								onChange={value => void write([{ path: CONTEXT_SETTING_PATHS.keepRecentTokens, value }])}
							/>
							<Switch
								label={t("contextStrategy.autoCompact")}
								checked={autoCompaction}
								disabled={saving}
								onChange={next => void toggleAutoCompaction(next)}
							/>
							<Switch
								label={t("contextStrategy.promotion")}
								hint={t("contextStrategy.promotionHint")}
								checked={config.promotion}
								disabled={saving}
								onChange={next => void write([{ path: CONTEXT_SETTING_PATHS.promotion, value: next }])}
							/>
						</div>

						<div className="mt-3 flex items-center justify-between gap-3 border-t border-(--omp-border-muted) pt-2.5 text-omp-xs text-(--omp-dim)">
							<span>{t("contextStrategy.scope")}</span>
							<button
								type="button"
								onClick={() => {
									setOpen(false);
									openSettings("context");
								}}
								className="omp-pressable flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-text)"
							>
								{t("contextStrategy.allSettings")}
								<ChevronRight size={12} />
							</button>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}

function ModelSummary({ name, provider, profile }: { name: string; provider: string; profile: ModelProfile }) {
	const t = useT();
	return (
		<div>
			<div className="flex items-baseline justify-between gap-3">
				<span className="min-w-0 truncate text-omp-md font-semibold text-(--omp-text)">{name}</span>
				<span className="shrink-0 text-omp-xs text-(--omp-dim)">{provider}</span>
			</div>
			<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
				<span className="text-omp-xs tabular-nums text-(--omp-muted)">
					{profile.windowTokens
						? t("contextStrategy.window", { size: formatTokens(profile.windowTokens) })
						: t("contextStrategy.windowUnknown")}
				</span>
				<Chip on={profile.vision}>
					{t(profile.vision ? "contextStrategy.capability.vision" : "contextStrategy.capability.noVision")}
				</Chip>
				<Chip on={profile.nativeRemote}>
					{t(profile.nativeRemote ? "contextStrategy.capability.native" : "contextStrategy.capability.noNative")}
				</Chip>
			</div>
		</div>
	);
}

function StrategyRow({
	id,
	selected,
	recommended,
	disabled,
	onSelect,
}: {
	id: StrategyId;
	selected: boolean;
	recommended: boolean;
	disabled: boolean;
	onSelect: () => void;
}) {
	const t = useT();
	return (
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			disabled={disabled}
			onClick={onSelect}
			className={cx(
				"omp-pressable flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left disabled:opacity-60",
				selected ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)",
			)}
		>
			<span
				aria-hidden
				className={cx(
					"mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
					selected ? "border-(--omp-accent)" : "border-(--omp-border-strong)",
				)}
			>
				{selected && <span className="size-1.5 rounded-full bg-(--omp-accent)" />}
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-1.5">
					<span className="text-omp-sm font-medium text-(--omp-text)">{t(`contextStrategy.strategy.${id}`)}</span>
					{recommended && (
						<span className="rounded-full border border-(--omp-border-accent) px-1.5 text-omp-xxs text-(--omp-accent)">
							{t("contextStrategy.recommended")}
						</span>
					)}
					{id === "notes" && (
						<span className="rounded-full border border-(--omp-border-muted) px-1.5 text-omp-xxs text-(--omp-dim)">
							{t("contextStrategy.experimental")}
						</span>
					)}
				</span>
				<span className="block text-omp-xs leading-snug text-(--omp-dim)">
					{t(`contextStrategy.strategy.${id}.desc`)}
				</span>
			</span>
		</button>
	);
}

/** What will actually happen for this model under the current settings, in one sentence. */
function Outcome({
	config,
	method,
	threshold,
	suggestionKey,
}: {
	config: CompactionConfig;
	method: ExpectedMethod | null;
	threshold: number | null;
	suggestionKey: "native" | "vision" | "text" | null;
}) {
	const t = useT();
	const key = methodKey(method);
	return (
		<div className="mt-3 rounded-lg border border-(--omp-border-muted) px-2.5 py-2 text-omp-xs leading-snug text-(--omp-muted)">
			<div>
				{threshold !== null
					? t("contextStrategy.outcome", {
							tokens: formatTokens(threshold),
							method: t(`contextStrategy.method.${key}`),
						})
					: t("contextStrategy.outcomeNoWindow", { method: t(`contextStrategy.method.${key}`) })}
			</div>
			<div className="mt-0.5 text-(--omp-dim)">{t(`contextStrategy.method.${key}.desc`)}</div>
			{method !== null && (
				<div className={cx("mt-1", isLossless(method) ? "text-(--omp-success)" : "text-(--omp-dim)")}>
					{t(isLossless(method) ? "contextStrategy.lossless" : "contextStrategy.lossy")}
				</div>
			)}
			{suggestionKey && config.methodOrder.length > 0 && (
				<div className="mt-1.5 border-t border-(--omp-border-muted) pt-1.5 text-(--omp-warning)">
					{t(`contextStrategy.reason.${suggestionKey}`)}
				</div>
			)}
		</div>
	);
}
