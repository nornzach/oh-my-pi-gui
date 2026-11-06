/**
 * One project's memory as the Memory window shows it: the overview from the
 * agent, live progress while an update runs, and the edits a person makes.
 * Every edit answers with a fresh overview, so the window never shows a
 * half-applied state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	RpcMemoryActivity,
	RpcMemoryEdit,
	RpcMemoryEditOutcome,
	RpcMemoryEditResult,
	RpcMemoryOverview,
	RpcMemoryUpdateResult,
	RpcResponse,
} from "../../../shared/rpc-types";
import { useActiveTabRouteReady } from "../../hooks/use-active-tab-route";
import { describeError } from "../../lib/errors";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";

/** How often a running update is checked; reading a session takes seconds. */
const ACTIVITY_POLL_MS = 1000;
/** Files land in bursts while a consolidation writes; one reload covers a burst. */
const CHANGE_SETTLE_MS = 300;

export interface MemoryProject {
	overview: RpcMemoryOverview | null;
	/** The first read of this project is in flight. */
	loading: boolean;
	error: string | null;
	/** The sidecar can take requests. */
	connected: boolean;
	reload: () => Promise<void>;
	/** Apply an edit; resolves to its outcome, or null when the request failed (already reported). */
	edit: (edit: RpcMemoryEdit) => Promise<RpcMemoryEditOutcome | null>;
	/** Read waiting sessions and rebuild knowledge now. */
	update: () => Promise<boolean>;
	/** Switch omp's memory between the local pipeline and off, for every project. */
	setEnabled: (enabled: boolean) => Promise<boolean>;
}

function failure(response: RpcResponse): string | null {
	return response.success ? null : describeError(response.error);
}

export function useMemoryProject(open: boolean, cwd: string | null): MemoryProject {
	const t = useT();
	const rpc = useTabRpc();
	const sidecarReady = useSessionStore(state => state.status === "ready");
	const routeReady = useActiveTabRouteReady();
	const connected = sidecarReady && routeReady;
	const [overview, setOverview] = useState<RpcMemoryOverview | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const request = useRef(0);
	const cwdRef = useRef(cwd);
	cwdRef.current = cwd;

	/** Accept an overview only for the project still on screen. */
	const accept = useCallback((next: RpcMemoryOverview | undefined, forCwd: string) => {
		if (!next || cwdRef.current !== forCwd) return;
		setOverview(next);
		setError(null);
	}, []);

	const reload = useCallback(async () => {
		if (!cwd || !connected) return;
		const id = ++request.current;
		try {
			const response = await rpc.getMemoryOverview(cwd);
			if (id !== request.current) return;
			const problem = failure(response);
			if (problem) setError(problem);
			else accept(response.data as RpcMemoryOverview, cwd);
		} catch (cause) {
			if (id === request.current) setError(describeError(cause));
		} finally {
			if (id === request.current) setLoading(false);
		}
	}, [accept, connected, cwd, rpc]);

	// A new project starts from a blank page rather than the previous one's data.
	useEffect(() => {
		request.current += 1;
		setOverview(null);
		setError(null);
		if (!open || !cwd) return;
		setLoading(true);
		void reload();
	}, [open, cwd, reload]);

	// While an update runs, follow its progress; when it ends, show what it learned.
	const running = overview?.activity !== undefined;
	useEffect(() => {
		if (!open || !cwd || !connected || !running) return;
		let stopped = false;
		const timer = window.setInterval(async () => {
			try {
				const response = await rpc.getMemoryActivity(cwd);
				if (stopped || !response.success || cwdRef.current !== cwd) return;
				const activity = (response.data as { activity?: RpcMemoryActivity } | undefined)?.activity;
				if (activity) setOverview(current => (current ? { ...current, activity } : current));
				else void reload();
			} catch {
				// A missed tick is retried on the next one.
			}
		}, ACTIVITY_POLL_MS);
		return () => {
			stopped = true;
			window.clearInterval(timer);
		};
	}, [connected, cwd, open, reload, rpc, running]);

	// Another session or process may consolidate this project while the window is open.
	useEffect(() => {
		if (!open || !connected) return;
		let timer: number | undefined;
		const unsubscribe = window.omp.events.onMemoryChanged(change => {
			if (change.memoryRoots.length === 0) return;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => void reload(), CHANGE_SETTLE_MS);
		});
		return () => {
			window.clearTimeout(timer);
			unsubscribe();
		};
	}, [connected, open, reload]);

	const reportFailure = useCallback(
		(message: string) => toast({ variant: "error", title: t("memory.error.title"), message }),
		[t],
	);

	const edit = useCallback(
		async (change: RpcMemoryEdit): Promise<RpcMemoryEditOutcome | null> => {
			if (!cwd) return null;
			try {
				const response = await rpc.editMemory(change, cwd);
				const problem = failure(response);
				if (problem) {
					reportFailure(problem);
					return null;
				}
				const data = response.data as RpcMemoryEditResult;
				accept(data.overview, cwd);
				return data.result;
			} catch (cause) {
				reportFailure(describeError(cause));
				return null;
			}
		},
		[accept, cwd, reportFailure, rpc],
	);

	const update = useCallback(async (): Promise<boolean> => {
		if (!cwd) return false;
		try {
			const response = await rpc.updateMemory(cwd);
			const problem = failure(response);
			if (problem) {
				reportFailure(problem);
				return false;
			}
			accept((response.data as RpcMemoryUpdateResult).overview, cwd);
			return true;
		} catch (cause) {
			reportFailure(describeError(cause));
			return false;
		}
	}, [accept, cwd, reportFailure, rpc]);

	const setEnabled = useCallback(
		async (enabled: boolean): Promise<boolean> => {
			try {
				const response = await rpc.setSetting("memory.backend", enabled ? "local" : "off");
				const problem = failure(response);
				if (problem) {
					reportFailure(problem);
					return false;
				}
				const effective = (response.data as { value?: unknown } | undefined)?.value;
				if (enabled && effective !== "local") {
					// A project or `--config` layer pins memory off; the global switch cannot win.
					toast({ variant: "warning", title: t("memory.error.title"), message: t("memory.error.pinnedOff") });
					await reload();
					return false;
				}
				if (enabled) return update();
				await reload();
				return true;
			} catch (cause) {
				reportFailure(describeError(cause));
				return false;
			}
		},
		[reload, reportFailure, rpc, t, update],
	);

	return { overview, loading, error, connected, reload, edit, update, setEnabled };
}
