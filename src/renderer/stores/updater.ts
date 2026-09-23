/**
 * Updater store: the renderer's mirror of the main-process update status
 * machine (pushed via updater:status, replayed on boot via getStatus), plus the
 * banner dismissal. Dismissal is per-version: snoozing v0.4.1 doesn't hide
 * v0.4.2 when it lands. Both dismissals outlive the process — the version
 * because a release already declined shouldn't come back, and the error because
 * a broken update feed re-reports the same failure on every poll.
 */
import { create } from "zustand";
import type { UpdateStatus } from "../../shared/ipc-types";

const DISMISSAL_KEY = "omp.update.dismissed";

export interface UpdateDismissal {
	version?: string;
	error?: boolean;
}

/** States that prove the updater is working, which re-arms a dismissed failure. */
const RECOVERED: readonly UpdateStatus["state"][] = ["available", "not-available", "downloaded"];

/**
 * Read the persisted banner dismissal. Exported so the store's write side and
 * the restart's read side can be proven to agree on the same key and shape.
 */
export function loadDismissal(): UpdateDismissal {
	try {
		const raw = localStorage.getItem(DISMISSAL_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};
		const { version, error } = parsed as Record<string, unknown>;
		return {
			version: typeof version === "string" ? version : undefined,
			error: error === true ? true : undefined,
		};
	} catch {
		return {};
	}
}

function persistDismissal(dismissal: UpdateDismissal): void {
	try {
		localStorage.setItem(DISMISSAL_KEY, JSON.stringify(dismissal));
	} catch {
		/* storage unavailable — dismissal becomes session-only */
	}
}

interface UpdaterStore {
	status: UpdateStatus;
	dismissed: UpdateDismissal;
	setStatus: (status: UpdateStatus) => void;
	dismiss: (version: string) => void;
	dismissError: () => void;
}

export const useUpdaterStore = create<UpdaterStore>()((set, get) => ({
	status: { state: "idle" },
	dismissed: loadDismissal(),
	setStatus: status => {
		const { error } = get().dismissed;
		if (error && RECOVERED.includes(status.state)) {
			const next = { version: get().dismissed.version };
			persistDismissal(next);
			set({ status, dismissed: next });
			return;
		}
		set({ status });
	},
	dismiss: version => {
		const next = { version, error: get().dismissed.error };
		persistDismissal(next);
		set({ dismissed: next });
	},
	dismissError: () => {
		const next = { version: get().dismissed.version, error: true };
		persistDismissal(next);
		set({ dismissed: next });
	},
}));

/** Wire the main-process push + boot replay once (App mount). Returns unsubscribe. */
export function subscribeUpdaterStatus(): () => void {
	const unsubscribe = window.omp.events.onUpdaterStatus(status => {
		useUpdaterStore.getState().setStatus(status);
	});
	void window.omp.updater.getStatus().then(status => {
		useUpdaterStore.getState().setStatus(status);
	});
	return unsubscribe;
}
