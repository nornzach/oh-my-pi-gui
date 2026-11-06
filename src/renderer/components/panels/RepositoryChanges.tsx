import { ChevronsDownUp, ChevronsUpDown, CircleCheck, FolderX, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RpcGitChanges, RpcGitDiff } from "../../../shared/rpc-types";
import { describeError } from "../../lib/errors";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { TabRpc } from "../../lib/tab-rpc";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { showPathMenu } from "../common/LinkMenu";
import {
	ChangeBadge,
	countDiffLines,
	DiffBody,
	DiffFileCard,
	DiffStat,
	FileLabel,
	gitChangeKind,
	PanelEmpty,
	PanelSearch,
	ToolbarIconButton,
} from "./workspace-ui";

/** Lists at most this long get their +/- counts fetched up front. */
const PREFETCH_LIMIT = 40;
const PREFETCH_CONCURRENCY = 4;
/** Small change sets open fully — reading them is the whole point. */
const AUTO_EXPAND_LIMIT = 3;
/** Past this many files the filter field earns its row. */
const SEARCH_THRESHOLD = 6;

type DiffState =
	| { state: "loading" }
	| { state: "ready"; diff: RpcGitDiff; adds: number; removes: number }
	| { state: "error"; error: string };

export function RepositoryChanges({ split = false }: { split?: boolean }) {
	const t = useT();
	const rpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const [refresh, setRefresh] = useState(0);
	const [changes, setChanges] = useState<RpcGitChanges | null>(null);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [diffs, setDiffs] = useState<ReadonlyMap<string, DiffState>>(new Map());
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const loadedFor = useRef<TabRpc | null>(null);
	/** Bumped per successful list load; stale diff responses from an older list are dropped. */
	const generation = useRef(0);
	const requested = useRef(new Set<string>());

	// A run that just settled may have changed the checkout: re-read it, so an
	// open drawer follows the agent's work without a manual refresh.
	const isStreaming = useSessionStore(state => state.isStreaming);
	const wasStreaming = useRef(isStreaming);
	useEffect(() => {
		if (wasStreaming.current && !isStreaming) setRefresh(value => value + 1);
		wasStreaming.current = isStreaming;
	}, [isStreaming]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly reloads the checkout.
	useEffect(() => {
		let active = true;
		setLoading(true);
		// A reload is not an initial load: only switching to another session's
		// client wipes the rows, so a failed refresh keeps the last good diff up.
		const switched = loadedFor.current !== rpc;
		if (switched) {
			setChanges(null);
			setExpanded(new Set());
		}
		setError(null);
		void Promise.resolve()
			.then(() => rpc.getGitChanges())
			.then(response => {
				if (!active) return;
				if (!response.success) throw new Error(response.error ?? t("rpc.failed"));
				const next = response.data as RpcGitChanges;
				const first = loadedFor.current !== rpc;
				loadedFor.current = rpc;
				generation.current++;
				requested.current = new Set();
				setDiffs(new Map());
				setChanges(next);
				const paths = new Set(next.files.map(file => file.path));
				setExpanded(previous =>
					first && next.files.length <= AUTO_EXPAND_LIMIT
						? paths
						: new Set([...previous].filter(path => paths.has(path))),
				);
			})
			.catch(cause => {
				if (active) setError(describeError(cause));
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [rpc, refresh, t]);

	const loadDiff = useCallback(
		async (path: string) => {
			if (requested.current.has(path)) return;
			requested.current.add(path);
			const owner = generation.current;
			setDiffs(previous => new Map(previous).set(path, { state: "loading" }));
			try {
				const response = await rpc.getGitDiff(path);
				if (!response.success) throw new Error(response.error ?? t("rpc.failed"));
				const diff = response.data as RpcGitDiff;
				const counts = diff.kind === "text" ? countDiffLines(diff.diff) : { adds: 0, removes: 0 };
				if (owner !== generation.current) return;
				setDiffs(previous => new Map(previous).set(path, { state: "ready", diff, ...counts }));
			} catch (cause) {
				if (owner !== generation.current) return;
				setDiffs(previous => new Map(previous).set(path, { state: "error", error: describeError(cause) }));
			}
		},
		[rpc, t],
	);

	// Expanded cards need their body; short lists also get counts up front.
	useEffect(() => {
		if (!changes?.isRepo) return;
		const wanted = [...expanded];
		if (changes.files.length <= PREFETCH_LIMIT) wanted.push(...changes.files.map(file => file.path));
		const queue = [...new Set(wanted)].filter(path => !requested.current.has(path));
		if (queue.length === 0) return;
		let cancelled = false;
		const worker = async () => {
			while (!cancelled) {
				const path = queue.shift();
				if (!path) return;
				// eslint-disable-next-line no-await-in-loop -- bounded concurrency
				await loadDiff(path);
			}
		};
		for (let i = 0; i < PREFETCH_CONCURRENCY; i++) void worker();
		return () => {
			cancelled = true;
		};
	}, [changes, expanded, loadDiff]);

	const files = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		return changes?.files.filter(file => file.path.toLocaleLowerCase().includes(needle)) ?? [];
	}, [changes, query]);

	const totals = useMemo(() => {
		let adds = 0;
		let removes = 0;
		let counted = 0;
		for (const entry of diffs.values()) {
			if (entry.state !== "ready") continue;
			adds += entry.adds;
			removes += entry.removes;
			counted++;
		}
		return counted > 0 ? { adds, removes } : null;
	}, [diffs]);

	const toggle = (path: string) =>
		setExpanded(previous => {
			const next = new Set(previous);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	const allExpanded = files.length > 0 && files.every(file => expanded.has(file.path));
	// Git names files from the repository root, which may sit above the workspace.
	const root = changes?.root?.replace(/[\\/]+$/, "");
	const fileCount = changes?.files.length ?? 0;

	const refreshButton = (
		<ToolbarIconButton label={t("common.refresh")} disabled={loading} onClick={() => setRefresh(value => value + 1)}>
			<RefreshCw size={14} className={cx(loading && changes && "animate-spin")} />
		</ToolbarIconButton>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* The scope note is reference, not chrome: assistive tech reads it, sighted users get it on hover. */}
			<p className="sr-only">{t("diffPanel.repositoryScope")}</p>
			<div className="flex h-9 shrink-0 items-center gap-2 pr-2 pl-3" title={t("diffPanel.repositoryScope")}>
				<span className="min-w-0 flex-1 truncate text-omp-sm text-(--omp-muted)">
					{changes?.isRepo && fileCount > 0
						? t("diffPanel.filesChanged", { count: fileCount, plural: fileCount === 1 ? "" : "s" })
						: t("diffPanel.mode.repository")}
				</span>
				{totals && <DiffStat adds={totals.adds} removes={totals.removes} />}
				{fileCount > 1 && (
					<ToolbarIconButton
						label={t(allExpanded ? "diffPanel.collapseAll" : "diffPanel.expandAll")}
						onClick={() => setExpanded(allExpanded ? new Set() : new Set(files.map(file => file.path)))}
					>
						{allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
					</ToolbarIconButton>
				)}
				{refreshButton}
			</div>
			{error && (
				<p
					role="alert"
					className="mx-3 mb-2 break-words rounded-md bg-(--omp-tool-error-bg) px-2.5 py-1.5 text-omp-sm text-(--omp-error)"
				>
					{error}
				</p>
			)}
			{fileCount > SEARCH_THRESHOLD && (
				<div className="px-3 pb-2">
					<PanelSearch label={t("diffPanel.search")} value={query} onChange={setQuery} />
				</div>
			)}
			{changes?.truncated && (
				<p role="status" className="px-3 pb-2 text-omp-xs text-(--omp-warning)">
					{t("diffPanel.listLimited")}
				</p>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
				{loading && !changes ? (
					<p className="px-3 py-2 text-omp-sm text-(--omp-dim)">{t("common.loading")}</p>
				) : changes && !changes.isRepo ? (
					<PanelEmpty icon={FolderX} title={t("diffPanel.notRepoTitle")} hint={t("diffPanel.notRepo")} />
				) : changes?.files.length === 0 ? (
					<PanelEmpty
						icon={CircleCheck}
						tone="success"
						title={t("diffPanel.clean")}
						hint={t("diffPanel.cleanHint")}
					/>
				) : changes && files.length === 0 ? (
					<p className="px-3 py-6 text-center text-omp-sm text-(--omp-dim)">{t("diffPanel.noMatch")}</p>
				) : (
					files.map(file => {
						const entry = diffs.get(file.path);
						const open = expanded.has(file.path);
						return (
							<div key={file.path} data-change-path={file.path}>
								<DiffFileCard
									expanded={open}
									onToggle={() => toggle(file.path)}
									onContextMenu={
										root ? event => showPathMenu(event, `${root}/${file.path}`, tabId) : undefined
									}
									leading={<ChangeBadge kind={gitChangeKind(file.status)} />}
									label={<FileLabel path={file.path} oldPath={file.oldPath} />}
									trailing={
										entry?.state === "ready" && entry.diff.kind === "text" ? (
											<DiffStat adds={entry.adds} removes={entry.removes} />
										) : null
									}
								>
									{!entry || entry.state === "loading" ? (
										<p className="px-4 py-2 text-omp-sm text-(--omp-dim)">{t("common.loading")}</p>
									) : entry.state === "error" ? (
										<p role="alert" className="break-words px-4 py-2 text-omp-sm text-(--omp-error)">
											{entry.error}
										</p>
									) : entry.diff.kind === "text" ? (
										<>
											<DiffBody diff={entry.diff.diff} filePath={entry.diff.path} split={split} />
											{entry.diff.truncated && (
												<p className="px-4 py-1.5 text-omp-xs text-(--omp-warning)">
													{t("diffPanel.previewLimited")}
												</p>
											)}
										</>
									) : (
										<p className="px-4 py-2 text-omp-sm text-(--omp-dim)">
											{t(`diffPanel.kind.${entry.diff.kind}`)}
										</p>
									)}
								</DiffFileCard>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
