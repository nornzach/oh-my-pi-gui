/**
 * What the ⌘Q confirmation is built from: the guard must count live runs, the
 * tabs they sit on, and the distinct windows to name in the message, and it
 * must stay silent when nothing is in flight (otherwise ⌘Q becomes a two-step
 * quit for every idle window).
 */

import { describe, expect, it } from "vitest";
import { assessQuitRisk, quitNeedsConfirmation, type WindowTabFact } from "./quit-guard";

function fact(windowId: number, tabId: string, inFlight: boolean): WindowTabFact {
	return { windowId, tabId, inFlight };
}

describe("quit guard risk assessment", () => {
	it("counts only the in-flight tabs and the windows that hold them", () => {
		expect(
			assessQuitRisk([fact(1, "a", true), fact(1, "b", false), fact(2, "c", true), fact(3, "d", false)]),
		).toEqual({ workingTabs: 2, totalTabs: 4, workingWindows: 2 });
	});

	it("names one window once even when several of its tabs are working", () => {
		expect(assessQuitRisk([fact(7, "a", true), fact(7, "b", true), fact(7, "c", true)]).workingWindows).toBe(1);
	});

	it("asks only while work is in flight", () => {
		expect(quitNeedsConfirmation(assessQuitRisk([]))).toBe(false);
		expect(quitNeedsConfirmation(assessQuitRisk([fact(1, "a", false)]))).toBe(false);
		expect(quitNeedsConfirmation(assessQuitRisk([fact(1, "a", true)]))).toBe(true);
	});
});
