/**
 * Token Meter (#71): live throughput plus the session's token and cost
 * economics, opened from the title-bar readout. Per-turn figures are exact
 * (committed message usage); the live gauge observes streaming-buffer growth
 * because the wire carries no per-delta token counts.
 */
import { X, Zap } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentMessage, ModelCost, SessionStats } from "../../../shared/rpc-types";
import { formatCost, formatDuration, formatPercent, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { onEscape } from "../../lib/keymap";
import {
	effectiveRateCard,
	formatUtcMinute,
	nextPricingTransition,
	nextPricingUpdate,
	pricingPeriod,
	tariffMultiplier,
} from "../../lib/model-pricing";
import { effectiveCostPerMillion, lastTurnFacts, useLiveThroughput } from "../../lib/token-meter";
import { sessionCacheHitPercent } from "./session-metrics";

// A dated rate card can be farther out than a browser timer can represent.
const MAX_TIMEOUT_MS = 2_147_483_647;

function Sparkline({ history, peak }: { history: number[]; peak: number }) {
	if (history.length < 2) return <div className="h-8" />;
	const ceiling = Math.max(peak, 1);
	const points = history
		.map((rate, index) => `${(index / (history.length - 1)) * 120},${32 - (rate / ceiling) * 30}`)
		.join(" ");
	return (
		<svg aria-hidden className="h-8 w-full" preserveAspectRatio="none" viewBox="0 0 120 32">
			<polyline fill="none" points={points} stroke="var(--omp-accent)" strokeWidth="1.5" />
		</svg>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<div className="text-omp-xs uppercase tracking-wide text-(--omp-dim)">{label}</div>
			<div className="truncate font-mono text-omp-md font-semibold tabular-nums text-(--omp-text)">{value}</div>
		</div>
	);
}

export function TokenMeterPopover({
	stats,
	messages,
	isStreaming,
	anchor,
	anchorRef,
	cost,
	onClose,
}: {
	stats: SessionStats | null;
	messages: readonly AgentMessage[];
	isStreaming: boolean;
	anchor: { x: number; y: number };
	/** The readout button that opened this panel; clicking it again closes it. */
	anchorRef?: RefObject<HTMLElement | null>;
	/** The live model's rate card, for the peak/off-peak tariff row. */
	cost?: ModelCost;
	onClose: () => void;
}) {
	const t = useT();
	const panelRef = useRef<HTMLDivElement | null>(null);
	const live = useLiveThroughput(isStreaming);
	const turn = lastTurnFacts(messages);
	const cacheHit = sessionCacheHitPercent(stats);
	const tokens = stats?.tokens;
	const consumed = stats?.contextUsage?.tokens;
	const totalCost = stats ? (stats.history?.cost ?? stats.cost) : null;
	const totalTokens = stats ? (stats.history?.totalTokens ?? stats.tokens.total) : 0;
	const perMillion = totalCost === null ? null : effectiveCostPerMillion(totalCost, totalTokens);
	const [now, setNow] = useState(Date.now);
	const period = pricingPeriod(cost, now);
	const multiplier = tariffMultiplier(cost, now);
	const nextChange = nextPricingTransition(cost, now);
	const rates = effectiveRateCard(cost, now);
	const hasDatedRates = (cost?.timeBased?.effectiveRates?.length ?? 0) > 0;
	const tariffLabel =
		period === "off-peak"
			? "tokenMeter.tariffOffPeak"
			: period === "peak"
				? "tokenMeter.tariffPeak"
				: "tokenMeter.currentRates";

	useEffect(() => {
		if (!cost?.timeBased) return;
		let timer: number | undefined;
		const refresh = () => {
			window.clearTimeout(timer);
			const timestamp = Date.now();
			setNow(timestamp);
			const next = nextPricingUpdate(cost, timestamp);
			timer =
				next === undefined ? undefined : window.setTimeout(refresh, Math.min(MAX_TIMEOUT_MS, next - timestamp));
		};
		refresh();
		window.addEventListener("focus", refresh);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("focus", refresh);
		};
	}, [cost]);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (panelRef.current?.contains(target) || anchorRef?.current?.contains(target)) return;
			onClose();
		};
		// Claim the keystroke: App.tsx aborts the running turn on an unclaimed
		// Escape, and reading the meter must not kill the stream it measures.
		const onKeyDown = (event: KeyboardEvent) => {
			onEscape(event, onClose);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [anchorRef, onClose]);

	return createPortal(
		<div
			aria-label={t("tokenMeter.title")}
			className="omp-pop-in fixed z-[80] w-[22rem] max-w-[calc(100vw-1rem)] rounded-[18px] border border-(--omp-border) bg-(--omp-bg-elevated) p-4 shadow-(--omp-shadow-lg)"
			ref={panelRef}
			role="dialog"
			style={{ left: anchor.x, top: anchor.y }}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="flex items-center gap-1.5 text-omp-md font-semibold text-(--omp-text)">
					<Zap aria-hidden size={14} className="text-(--omp-accent)" />
					{t("tokenMeter.title")}
				</span>
				<button
					aria-label={t("common.close")}
					className="omp-pressable rounded-md p-1 text-(--omp-dim) hover:bg-(--omp-selected-bg)"
					onClick={onClose}
					type="button"
				>
					<X aria-hidden size={14} />
				</button>
			</div>

			<div className="mt-3 flex items-baseline gap-2">
				<span
					className="font-mono text-omp-2xl font-semibold tabular-nums text-(--omp-accent)"
					data-token-meter-rate
				>
					{live.rate >= 0.05 ? Math.round(live.rate) : 0}
				</span>
				<span className="text-omp-xs text-(--omp-dim)">{t("tokenMeter.charPerSec")}</span>
				{isStreaming && (
					<span className="ml-auto flex items-center gap-1 text-omp-xs text-(--omp-dim)">
						<span aria-hidden className="h-1.5 w-1.5 rounded-full bg-(--omp-accent)" />
						{t("tokenMeter.live")}
					</span>
				)}
			</div>
			<div className="mt-1 text-omp-xs tabular-nums text-(--omp-dim)">
				{turn.tps !== null ? `${t("tokenMeter.lastTurn")} ${Math.round(turn.tps)} t/s` : t("tokenMeter.noTurn")}
			</div>
			<div className="mt-2">
				<Sparkline history={live.history} peak={live.peak} />
				<div className="flex justify-between text-omp-xs tabular-nums text-(--omp-dim)">
					<span>{t("tokenMeter.window")}</span>
					<span>
						{t("tokenMeter.peak")} {Math.round(live.peak)} · {t("tokenMeter.avg")} {Math.round(live.average)}
					</span>
				</div>
			</div>

			<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-(--omp-border-muted) pt-3">
				<Fact label={t("tokenMeter.in")} value={tokens ? formatTokens(tokens.input) : "—"} />
				<Fact label={t("tokenMeter.out")} value={tokens ? formatTokens(tokens.output) : "—"} />
				<Fact label={t("tokenMeter.think")} value={tokens ? formatTokens(tokens.reasoning) : "—"} />
				<Fact label={t("tokenMeter.cache")} value={tokens ? formatTokens(tokens.cacheRead) : "—"} />
				<Fact label={t("tokenMeter.cacheHit")} value={formatPercent(cacheHit, 1)} />
				<Fact label={t("tokenMeter.ttft")} value={turn.ttft !== null ? formatDuration(turn.ttft) : "—"} />
				<Fact label={t("tokenMeter.consumed")} value={consumed !== undefined ? formatTokens(consumed) : "—"} />
				<Fact
					label={t("tokenMeter.effective")}
					value={perMillion !== null ? `${formatCost(perMillion, 2)}/1M` : "—"}
				/>
			</div>

			<div className="mt-3 grid grid-cols-2 gap-x-4 border-t border-(--omp-border-muted) pt-3">
				<Fact label={t("tokenMeter.totalCost")} value={totalCost !== null ? formatCost(totalCost, 4) : "—"} />
				<Fact label={t("tokenMeter.lastTurnCost")} value={turn.cost !== null ? formatCost(turn.cost, 4) : "—"} />
			</div>
			{(period || hasDatedRates) && (
				<div className="mt-3 border-t border-(--omp-border-muted) pt-3" data-tariff>
					<div className="flex items-baseline justify-between gap-2 text-omp-xs">
						<span className="font-semibold text-(--omp-text)">
							{t(tariffLabel)}
							{multiplier !== 1 && <span className="ml-1 font-mono text-(--omp-accent)">×{multiplier}</span>}
						</span>
						{nextChange !== undefined && (
							<span className="tabular-nums text-(--omp-dim)">
								{t("tokenMeter.nextChange", { time: formatUtcMinute(nextChange) })}
							</span>
						)}
					</div>
					<div className="mt-1 font-mono text-omp-xs tabular-nums text-(--omp-dim)">
						{formatCost(rates.input * multiplier, 2)} {t("tokenMeter.rateIn")} ·{" "}
						{formatCost(rates.output * multiplier, 2)} {t("tokenMeter.rateOut")} /1M
					</div>
				</div>
			)}
			<p className="mt-3 text-omp-xs leading-relaxed text-(--omp-dim)">{t("tokenMeter.note")}</p>
		</div>,
		document.body,
	);
}
