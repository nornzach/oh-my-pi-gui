import { describe, expect, it } from "vitest";
import type { UsageLimit, UsageReport } from "../../../shared/rpc-types";
import { nextQuotaReset } from "../../lib/quota-rows";
import { zh } from "../../locales/zh";
import { limitHasDetail, limitValueText } from "./UsageWindow";

function valueText(amount: Omit<UsageLimit, "id" | "label">): string {
	return limitValueText({ id: "quota", label: "Quota", ...amount }, (key, params) =>
		(zh[key] ?? key).replace("{value}", String(params?.value ?? "")),
	);
}

describe("provider quota values", () => {
	it("shows the remaining percentage when Core supplies an unknown quota unit", () => {
		expect(valueText({ unit: "unknown", used: 47, limit: 100, usedFraction: 0.47 })).toBe("剩余 53%");
	});

	it("preserves an explicit zero fraction when a legacy report omits its unit", () => {
		expect(valueText({ used: 5, limit: 100, usedFraction: 0 })).toBe("剩余 100%");
	});

	it("shows available counts for named units", () => {
		expect(valueText({ unit: "requests", used: 12, limit: 100, usedFraction: 0.12 })).toBe("剩余 88 / 100 requests");
	});

	it("uses the provider's remaining share and honors an exhausted status", () => {
		expect(valueText({ usedFraction: 0.2, remainingFraction: 0.35 })).toBe("剩余 35%");
		expect(valueText({ status: "exhausted" })).toBe("剩余 0%");
		expect(valueText({ usedFraction: 1.2 })).toBe("剩余 0%");
	});

	it("handles counts without a unit and missing quota data", () => {
		expect(valueText({ unit: "unknown", used: 5, limit: 100 })).toBe("剩余 95 / 100");
		expect(valueText({ unit: "unknown", used: 5 })).toBe("剩余额度未知");
		expect(valueText({ unit: "unknown" })).toBe("剩余额度未知");
	});
});

function report(resets: Array<number | undefined>): UsageReport {
	return {
		provider: "openai-codex",
		fetchedAt: 0,
		limits: resets.map((resetsAt, index) => ({ id: `limit-${index}`, label: "Window", resetsAt })),
	};
}

// The window re-reads quotas once the next reset passes; before, a passed
// window kept its full bar and "resetting…" until the user pressed Refresh.
describe("next quota reset", () => {
	it("schedules the earliest reset still ahead across every provider", () => {
		expect(nextQuotaReset([report([500, 4_000]), report([undefined, 2_500])], 1_000)).toBe(2_500);
	});

	it("does not schedule a reset that already passed, so a stale report cannot loop", () => {
		expect(nextQuotaReset([report([500, 999])], 1_000)).toBeUndefined();
		expect(nextQuotaReset(null, 1_000)).toBeUndefined();
	});
});

describe("limit value detail", () => {
	it("drops a plain percentage the bar already prints and keeps counts it cannot", () => {
		expect(limitHasDetail({ id: "a", label: "5h", unit: "percent", used: 87, limit: 100, usedFraction: 0.87 })).toBe(
			false,
		);
		expect(limitHasDetail({ id: "b", label: "Weekly", usedFraction: 0.5 })).toBe(false);
		expect(limitHasDetail({ id: "c", label: "Chat", unit: "requests", used: 212, limit: 300 })).toBe(true);
		// No fraction to draw: the text is the only reading.
		expect(limitHasDetail({ id: "d", label: "Burst", unit: "unknown", used: 5 })).toBe(true);
	});
});
