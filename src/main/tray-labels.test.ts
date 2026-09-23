/**
 * Contracts for the tray's pure label layer: the aggregate run status must be
 * readable somewhere (the icon is a static template mark, so the tooltip and the
 * menu header carry it), and the rebuild signature must ignore pushes that
 * change nothing a user can read while still catching every change the menu
 * routes on — including a workspace entry whose path moved under a stable name.
 */
import { describe, expect, it } from "vitest";
import type { TrayState } from "../shared/ipc-types";
import {
	aggregateTrayStatus,
	approvalLabel,
	formatTokens,
	menuSignature,
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
