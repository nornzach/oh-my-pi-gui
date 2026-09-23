import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "../../shared/ipc-types";

interface SessionListResult {
	sessions: SessionInfo[];
	isLoading: boolean;
	/** Set when the last read failed; an empty list must not claim "nothing here". */
	error: string | null;
	refresh: (showSpinner?: boolean) => void;
	deleteSession: (path: string) => Promise<void>;
	renameSession: (path: string, name: string) => Promise<void>;
}

/**
 * Fetches and subscribes to session list changes.
 *
 * Layering that keeps the sidebar calm (the "twitch/ghosting" fix):
 * - The loading state shows ONLY on the initial load.
 * - SessionIndex watcher events fire per session-file append (constantly
 *   while agents stream), so event-driven refreshes are DEBOUNCED (trailing
 *   350ms) and update silently — NO animation on background churn. Animating
 *   every append was what stacked old/new snapshots into ghost text.
 * - User-initiated deletion removes the row locally before the debounced
 *   background refresh reconciles authoritatively.
 */
export function useSessionList(scope: "local" | "global" = "local"): SessionListResult {
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const firstLoadDone = useRef(false);
	const debounceTimer = useRef<number | undefined>(undefined);

	const refresh = useCallback(
		(showSpinner = false) => {
			if (showSpinner && !firstLoadDone.current) setIsLoading(true);
			setError(null);
			window.omp.sessions
				.list(scope)
				.then(list => {
					firstLoadDone.current = true;
					setIsLoading(false);
					// Silent swap: stable React keys keep rows in place; only content
					// (titles, timestamps, counts) updates — no snapshot animation.
					setSessions(list);
				})
				.catch(cause => {
					// A read that never answered is not a read that found nothing — the
					// sidebar would otherwise claim "no sessions yet" for a failure.
					setError(cause instanceof Error ? cause.message : String(cause));
					setIsLoading(false);
				});
		},
		[scope],
	);

	useEffect(() => {
		refresh(true);
		const unsubscribe = window.omp.events.onSessionsChanged(() => {
			// Coalesce the per-append storm: trailing debounce, one refresh max
			// every 350ms while sessions stream.
			window.clearTimeout(debounceTimer.current);
			debounceTimer.current = window.setTimeout(() => refresh(), 350);
		});
		return () => {
			window.clearTimeout(debounceTimer.current);
			unsubscribe();
		};
	}, [refresh]);

	const deleteSession = useCallback(
		async (path: string) => {
			await window.omp.sessions.delete(path);
			// Remove the row immediately, then let the debounced background refresh
			// reconcile authoritatively.
			setSessions(current => current.filter(session => session.path !== path));
			refresh();
		},
		[refresh],
	);
	const renameSession = useCallback(
		async (path: string, name: string) => {
			await window.omp.sessions.rename(path, name);
			setSessions(current =>
				current.map(session => (session.path === path ? { ...session, title: name } : session)),
			);
			refresh();
		},
		[refresh],
	);

	return { sessions, isLoading, error, refresh, deleteSession, renameSession };
}
