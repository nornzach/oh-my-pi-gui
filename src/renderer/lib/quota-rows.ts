/**
 * Provider quota reports reduced to quota rows for the tray menu and the
 * sidebar strip (#28): one row per provider account, one entry per time
 * window. Limits that share a window (Claude's overall, Opus and Sonnet 7-day
 * caps) become one entry showing whichever is closest to its cap. Limits with
 * no time window (credit balances, extra usage) stay in the Usage window only.
 */

import type { TrayQuota, TrayQuotaLimit, TrayQuotaWindow } from "../../shared/ipc-types";
import { quotaLevel, remainingQuotaFraction } from "../../shared/quotas";
import type { UsageLimit, UsageReport } from "../../shared/rpc-types";

export interface QuotaRow {
	provider: string;
	account?: string;
	windows: TrayQuotaWindow[];
}

/** Wait past a reset before re-reading, so the provider has rolled the window over. */
export const QUOTA_RESET_GRACE_MS = 3_000;

/**
 * The next reset still ahead of `now` across every report. A reset already in
 * the past is skipped: re-reading for it again would loop while a provider
 * keeps reporting the old timestamp.
 */
export function nextQuotaReset(reports: readonly UsageReport[] | null, now: number): number | undefined {
	let next: number | undefined;
	for (const report of reports ?? []) {
		for (const limit of Array.isArray(report.limits) ? report.limits : []) {
			if (limit.resetsAt && limit.resetsAt > now && (next === undefined || limit.resetsAt < next)) {
				next = limit.resetsAt;
			}
		}
	}
	return next;
}

const HOUR = 1;
const DAY = 24 * HOUR;

/** Windows named by period rather than length. */
const NAMED_WINDOWS: Record<string, { short: string; hours: number }> = {
	hourly: { short: "1h", hours: HOUR },
	daily: { short: "1d", hours: DAY },
	weekly: { short: "wk", hours: 7 * DAY },
	monthly: { short: "mo", hours: 30 * DAY },
	yearly: { short: "yr", hours: 365 * DAY },
	annual: { short: "yr", hours: 365 * DAY },
};

const UNIT_HOURS: Record<string, { suffix: string; hours: number }> = {
	m: { suffix: "m", hours: HOUR / 60 },
	h: { suffix: "h", hours: HOUR },
	d: { suffix: "d", hours: DAY },
	w: { suffix: "w", hours: 7 * DAY },
	mo: { suffix: "mo", hours: 30 * DAY },
};

/** An unrecognized window keeps at most this much of its first word. */
const UNKNOWN_WINDOW_CHARS = 10;

const SIZED_WINDOW = /^(\d+)\s*-?\s*(min(?:ute)?s?|h(?:(?:ou)?rs?)?|d(?:ays?)?|w(?:(?:ee)?ks?)?|mo(?:nths?)?)$/i;

/**
 * The short name and length of a provider's window label ("5 Hour", "7 days",
 * "Weekly", "rolling 5h"). An unrecognized label keeps its first word
 * ("Quota window" → "quota", "Plan Period" → "plan") and sorts last.
 */
export function quotaWindow(label: string): { short: string; hours: number } {
	const text = label
		.trim()
		.toLowerCase()
		.replace(/^rolling\s+/, "");
	const named = NAMED_WINDOWS[text];
	if (named) return named;
	const sized = SIZED_WINDOW.exec(text);
	if (sized) {
		const unitText = sized[2];
		const unit = unitText.startsWith("mi")
			? UNIT_HOURS.m
			: unitText.startsWith("mo")
				? UNIT_HOURS.mo
				: UNIT_HOURS[unitText[0]];
		const count = Number(sized[1]);
		return { short: `${count}${unit.suffix}`, hours: count * unit.hours };
	}
	const word = text.split(/\s+/)[0].slice(0, UNKNOWN_WINDOW_CHARS);
	return { short: word || "?", hours: Number.POSITIVE_INFINITY };
}

/** The limit's used fraction, from whichever figures the provider reported. */
export function limitUsedFraction(limit: UsageLimit): number | undefined {
	if (typeof limit.remainingFraction === "number" && Number.isFinite(limit.remainingFraction))
		return 1 - limit.remainingFraction;
	if (typeof limit.usedFraction === "number" && Number.isFinite(limit.usedFraction)) return limit.usedFraction;
	if (
		typeof limit.used === "number" &&
		Number.isFinite(limit.used) &&
		typeof limit.limit === "number" &&
		Number.isFinite(limit.limit) &&
		limit.limit > 0
	)
		return limit.used / limit.limit;
	return undefined;
}

export function limitRemainingFraction(limit: UsageLimit): number | undefined {
	if (limit.status === "exhausted") return 0;
	if (typeof limit.remainingFraction === "number" && Number.isFinite(limit.remainingFraction))
		return clamp(limit.remainingFraction);
	const used = limitUsedFraction(limit);
	return used === undefined || !Number.isFinite(used) ? undefined : remainingQuotaFraction(used);
}

const QUOTA_COLORS = { ok: "var(--omp-success)", warning: "var(--omp-warning)", critical: "var(--omp-error)" };

export function remainingQuotaColor(remaining: number): string {
	return QUOTA_COLORS[quotaLevel({ fraction: 1 - remaining, exhausted: remaining === 0 })];
}

function clamp(fraction: number): number {
	return Math.min(1, Math.max(0, fraction));
}

function reportWindows(report: UsageReport): TrayQuotaWindow[] {
	const byWindow = new Map<string, { hours: number; limits: TrayQuotaLimit[] }>();
	for (const limit of Array.isArray(report.limits) ? report.limits : []) {
		// A limit reported used up without figures (rate-limited, nothing remaining) is full.
		const raw = limitUsedFraction(limit) ?? (limit.status === "exhausted" ? 1 : undefined);
		if (raw === undefined || !limit.windowLabel) continue;
		const window = quotaWindow(limit.windowLabel);
		const entry = byWindow.get(window.short) ?? { hours: window.hours, limits: [] };
		entry.limits.push({
			label: limit.label,
			fraction: clamp(raw),
			exhausted: limit.status === "exhausted" || raw >= 1,
			resetsAt: limit.resetsAt,
		});
		byWindow.set(window.short, entry);
	}
	return [...byWindow.entries()]
		.sort(([a, left], [b, right]) => left.hours - right.hours || a.localeCompare(b))
		.map(([window, { limits }]) => {
			limits.sort((a, b) => Number(b.exhausted) - Number(a.exhausted) || b.fraction - a.fraction);
			return { window, fraction: limits[0].fraction, exhausted: limits[0].exhausted, limits };
		});
}

/** One row per report that has a windowed limit, in report order. */
export function quotaRows(reports: readonly UsageReport[] | null): QuotaRow[] {
	const rows: QuotaRow[] = [];
	for (const report of reports ?? []) {
		const windows = reportWindows(report);
		if (windows.length > 0) rows.push({ provider: report.provider, account: report.account, windows });
	}
	return rows;
}

/** Catalog names carry the plan in parentheses ("Anthropic (Claude Pro/Max)"); a row keeps the provider. */
export function shortProviderName(name: string): string {
	return name.replace(/\s*\([^)]*\)\s*$/, "") || name;
}

/**
 * Quota rows named from the catalog. A provider signed in with several
 * accounts carries the account on each of its rows to tell them apart.
 */
export function providerQuotas(
	reports: readonly UsageReport[] | null,
	catalogName: (id: string) => string,
): TrayQuota[] {
	const rows = quotaRows(reports);
	const accounts = new Map<string, number>();
	for (const row of rows) accounts.set(row.provider, (accounts.get(row.provider) ?? 0) + 1);
	return rows.map(row => {
		const name = shortProviderName(catalogName(row.provider));
		const account = (accounts.get(row.provider) ?? 0) > 1 ? row.account : undefined;
		return { name, ...(account ? { account } : {}), windows: row.windows };
	});
}
