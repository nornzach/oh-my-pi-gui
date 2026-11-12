import { CircleGauge, LoaderCircle, RotateCw } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useContextReport } from "../../hooks/use-context-report";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { contextSegments, contextUsageView, formatContextUsage } from "../../lib/context-usage";
import { cx, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";
import { Button } from "../common";
import { ContextBreakdown } from "./ContextBreakdown";

interface AnchorPosition {
	bottom?: number;
	left: number;
	top?: number;
	width: number;
}

const POPOVER_WIDTH = 336;
const POPOVER_ESTIMATED_HEIGHT = 220;
const VIEWPORT_EDGE = 12;

function approximateTokens(tokens: number): string {
	return tokens > 0 ? `~${formatTokens(tokens)}` : "0";
}

/**
 * Compact context control in the context row under the composer. The idle surface is one icon; hover,
 * focus or click reveals the native provider-anchored token breakdown without
 * opening the full context-report modal. `autoCompactAt` is where the strategy
 * bar says compaction fires (null when it is off), so the buffer drawn here
 * matches the threshold shown beside it.
 */
export function ContextUsagePopover({ autoCompactAt = null }: { autoCompactAt?: number | null }) {
	const t = useT();
	const openContextReport = useUiStore(state => state.openContextReport);
	const [open, setOpen] = useState(false);
	const [pinned, setPinned] = useState(false);
	const [anchor, setAnchor] = useState<AnchorPosition | null>(null);
	const { contextUsage, breakdown, loading, error, retry } = useContextReport(open);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const closeTimer = useRef<number | undefined>(undefined);
	const { mounted, closing } = useOverlayPresence(open);

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

	const view = contextUsageView(contextUsage, breakdown);
	const { capacityKnown, contextWindow, percent, usedTokens } = view;
	const segments = breakdown ? contextSegments(breakdown, view, autoCompactAt) : [];

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
				className={`omp-context-usage-trigger omp-pressable flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 ${
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
				{capacityKnown ? (
					<>
						<UsageRing percent={percent} />
						<span className="text-omp-xs tabular-nums">
							{t("contextUsage.ofWindow", {
								percent: Math.round(percent),
								window: formatTokens(contextWindow ?? 0),
							})}
						</span>
					</>
				) : (
					<>
						<CircleGauge aria-hidden="true" size={14} strokeWidth={2} />
						<span className="font-mono text-omp-xs tabular-nums">{formatContextUsage(view)}</span>
					</>
				)}
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

						{capacityKnown ? null : (
							<div className="mt-3 rounded-lg border border-[var(--omp-border-muted)] px-2.5 py-2 text-omp-md text-[var(--omp-dim)]">
								{t("contextUsage.windowUnknown")}
							</div>
						)}

						<ContextBreakdown approximate className="mt-3" segments={segments} view={view} />

						{loading && segments.length === 0 ? (
							<div className="flex items-center gap-2 py-5 text-omp-md text-[var(--omp-dim)]">
								<LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
								{t("contextUsage.loading")}
							</div>
						) : error && segments.length === 0 ? (
							<div className="flex flex-col items-start gap-2 py-4">
								<p role="alert" className="text-omp-md text-[var(--omp-dim)]">
									{t("contextUsage.unavailable")}
								</p>
								<Button icon={<RotateCw size={12} />} onClick={retry} size="sm" variant="secondary">
									{t("common.retry")}
								</Button>
							</div>
						) : null}
						<Button
							className="mt-3 w-full"
							onClick={() => {
								dismiss();
								openContextReport();
							}}
							size="sm"
							variant="ghost"
						>
							{t("contextUsage.fullReport")}
						</Button>
					</div>,
					document.body,
				)}
		</div>
	);
}

/** A small ring that fills as the context window does; warns past 80%. */
function UsageRing({ percent }: { percent: number }) {
	const radius = 6;
	const circumference = 2 * Math.PI * radius;
	const filled = Math.min(Math.max(percent, 0), 100) / 100;
	return (
		<svg aria-hidden="true" className="shrink-0 -rotate-90" height={16} viewBox="0 0 16 16" width={16}>
			<circle cx={8} cy={8} fill="none" r={radius} stroke="var(--omp-border-strong)" strokeWidth={2} />
			<circle
				className="omp-progress-ring"
				cx={8}
				cy={8}
				fill="none"
				r={radius}
				stroke={percent >= 80 ? "var(--omp-warning)" : "currentColor"}
				strokeDasharray={circumference}
				strokeDashoffset={circumference * (1 - filled)}
				strokeLinecap="round"
				strokeWidth={2}
			/>
		</svg>
	);
}
