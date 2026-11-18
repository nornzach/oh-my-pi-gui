import { useCallback, useEffect, useRef, useState } from "react";
import type { IpcFsListResult } from "../../../shared/ipc-types";
import { describeError } from "../../lib/errors";

export function useWorkspaceExplorer(cwd: string, tabId: string | null, expanded: ReadonlySet<string>) {
	const [query, setQuery] = useState("");
	const [showIgnored, setShowIgnored] = useState(false);
	const [directories, setDirectories] = useState<ReadonlyMap<string, IpcFsListResult>>(() => new Map());
	const [search, setSearch] = useState<IpcFsListResult | null>(null);
	const rootDirectory = directories.get("");
	const active = useRef(new Set<string>());
	const version = useRef(0);
	const term = query.trim();
	const refresh = useCallback(() => {
		version.current++;
		active.current.clear();
		setDirectories(new Map());
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: changing the workspace or ignore mode invalidates every directory.
	useEffect(() => {
		refresh();
		return () => {
			version.current++;
			active.current.clear();
		};
	}, [cwd, tabId, showIgnored, refresh]);

	useEffect(() => {
		const requestVersion = version.current;
		const list = async (path: string) => {
			if (directories.has(path) || active.current.has(path)) return;
			active.current.add(path);
			let result: IpcFsListResult;
			try {
				result = await window.omp.fs.explore({ path, tabId: tabId ?? undefined, showIgnored });
			} catch (error) {
				result = { ok: false, entries: [], truncated: false, error: describeError(error) };
			}
			if (requestVersion !== version.current) return;
			active.current.delete(path);
			setDirectories(current => new Map(current).set(path, result));
		};
		void list("");
		for (const id of expanded) void list(id.slice(4));
	}, [directories, expanded, showIgnored, tabId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload on refresh and when a tab changes working directories.
	useEffect(() => {
		setSearch(null);
		if (!term) return;
		let cancelled = false;
		let started = false;
		const request = { showIgnored, tabId: tabId ?? undefined };
		const timer = window.setTimeout(() => {
			started = true;
			void window.omp.fs
				.explore({ ...request, query: term })
				.then(result => {
					if (!cancelled) setSearch(result);
				})
				.catch(error => {
					if (!cancelled) setSearch({ ok: false, entries: [], truncated: false, error: describeError(error) });
				});
		}, 160);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
			if (started) void window.omp.fs.explore({ ...request, query: "" }).catch(() => {});
		};
	}, [term, cwd, tabId, showIgnored, rootDirectory]);

	return { term, query, setQuery, showIgnored, setShowIgnored, directories, search, refresh };
}
