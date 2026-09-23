import { CircleGauge, LoaderCircle, RotateCw } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RpcContextReportResult } from "../../../shared/rpc-types";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { contextUsageView, formatContextUsage } from "../../lib/context-usage";
import { cx, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { Button } from "../common";

interface AnchorPosition {
	bottom?: number;
	left: number;
	top?: number;
	width: number;
}

interface UsageCategory {
	color: string;
	key: "messages" | "system" | "tools";
	tokens: number;
}

const POPOVER_WIDTH = 336;
const POPOVER_ESTIMATED_HEIGHT = 220;
const VIEWPORT_EDGE = 12;

function approximateTokens(tokens: number): string {
	return tokens > 0 ? `~${formatTokens(tokens)}` : "0";
}

/**
 * Compact context control beside Send. The idle surface is one icon; hover,
 * focus or click reveals the native provider-anchored token breakdown without
 * opening the full context-report modal.
 */
export function ContextUsagePopover() {
	const t = useT();
	const rpc = useTabRpc();
	const contextUsage = useSessionStore(state => state.contextUsage);
	const sessionId = useSessionStore(state => state.sessionId);
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const [open, setOpen] = useState(false);
	const [pinned, setPinned] = useState(false);
	const [anchor, setAnchor] = useState<AnchorPosition | null>(null);
	const [report, setReport] = useState<RpcContextReportResult | null>(null);
	const [loadedKey, setLoadedKey] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const closeTimer = useRef<number | undefined>(undefined);
	const { mounted, closing } = useOverlayPresence(open);

	const usageKey = contextUsage ? `${sessionId}:${contextUsage.tokens}:${contextUsage.contextWindow}` : "";

	const updateAnchor = useCallback(() => {
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;
		const viewportWidth = Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1024;
		const viewportHeight = Number.isFinite(window.innerHeight) && window.innerHeight > 0 ? window.innerHeight : 768;
		const width = Math.min(POPOVER_WIDTH, viewportWidth - VIEWPORT_EDGE * 2);
		const left = Math.max(VIEWPORT_EDGE, Math.min(rect.right - width, viewportWidth - width - VIEWPORT_EDGE));
		if (rect.top >= POPOVER_ESTIMATED_HEIGHT + VIEWPORT_EDGE) {
			setAnchor({ bottom: viewportHeight - rect.top + 10, left, width });
			return;
		}
		setAnchor({ left, top: rect.bottom + 10, width });
	}, []);

	const cancelScheduledClose = useCallback(() => {
		if (closeTimer.current !== undefined) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = undefined;
		}
	}, []);

	const reveal = useCallback(() => {
		cancelScheduledClose();
		updateAnchor();
		setOpen(true);
	}, [cancelScheduledClose, updateAnchor]);

	const dismiss = useCallback(() => {
		cancelScheduledClose();
		setOpen(false);
		setPinned(false);
	}, [cancelScheduledClose]);

	const scheduleClose = useCallback(() => {
		if (pinned) return;
		cancelScheduledClose();
		closeTimer.current = window.setTimeout(() => setOpen(false), 120);
	}, [cancelScheduledClose, pinned]);

	useEffect(() => () => cancelScheduledClose(), [cancelScheduledClose]);

	useEffect(() => {
		if (!open) return;
		const onViewportChange = () => updateAnchor();
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
			dismiss();
		};
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Claim the keypress: the app-wide Escape handler runs next on window and
			// would abort the active turn in the same keystroke that closed this popover.
			event.preventDefault();
			dismiss();
		};
		window.addEventListener("resize", onViewportChange);
		window.addEventListener("scroll", onViewportChange, true);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("resize", onViewportChange);
			window.removeEventListener("scroll", onViewportChange, true);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [dismiss, open, updateAnchor]);

	const [attempt, setAttempt] = useState(0);

	/* The retry button's bump is the only reason this effect re-runs; nothing
	   inside reads it. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: retry re-reads by bump
	useEffect(() => {
		if (!open || !sidecarReady || !usageKey || usageKey === loadedKey) return;
		let cancelled = false;
		setLoading(true);
		setError(false);
		void rpc
			.getContextReport()
			.then(response => {
				if (cancelled) return;
				if (response.success) {
					setReport(response.data as RpcContextReportResult);
					setLoadedKey(usageKey);
				} else {
					setError(true);
				}
			})
			.catch(() => {
				if (!cancelled) setError(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [attempt, loadedKey, open, sidecarReady, usageKey, rpc]);

	const breakdown = loadedKey === usageKey ? report?.breakdown : undefined;
	const view = contextUsageView(contextUsage, breakdown);
	const { capacityKnown, contextWindow, percent, remainingTokens, usedTokens } = view;
	const categories = useMemo<UsageCategory[]>(() => {
		if (!breakdown) return [];
		return [
			{
				color: "var(--omp-dim)",
				key: "system",
				tokens: breakdown.systemPromptTokens + breakdown.systemContextTokens + breakdown.skillsTokens,
			},
			{ color: "var(--omp-status-model)", key: "tools", tokens: breakdown.systemToolsTokens },
			{ color: "var(--omp-status-context)", key: "messages", tokens: breakdown.messagesTokens },
		].filter(category => category.tokens > 0) as UsageCategory[];
	}, [breakdown]);

	if (!contextUsage) return null;

	const triggerLabel = capacityKnown
		? t("contextUsage.open", { percent: Math.round(percent) })
		: t("contextUsage.windowUnknown");

	const popoverStyle: CSSProperties | undefined = anchor
		? { bottom: anchor.bottom, left: anchor.left, top: anchor.top, width: anchor.width }
		: undefined;

	return (
		<div className="relative shrink-0" onMouseEnter={reveal} onMouseLeave={scheduleClose}>
			<button
				aria-controls="omp-context-usage-popover"
				aria-expanded={open}
				aria-label={triggerLabel}
				className={`omp-context-usage-trigger omp-pressable flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 ${
					open
						? "text-[var(--omp-link)] ring-1 ring-[var(--omp-link)]"
						: "text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-muted)]"
				}`}
				onBlur={scheduleClose}
				onClick={() => {
					if (open && pinned) {
						dismiss();
						return;
					}
					reveal();
					setPinned(true);
				}}
				onFocus={reveal}
				ref={buttonRef}
				title={
					capacityKnown
						? t("input.contextTooltip", { percent: Math.round(percent) })
						: t("contextUsage.windowUnknown")
				}
				type="button"
			>
				<CircleGauge aria-hidden="true" size={14} strokeWidth={2} />
				<span className="font-mono text-omp-xs tabular-nums">{formatContextUsage(view)}</span>
			</button>

			{mounted &&
				anchor &&
				createPortal(
					<div
						aria-hidden={closing || undefined}
						aria-label={t("contextUsage.title")}
						className={cx(
							"fixed z-[80] rounded-[18px] border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] p-4 shadow-[var(--omp-shadow-lg)]",
							closing ? "omp-scale-out pointer-events-none" : "omp-pop-in",
						)}
						id="omp-context-usage-popover"
						inert={closing}
						onMouseEnter={cancelScheduledClose}
						onMouseLeave={scheduleClose}
						ref={popoverRef}
						role="group"
						style={popoverStyle}
					>
						<div className="flex items-baseline justify-between gap-4">
							<span className="text-omp-lg text-[var(--omp-muted)]">
								{t("contextUsage.used")}{" "}
								{capacityKnown && (
									<strong className="ml-1 font-semibold text-[var(--omp-text)]">{`${Math.round(percent)}%`}</strong>
								)}
							</span>
							<span className="shrink-0 font-mono text-omp-lg font-semibold tabular-nums text-[var(--omp-text)]">
								{capacityKnown
									? `${approximateTokens(usedTokens)} / ${formatTokens(contextWindow)}`
									: approximateTokens(usedTokens)}
							</span>
						</div>

						{capacityKnown && (
							<div
								aria-label={t("contextUsage.progress", { percent: Math.round(percent) })}
								aria-valuemax={100}
								aria-valuemin={0}
								aria-valuenow={Math.round(percent)}
								aria-valuetext={`${formatTokens(usedTokens)} ${t("contextUsage.used")}, ${formatTokens(remainingTokens)} ${t("contextUsage.remaining")}`}
								className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-[var(--omp-progress-bg)]"
								role="progressbar"
							>
								{categories.length > 0 ? (
									categories.map(category => (
										<span
											aria-hidden="true"
											key={category.key}
											style={{
												backgroundColor: category.color,
												width: `${Math.min(100, (category.tokens / contextWindow) * 100)}%`,
											}}
										/>
									))
								) : (
									<span
										aria-hidden="true"
										className="bg-[var(--omp-status-context)]"
										style={{ width: `${percent}%` }}
									/>
								)}
							</div>
						)}

						{capacityKnown ? (
							<div className="mt-3 grid grid-cols-2 gap-2">
								<div className="rounded-lg border border-[var(--omp-border-muted)] px-2.5 py-2">
									<span className="block text-omp-xs text-[var(--omp-dim)]">{t("contextUsage.used")}</span>
									<span className="font-mono text-omp-lg font-semibold tabular-nums text-[var(--omp-text)]">
										{formatTokens(usedTokens)}
									</span>
								</div>
								<div className="rounded-lg border border-[var(--omp-border-muted)] px-2.5 py-2">
									<span className="block text-omp-xs text-[var(--omp-dim)]">
										{t("contextUsage.remaining")}
									</span>
									<span className="font-mono text-omp-lg font-semibold tabular-nums text-[var(--omp-text)]">
										{formatTokens(remainingTokens)}
									</span>
								</div>
							</div>
						) : (
							<div className="mt-3 rounded-lg border border-[var(--omp-border-muted)] px-2.5 py-2 text-omp-md text-[var(--omp-dim)]">
								{t("contextUsage.windowUnknown")}
							</div>
						)}

						{loading && categories.length === 0 ? (
							<div className="flex items-center gap-2 py-5 text-omp-md text-[var(--omp-dim)]">
								<LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
								{t("contextUsage.loading")}
							</div>
						) : error && categories.length === 0 ? (
							<div className="flex flex-col items-start gap-2 py-4">
								<p role="alert" className="text-omp-md text-[var(--omp-dim)]">
									{t("contextUsage.unavailable")}
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
						) : (
							<div className="mt-3 space-y-2.5">
								{categories.map(category => (
									<div className="flex items-center gap-2.5" key={category.key}>
										<span
											aria-hidden="true"
											className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
											style={{ backgroundColor: category.color }}
										/>
										<span className="min-w-0 flex-1 truncate text-omp-lg text-[var(--omp-muted)]">
											{t(`contextUsage.category.${category.key}`)}
										</span>
										<span className="shrink-0 font-mono text-omp-lg tabular-nums text-[var(--omp-text)]">
											{approximateTokens(category.tokens)}
										</span>
									</div>
								))}
							</div>
						)}
					</div>,
					document.body,
				)}
		</div>
	);
}
