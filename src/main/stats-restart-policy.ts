/**
 * Restart budget for the bundled stats server. Kept out of `stats-server.ts`
 * (which spawns) so the ladder itself is testable: a crash cycle gets a bounded
 * backoff ladder, and a server that already gave up can be revived on demand by
 * the next dashboard read — for a capped number of rounds, after which the
 * failure is reported instead of retried forever.
 */

export const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAYS_MS = [1000, 2000, 4000];
/** Minimum gap between two demand-driven revive rounds. */
const REVIVE_COOLDOWN_MS = 30_000;
/** Revive rounds allowed since the last successful bind. */
const MAX_REVIVE_ROUNDS = 3;

export type Revive = "scheduled" | "already-pending" | "exhausted";

export class RestartBudget {
	#attempt = 0;
	#reviveRounds = 0;
	#lastReviveAt = Number.NEGATIVE_INFINITY;

	/**
	 * Delay before the next restart of this crash cycle, or null once the cycle
	 * is spent. Consumes a slot: calling it again advances the ladder.
	 */
	nextDelay(): number | null {
		if (this.#attempt >= MAX_RESTART_ATTEMPTS) return null;
		const delay = RESTART_DELAYS_MS[this.#attempt] ?? 4000;
		this.#attempt++;
		return delay;
	}

	/**
	 * A read asked for the server after it had given up. Cooldown bounds how
	 * often a broken binary is re-spawned; the round cap is what eventually lets
	 * the caller surface a dead-end instead of retrying for the session's life.
	 */
	revive(now: number): Revive {
		if (this.#reviveRounds >= MAX_REVIVE_ROUNDS) return "exhausted";
		if (now - this.#lastReviveAt < REVIVE_COOLDOWN_MS) return "already-pending";
		this.#reviveRounds++;
		this.#lastReviveAt = now;
		this.#attempt = 0;
		return "scheduled";
	}

	/** The server bound its port: both budgets start over. */
	noteReady(): void {
		this.#attempt = 0;
		this.#reviveRounds = 0;
		this.#lastReviveAt = Number.NEGATIVE_INFINITY;
	}
}
