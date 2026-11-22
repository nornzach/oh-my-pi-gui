import { describe, expect, it } from "vitest";
import type { ModelCost } from "../../shared/rpc-types";
import {
	effectiveRateCard,
	formatUtcMinute,
	hasRecurringTariff,
	nextPricingTransition,
	pricingPeriod,
	tariffMultiplier,
} from "./model-pricing";

/**
 * The GUI mirrors the catalog's tariff math because it cannot import it. These
 * pin the conventions a wrong mirror would break: UTC weekdays, half-open
 * windows, edges that do not flip the period, and dated cards beating base legs.
 */

const DAY = 86_400_000;
/** Monday 2024-01-01T00:00:00Z. */
const MON = 1_704_067_200_000;
const WEEKDAYS = [1, 2, 3, 4, 5];
const NIGHT: ModelCost = {
	input: 0.28,
	output: 0.42,
	cacheRead: 0.028,
	cacheWrite: 0,
	timeBased: { offPeakMultiplier: 0.5, peakWindows: [{ weekdays: WEEKDAYS, startMinute: 60, endMinute: 240 }] },
};

describe("pricingPeriod", () => {
	it("reads windows as half-open UTC minutes on the listed weekdays", () => {
		expect(pricingPeriod(NIGHT, MON + 59 * 60_000)).toBe("off-peak");
		expect(pricingPeriod(NIGHT, MON + 60 * 60_000)).toBe("peak");
		expect(pricingPeriod(NIGHT, MON + 239 * 60_000)).toBe("peak");
		expect(pricingPeriod(NIGHT, MON + 240 * 60_000)).toBe("off-peak");
	});

	it("keeps unlisted weekdays off-peak inside the same clock window", () => {
		const sunday = MON - DAY;
		const saturday = MON + 5 * DAY;
		expect(pricingPeriod(NIGHT, sunday + 120 * 60_000)).toBe("off-peak");
		expect(pricingPeriod(NIGHT, saturday + 120 * 60_000)).toBe("off-peak");
	});

	it("reports no period for a plain rate card or a dated-only schedule", () => {
		expect(pricingPeriod({ input: 1, output: 2 }, MON)).toBeUndefined();
		expect(pricingPeriod(undefined, MON)).toBeUndefined();
		const datedSchedule = { offPeakMultiplier: 1, peakWindows: [], effectiveRates: [] };
		expect(pricingPeriod({ input: 1, output: 2, timeBased: datedSchedule }, MON)).toBeUndefined();
		expect(hasRecurringTariff(datedSchedule)).toBe(false);
	});

	it("treats a discount without windows as a recurring off-peak tariff", () => {
		const alwaysOff: ModelCost = { timeBased: { offPeakMultiplier: 0.5, peakWindows: [] } };
		expect(pricingPeriod(alwaysOff, MON)).toBe("off-peak");
		expect(tariffMultiplier(alwaysOff, MON + 120 * 60_000)).toBe(0.5);
	});
});

describe("tariffMultiplier", () => {
	it("discounts only outside the peak windows", () => {
		expect(tariffMultiplier(NIGHT, MON + 120 * 60_000)).toBe(1);
		expect(tariffMultiplier(NIGHT, MON + 300 * 60_000)).toBe(0.5);
		expect(tariffMultiplier({ input: 1 }, MON)).toBe(1);
	});
});

describe("nextPricingTransition", () => {
	it("returns the next flip strictly after now", () => {
		expect(nextPricingTransition(NIGHT, MON)).toBe(MON + 60 * 60_000);
		expect(nextPricingTransition(NIGHT, MON + 120 * 60_000)).toBe(MON + 240 * 60_000);
	});

	it("skips an edge where touching windows keep the period unchanged", () => {
		const touching: ModelCost = {
			timeBased: {
				offPeakMultiplier: 0.5,
				peakWindows: [
					{ weekdays: WEEKDAYS, startMinute: 60, endMinute: 240 },
					{ weekdays: WEEKDAYS, startMinute: 240, endMinute: 360 },
				],
			},
		};
		expect(nextPricingTransition(touching, MON + 120 * 60_000)).toBe(MON + 360 * 60_000);
	});

	it("crosses the week boundary to the next listed weekday", () => {
		const sundayLate = MON - 60 * 60_000;
		expect(nextPricingTransition(NIGHT, sundayLate)).toBe(MON + 60 * 60_000);
	});

	it("has no transition when the period never flips", () => {
		const alwaysOff: ModelCost = { timeBased: { offPeakMultiplier: 0.5, peakWindows: [] } };
		expect(nextPricingTransition(alwaysOff, MON)).toBeUndefined();
		expect(nextPricingTransition(undefined, MON)).toBeUndefined();
	});
});

describe("effectiveRateCard", () => {
	const dated: ModelCost = {
		input: 1,
		output: 2,
		cacheRead: 0.1,
		cacheWrite: 0.2,
		timeBased: {
			offPeakMultiplier: 1,
			peakWindows: [],
			effectiveRates: [
				{ effectiveFrom: MON, input: 3, output: 4, cacheRead: 0.3, cacheWrite: 0.4 },
				{ effectiveFrom: MON + DAY, input: 5, output: 6, cacheRead: 0.5, cacheWrite: 0.6 },
			],
		},
	};

	it("uses the latest due card, not the first or the base legs", () => {
		expect(effectiveRateCard(dated, MON + DAY)).toMatchObject({ input: 5, output: 6 });
		expect(effectiveRateCard(dated, MON + DAY - 1)).toMatchObject({ input: 3, output: 4 });
	});

	it("falls back to the row's own legs before any card is due", () => {
		expect(effectiveRateCard(dated, MON - 1)).toEqual({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 });
		expect(effectiveRateCard(undefined, MON)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});
});

describe("formatUtcMinute", () => {
	it("prints the UTC clock the tariff windows are defined in", () => {
		expect(formatUtcMinute(MON + 60 * 60_000)).toBe("01:00");
		expect(formatUtcMinute(MON + 239 * 60_000)).toBe("03:59");
	});
});
