/**
 * How provider quota rows rank, shared by the tray menu and the sidebar strip
 * (#28): a row is as urgent as its fullest window, and when more rows exist
 * than fit, the ones nearest their limit stay in view.
 */

import type { TrayQuota, TrayQuotaWindow } from "./ipc-types";

/** The window a row's ring shows: a used-up one first, else the fullest. */
export function fullestWindow(quota: TrayQuota): TrayQuotaWindow | undefined {
	let fullest: TrayQuotaWindow | undefined;
	for (const window of quota.windows) {
		if (
			!fullest ||
			Number(window.exhausted) > Number(fullest.exhausted) ||
			(window.exhausted === fullest.exhausted && window.fraction > fullest.fraction)
		)
			fullest = window;
	}
	return fullest;
}

/** A quota share as a percent: whole, except near full or empty. */
export function quotaPercentText(fraction: number): string {
	const pct = fraction * 100;
	return (pct > 99 && pct < 100) || (pct > 0 && pct < 1) ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

/** Reports and ranking use consumed share; quota displays use the available share. */
export function remainingQuotaFraction(used: number, exhausted = false): number {
	return exhausted ? 0 : Math.min(1, Math.max(0, 1 - used));
}

/** A ring's color band, on the Usage window's bar thresholds. */
export function quotaLevel(window: Pick<TrayQuotaWindow, "fraction" | "exhausted">): "ok" | "warning" | "critical" {
	if (window.exhausted || window.fraction >= 0.9) return "critical";
	if (window.fraction >= 0.75) return "warning";
	return "ok";
}

/** How close a row is to its limit: a used-up window above any share. */
function quotaUrgency(quota: TrayQuota): number {
	const window = fullestWindow(quota);
	if (!window) return -1;
	return window.exhausted ? 2 : window.fraction;
}

/**
 * The rows to show and the rest: with more than `shown` rows, the ones nearest
 * their limit are shown. Both parts keep provider order, so a row does not jump
 * around between readings.
 */
export function splitQuotaRows(quotas: readonly TrayQuota[], shown: number): { top: TrayQuota[]; more: TrayQuota[] } {
	if (quotas.length <= shown) return { top: [...quotas], more: [] };
	const nearest = new Set(
		quotas
			.map((quota, index) => ({ index, urgency: quotaUrgency(quota) }))
			.sort((a, b) => b.urgency - a.urgency || a.index - b.index)
			.slice(0, shown)
			.map(entry => entry.index),
	);
	return {
		top: quotas.filter((_, index) => nearest.has(index)),
		more: quotas.filter((_, index) => !nearest.has(index)),
	};
}
