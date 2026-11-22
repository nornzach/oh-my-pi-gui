/**
 * Token Meter (#71): live throughput sampling and the session economics the
 * panel prints. The wire carries no per-delta token counts, so the live gauge
 * observes streaming-buffer character growth (the same approximation the
 * thinking gauge uses); per-turn figures come from committed message usage.
 */
import { useEffect, useRef, useState } from "react";
import type { AgentMessage } from "../../shared/rpc-types";
import { readUsage, usageTokPerSec } from "../components/chat/UsageRow";
import { useMessagesStore } from "../stores/messages";
import { SpeedTracker } from "./thinking";

export const TOKEN_METER_WINDOW_MS = 60_000;
export const TOKEN_METER_TICK_MS = 500;

export interface ThroughputSample {
	/** Windowed live rate, characters per second. */
	rate: number;
	/** One rate per tick over the rolling window, oldest first. */
	history: number[];
	peak: number;
	average: number;
}

/** Window-pruned sparkline series with its peak and mean; empty input yields zeros. */
export function summarizeHistory(
	samples: readonly { time: number; rate: number }[],
	now: number,
	windowMs: number = TOKEN_METER_WINDOW_MS,
): { history: number[]; peak: number; average: number } {
	const kept = samples.filter(sample => sample.time >= now - windowMs);
	const history = kept.map(sample => sample.rate);
	if (history.length === 0) return { history, peak: 0, average: 0 };
	let peak = 0;
	let sum = 0;
	for (const rate of history) {
		if (rate > peak) peak = rate;
		sum += rate;
	}
	return { history, peak, average: sum / history.length };
}

/** Dollars per million tokens; null when no tokens were counted. */
export function effectiveCostPerMillion(cost: number, tokens: number): number | null {
	if (!Number.isFinite(cost) || !Number.isFinite(tokens) || tokens <= 0) return null;
	return (cost / tokens) * 1_000_000;
}

export interface TurnFacts {
	tps: number | null;
	cost: number | null;
	ttft: number | null;
}

/** The newest committed assistant turn's exact throughput, cost and time-to-first-token. */
export function lastTurnFacts(messages: readonly AgentMessage[]): TurnFacts {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		const usage = readUsage(message);
		if (!usage) continue;
		const duration = typeof message.duration === "number" ? message.duration : 0;
		return {
			tps: usageTokPerSec(usage.output, duration),
			cost: usage.costTotal ?? null,
			ttft: typeof message.ttft === "number" ? message.ttft : null,
		};
	}
	return { tps: null, cost: null, ttft: null };
}

/** Live char/s gauge over the streaming buffers, with a rolling 60 s series. */
export function useLiveThroughput(active: boolean): ThroughputSample {
	const text = useMessagesStore(state => state.streamingText);
	const thinking = useMessagesStore(state => state.streamingThinking);
	const trackerRef = useRef<SpeedTracker | null>(null);
	if (trackerRef.current === null) trackerRef.current = new SpeedTracker();
	const lastRef = useRef<{ len: number; time: number } | null>(null);
	const samplesRef = useRef<{ time: number; rate: number }[]>([]);
	const [, setTick] = useState(0);

	useEffect(() => {
		if (!active) {
			lastRef.current = null;
			return;
		}
		const length = text.length + thinking.length;
		const now = performance.now();
		const last = lastRef.current;
		if (last !== null && length < last.len) trackerRef.current?.reset();
		if (last !== null && length > last.len && now > last.time) {
			trackerRef.current?.observe(((length - last.len) / (now - last.time)) * 1000, now);
		}
		lastRef.current = { len: length, time: now };
	}, [text, thinking, active]);

	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => {
			const now = performance.now();
			samplesRef.current.push({ time: now, rate: trackerRef.current?.getSpeed(now) ?? 0 });
			// A panel left open through a long run must not accumulate every tick.
			const cutoff = now - TOKEN_METER_WINDOW_MS;
			while (samplesRef.current.length > 0 && samplesRef.current[0]!.time < cutoff) samplesRef.current.shift();
			setTick(value => value + 1);
		}, TOKEN_METER_TICK_MS);
		return () => clearInterval(timer);
	}, [active]);

	const { history, peak, average } = summarizeHistory(samplesRef.current, performance.now());
	return { rate: active ? (trackerRef.current?.getSpeed() ?? 0) : 0, history, peak, average };
}
