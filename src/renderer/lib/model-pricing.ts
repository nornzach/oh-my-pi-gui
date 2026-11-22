/**
 * Peak/off-peak reading of the tariff the catalog ships on a model row
 * (`cost.timeBased`, e.g. DeepSeek's half-price nights). The GUI cannot import
 * the catalog, so this mirrors its `isPeakPricingPeriod`,
 * `getNextTimeBasedPricingTransition` and `dueDatedCard`: UTC-only arithmetic,
 * half-open windows, and a window edge counts as a transition only when the
 * period actually flips there.
 */
import type { ModelCost, ModelEffectiveRate, ModelTariff } from "../../shared/rpc-types";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export type PricingPeriod = "peak" | "off-peak";

export interface TokenRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** Unix epoch was a Thursday; this keeps the weekday UTC-only without a Date. */
function utcWeekday(day: number): number {
	return (((day + 4) % 7) + 7) % 7;
}

function isPeak(schedule: ModelTariff, timestamp: number): boolean {
	const day = Math.floor(timestamp / DAY_MS);
	const weekday = utcWeekday(day);
	const minute = Math.floor((timestamp - day * DAY_MS) / MINUTE_MS);
	return schedule.peakWindows.some(
		window => minute >= window.startMinute && minute < window.endMinute && window.weekdays.includes(weekday),
	);
}

/** A schedule with no windows at a 1x multiplier only carries dated rate cards. */
export function hasRecurringTariff(schedule: ModelTariff): boolean {
	return schedule.peakWindows.length > 0 || schedule.offPeakMultiplier !== 1;
}

export function pricingPeriod(cost: ModelCost | undefined, now: number): PricingPeriod | undefined {
	const schedule = cost?.timeBased;
	if (!schedule || !hasRecurringTariff(schedule)) return undefined;
	return isPeak(schedule, now) ? "peak" : "off-peak";
}

export function tariffMultiplier(cost: ModelCost | undefined, now: number): number {
	const schedule = cost?.timeBased;
	if (!schedule) return 1;
	return isPeak(schedule, now) ? 1 : schedule.offPeakMultiplier;
}

/** The next period flip strictly after `now`; one UTC week covers the recurrence. */
export function nextPricingTransition(cost: ModelCost | undefined, now: number): number | undefined {
	const schedule = cost?.timeBased;
	if (!schedule) return undefined;
	const firstDay = Math.floor(now / DAY_MS);
	const horizon = now + 7 * DAY_MS;
	let next = Infinity;
	for (let offset = 0; offset <= 7; offset++) {
		const day = firstDay + offset;
		const weekday = utcWeekday(day);
		for (const window of schedule.peakWindows) {
			if (!window.weekdays.includes(weekday)) continue;
			for (const minute of [window.startMinute, window.endMinute]) {
				const candidate = day * DAY_MS + minute * MINUTE_MS;
				if (candidate <= now || candidate > horizon || candidate >= next) continue;
				// Overlapping or touching windows hide an edge, including at midnight.
				if (isPeak(schedule, candidate - 1) !== isPeak(schedule, candidate)) next = candidate;
			}
		}
	}
	return next === Infinity ? undefined : next;
}

/** The card in force at `now`: the latest due dated card, else the row's own legs. */
export function effectiveRateCard(cost: ModelCost | undefined, now: number): TokenRates {
	let due: ModelEffectiveRate | undefined;
	for (const card of cost?.timeBased?.effectiveRates ?? []) {
		if (card.effectiveFrom <= now && (due === undefined || card.effectiveFrom > due.effectiveFrom)) due = card;
	}
	const rates = due ?? cost;
	return {
		input: rates?.input ?? 0,
		output: rates?.output ?? 0,
		cacheRead: rates?.cacheRead ?? 0,
		cacheWrite: rates?.cacheWrite ?? 0,
	};
}

/** `HH:MM` in UTC, the timezone the tariff windows are defined in. */
export function formatUtcMinute(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(11, 16);
}
