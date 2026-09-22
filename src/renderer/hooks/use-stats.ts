import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 30_000;
/** While the bundled stats server is still booting, retry quickly instead of waiting a full poll tick. */
const STARTING_RETRY_MS = 2_000;
/** Give up fast-retrying and show the dead-end error only after this long of continuous unavailability. */
const STARTING_BUDGET_MS = 90_000;

interface StatsState<T> {
	key: string;
	data: T | null;
	isLoading: boolean;
	error: string | null;
	updatedAt: number | null;
}

function unavailableError(result: unknown): string | null {
	if (
		result &&
		typeof result === "object" &&
		"unavailable" in result &&
		(result as { unavailable?: unknown }).unavailable === true
	) {
		const message = (result as { error?: unknown }).error;
		return typeof message === "string" ? message : "unavailable";
	}
	return null;
}

/** One visible query at a time; stale responses never cross a path/range boundary. */
function useStatsResource<T>(path: string, params: Record<string, string> | undefined, expectList: boolean) {
	const serializedParams = JSON.stringify(Object.entries(params ?? {}).sort(([a], [b]) => a.localeCompare(b)));
	const key = `${path}:${serializedParams}`;
	const [state, setState] = useState<StatsState<T>>({
		key,
		data: null,
		isLoading: true,
		error: null,
		updatedAt: null,
	});
	const fetchRef = useRef<() => void>(() => {});
	const refetch = useCallback(() => fetchRef.current(), []);

	useEffect(() => {
		let active = true;
		let inFlight = false;
		let retryTimer: number | undefined;
		let unavailableSince: number | null = null;
		const queryParams = Object.fromEntries(JSON.parse(serializedParams) as [string, string][]);
		const load = async () => {
			if (!active || inFlight) return;
			inFlight = true;
			setState(previous =>
				previous.key === key
					? { ...previous, isLoading: previous.data === null }
					: { key, data: null, isLoading: true, error: null, updatedAt: null },
			);
			try {
				const result = await window.omp.stats.fetch(path, queryParams);
				const starting = unavailableError(result);
				if (starting !== null) {
					// Server still booting: stay in the loading state and retry quickly so
					// the dashboard recovers on its own as soon as it is ready.
					const now = Date.now();
					if (unavailableSince === null) unavailableSince = now;
					if (now - unavailableSince > STARTING_BUDGET_MS) {
						if (active) setState(previous => ({ ...previous, isLoading: false, error: starting }));
					} else if (active) {
						setState(previous => ({ ...previous, isLoading: true, error: null }));
						retryTimer = window.setTimeout(() => {
							if (active) void load();
						}, STARTING_RETRY_MS);
					}
					return;
				}
				if (result && typeof result === "object" && "error" in result && typeof result.error === "string")
					throw new Error(result.error);
				if (expectList && !Array.isArray(result))
					throw new Error(`${path} did not return a list (${result === null ? "null" : typeof result})`);
				unavailableSince = null;
				if (active) setState({ key, data: result as T, isLoading: false, error: null, updatedAt: Date.now() });
			} catch (cause) {
				if (active) setState(previous => ({ ...previous, isLoading: false, error: String(cause) }));
			} finally {
				inFlight = false;
			}
		};
		fetchRef.current = () => void load();
		const refreshVisible = () => {
			if (document.visibilityState !== "hidden") void load();
		};
		void load();
		const timer = window.setInterval(refreshVisible, POLL_INTERVAL_MS);
		document.addEventListener("visibilitychange", refreshVisible);
		return () => {
			active = false;
			if (retryTimer !== undefined) window.clearTimeout(retryTimer);
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", refreshVisible);
		};
	}, [expectList, key, path, serializedParams]);

	return state.key === key
		? { ...state, refetch }
		: { key, data: null, isLoading: true, error: null, updatedAt: null, refetch };
}

export function useStats<T>(path: string, params?: Record<string, string>) {
	return useStatsResource<T>(path, params, false);
}

/** Endpoints whose contract is a bare JSON array; a wrong-shaped reply is an error state, not rows. */
export function useStatsList<T>(path: string, params?: Record<string, string>) {
	return useStatsResource<T[]>(path, params, true);
}
