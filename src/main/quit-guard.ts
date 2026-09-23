/**
 * The "sessions are still working" inventory behind the ⌘Q confirmation.
 *
 * Deliberately electron-free: the main process can only be unit-tested through
 * pure modules like this one, so the risk assessment (what counts as in-flight
 * work, which windows to name in the message) lives here while `app-quit.ts`
 * keeps just the dialog and the event latch.
 */

export interface WindowTabFact {
	windowId: number;
	tabId: string;
	/** A run or an automatic compaction is in flight on this tab. */
	inFlight: boolean;
}

export interface QuitRisk {
	workingTabs: number;
	totalTabs: number;
	/** Windows holding at least one working tab — the dialog names the count. */
	workingWindows: number;
}

export function assessQuitRisk(facts: readonly WindowTabFact[]): QuitRisk {
	const workingWindows = new Set<number>();
	let workingTabs = 0;
	for (const fact of facts) {
		if (!fact.inFlight) continue;
		workingTabs++;
		workingWindows.add(fact.windowId);
	}
	return { workingTabs, totalTabs: facts.length, workingWindows: workingWindows.size };
}

/** Idle tabs die quietly; live agent runs always ask first. */
export function quitNeedsConfirmation(risk: QuitRisk): boolean {
	return risk.workingTabs > 0;
}
