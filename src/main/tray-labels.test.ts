/**
 * Contracts for the tray's pure label layer: the aggregate run status must be
 * readable somewhere (the icon is a static template mark, so the tooltip and the
 * menu header carry it), and the rebuild signature must ignore pushes that
 * change nothing a user can read while still catching every change the menu
 * routes on — including a workspace entry whose path moved under a stable name.
 */
import { describe, expect, it } from "vitest";
import type { TrayQuota, TrayState } from "../shared/ipc-types";
import {
	aggregateTrayStatus,
	approvalLabel,
	formatTokens,
	menuSignature,
	moreQuotasLabel,
	quotaLimitLabel,
	quotaRowLabel,
	statusLabel,
	trayTooltip,
} from "./tray-labels";

function state(overrides: Partial<TrayState> = {}): TrayState {
	return {
		status: "idle",
		language: "en",
		cwd: "/w/alpha",
		projectName: "alpha",
		modelId: "gpt-x",
		thinkingLevel: "medium",
		fastMode: false,
		approvalMode: "write",
		contextPercent: 42.3,
		contextTokens: 12345,
		workspaces: [{ cwd: "/w/alpha", name: "alpha", current: true }],
		quotas: [],
		quotasAt: 0,
		...overrides,
	};
}

describe("tray status surface", () => {
	it("names the run state in the hover text, in the language the renderer reports", () => {
		expect(trayTooltip(state({ status: "streaming" }))).toBe("omp — alpha · Running");
		expect(trayTooltip(state({ status: "waiting", language: "zh" }))).toBe("omp — alpha · 等待确认");
		expect(trayTooltip(state({ status: "error" }))).toContain("Error");
		expect(trayTooltip(state({ status: "idle" }))).toContain("Idle");
	});

	it("labels the project before any renderer state arrives", () => {
		expect(trayTooltip(null)).toBe("omp");
	});
});

describe("tray label mapping", () => {
	it("maps each approval mode to one label shared by the header and the radios", () => {
		expect(approvalLabel("en", "yolo")).toBe("Full access");
		expect(approvalLabel("en", "write")).toBe("Auto-edit");
		expect(approvalLabel("en", "always-ask")).toBe("Ask every time");
		expect(approvalLabel("zh", "always-ask")).toBe("每次询问");
	});

	it("renders token counts at the precision the menu prints", () => {
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(12_345)).toBe("12.3k");
		expect(formatTokens(2_400_000)).toBe("2.4M");
	});
});

describe("menuSignature", () => {
	it("holds the menu still for pushes that change no visible label", () => {
		// Streaming refreshes the session list and nudges context usage sub-bucket;
		// the menu prints whole percent and 0.1k tokens, so nothing changed.
		expect(menuSignature(state({ contextPercent: 42.4, contextTokens: 12_348 }))).toBe(menuSignature(state()));
	});

	it("rebuilds when a label the user can read changes", () => {
		const base = menuSignature(state());
		expect(menuSignature(state({ status: "error" }))).not.toBe(base);
		expect(menuSignature(state({ modelId: "gpt-y" }))).not.toBe(base);
		expect(menuSignature(state({ thinkingLevel: "high" }))).not.toBe(base);
		expect(menuSignature(state({ fastMode: true }))).not.toBe(base);
		expect(menuSignature(state({ approvalMode: "yolo" }))).not.toBe(base);
		expect(menuSignature(state({ language: "zh" }))).not.toBe(base);
		expect(menuSignature(state({ projectName: "beta" }))).not.toBe(base);
		// Crossing the printed bucket (42% → 43%) is a visible change.
		expect(menuSignature(state({ contextPercent: 42.6 }))).not.toBe(base);
	});

	it("rebuilds when a workspace entry changes, even under a stable name", () => {
		// The row's label is just the basename, but clicking it sends the cwd; a
		// signature blind to the path would leave a stale jump target in the menu.
		expect(menuSignature(state({ workspaces: [{ cwd: "/w/other", name: "alpha", current: false }] }))).not.toBe(
			menuSignature(state()),
		);
	});

	it("keeps unknown context capacity distinct from zero", () => {
		expect(menuSignature(state({ contextPercent: null, contextTokens: null }))).not.toBe(
			menuSignature(state({ contextPercent: 0, contextTokens: 0 })),
		);
	});
});

describe("tray quota rows", () => {
	const claude = (fiveHour: number): TrayQuota => ({
		name: "Anthropic",
		windows: [
			{
				window: "5h",
				fraction: fiveHour,
				exhausted: false,
				limits: [{ label: "Claude 5 Hour", fraction: fiveHour, exhausted: false }],
			},
			{
				window: "7d",
				fraction: 0.6,
				exhausted: false,
				limits: [{ label: "Claude 7 Day", fraction: 0.6, exhausted: false }],
			},
		],
	});

	it("prints each window's share on the row, and counts the rows past the top under More quotas", () => {
		expect(quotaRowLabel(claude(0.42))).toBe("Anthropic — 5h 58% left, 7d 40% left");
		// A long account is cut in the middle so one address does not widen the menu.
		expect(quotaRowLabel({ ...claude(0.42), account: "zach.personal.account@verylongdomain.example.com" })).toBe(
			"Anthropic · zach.person…example.com — 5h 58% left, 7d 40% left",
		);
		expect(moreQuotasLabel("en", 3)).toBe("More quotas (3)");
	});

	it("gives each limit its share and its reset as a clock time, so a menu opened later still reads right", () => {
		const now = new Date(2026, 9, 27, 10, 0).getTime(); // a Tuesday
		const at = (month: number, day: number, hour: number, minute = 0) =>
			new Date(2026, month, day, hour, minute).getTime();
		const limit = { label: "Claude 5 Hour", fraction: 0.42, exhausted: false };
		expect(quotaLimitLabel("en", { ...limit, resetsAt: at(9, 27, 14, 30) }, now)).toBe(
			"Claude 5 Hour — 58% left · resets 14:30",
		);
		expect(quotaLimitLabel("en", { ...limit, resetsAt: at(9, 30, 9) }, now)).toBe(
			"Claude 5 Hour — 58% left · resets Fri 09:00",
		);
		expect(quotaLimitLabel("en", { ...limit, resetsAt: at(10, 12, 9) }, now)).toBe(
			"Claude 5 Hour — 58% left · resets Nov 12 09:00",
		);
		expect(quotaLimitLabel("en", { label: "Monthly", fraction: 1, exhausted: true, resetsAt: now - 1 }, now)).toBe(
			"Monthly — 0% left · limit reached",
		);
		expect(quotaLimitLabel("zh", { ...limit, resetsAt: at(9, 27, 14, 30) }, now)).toBe(
			"Claude 5 Hour — 剩余 58% · 14:30 重置",
		);
	});

	it("rebuilds the menu when a printed quota figure or the reading time changes, not for sub-percent drift", () => {
		const base = menuSignature(state({ quotas: [claude(0.42)], quotasAt: 600_000 }));
		expect(menuSignature(state({ quotas: [claude(0.421)], quotasAt: 600_000 }))).toBe(base);
		expect(menuSignature(state({ quotas: [claude(0.43)], quotasAt: 600_000 }))).not.toBe(base);
		expect(menuSignature(state({ quotas: [claude(0.42)], quotasAt: 900_000 }))).not.toBe(base);
		expect(menuSignature(state())).not.toBe(base);
	});
});

describe("statusLabel", () => {
	it("gives every status its own text", () => {
		expect(new Set((["idle", "streaming", "waiting", "error"] as const).map(s => statusLabel("en", s))).size).toBe(4);
	});
});

describe("aggregateTrayStatus", () => {
	it("lets the loudest window win regardless of push order", () => {
		const windows = (statuses: TrayState["status"][]) => statuses.map(s => state({ status: s }));
		// A streaming window pushed before an erroring one must not mask the error.
		expect(aggregateTrayStatus(windows(["streaming", "error"]))).toBe("error");
		expect(aggregateTrayStatus(windows(["idle", "error"]))).toBe("error");
		expect(aggregateTrayStatus(windows(["waiting", "streaming"]))).toBe("streaming");
		expect(aggregateTrayStatus(windows(["idle", "waiting"]))).toBe("waiting");
	});

	it("is idle with nothing to aggregate", () => {
		expect(aggregateTrayStatus([])).toBe("idle");
		expect(aggregateTrayStatus([state()])).toBe("idle");
	});
});
