/**
 * Contracts for the stats server's restart budget — the part that decides
 * whether a dead dashboard ever comes back. Without the ceiling the manager
 * respawns a broken binary forever; without the revive path it gives up at port
 * 0 and every later read answers "not ready" for the rest of the session.
 */
import { describe, expect, it } from "vitest";
import { MAX_RESTART_ATTEMPTS, RestartBudget } from "./stats-restart-policy";

const COOLDOWN_MS = 30_000;

describe("RestartBudget", () => {
	it("caps one crash cycle and then stops asking for a respawn", () => {
		const budget = new RestartBudget();
		const delays: (number | null)[] = [];
		for (let i = 0; i < MAX_RESTART_ATTEMPTS + 2; i++) delays.push(budget.nextDelay());
		expect(delays.slice(0, MAX_RESTART_ATTEMPTS)).toEqual([1000, 2000, 4000]);
		expect(delays.slice(MAX_RESTART_ATTEMPTS)).toEqual([null, null]);
	});

	it("treats a successful bind as proof the crash cycle was not systemic", () => {
		const budget = new RestartBudget();
		expect(budget.nextDelay()).toBe(1000);
		expect(budget.nextDelay()).toBe(2000);
		budget.noteReady();
		// A server that ran fine and died later gets the full ladder again.
		expect(budget.nextDelay()).toBe(1000);
	});

	it("revives a given-up server on demand, but not once per read", () => {
		const budget = new RestartBudget();
		for (let i = 0; i < MAX_RESTART_ATTEMPTS; i++) expect(budget.nextDelay()).not.toBeNull();
		expect(budget.revive(1_000)).toBe("scheduled");
		// The dashboard polls every couple of seconds while starting; each poll must
		// not queue another spawn.
		expect(budget.revive(1_000 + COOLDOWN_MS / 2)).toBe("already-pending");
		expect(budget.revive(1_000 + COOLDOWN_MS)).toBe("scheduled");
	});

	it("stops reviving so the failure reaches the user", () => {
		const budget = new RestartBudget();
		const verdicts: string[] = [];
		for (let round = 0; round < 6; round++) verdicts.push(budget.revive(round * COOLDOWN_MS));
		expect(verdicts.filter(v => v === "scheduled")).toHaveLength(3);
		expect(verdicts.slice(3)).toEqual(["exhausted", "exhausted", "exhausted"]);
	});

	it("gives a revived server its own crash cycle", () => {
		const budget = new RestartBudget();
		for (let i = 0; i < MAX_RESTART_ATTEMPTS; i++) budget.nextDelay();
		expect(budget.nextDelay()).toBeNull();
		expect(budget.revive(0)).toBe("scheduled");
		expect(budget.nextDelay()).toBe(1000);
	});

	it("keeps reviving forever out of the picture once it recovers", () => {
		const budget = new RestartBudget();
		expect(budget.revive(0)).toBe("scheduled");
		expect(budget.revive(COOLDOWN_MS)).toBe("scheduled");
		budget.noteReady();
		expect(budget.revive(COOLDOWN_MS * 2)).toBe("scheduled");
	});
});
