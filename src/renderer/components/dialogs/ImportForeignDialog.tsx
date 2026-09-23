import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Foreign-session import wizard (Claude/Codex → OMP copy): list sessions from
 * a source, multi-select, import each as a fresh OMP session (the source data
 * is never modified). A single import opens the new session via the normal
 * switch flow; multiple imports land in the sidebar list with a count toast.
 * Backs the `list_foreign_sessions` / `import_foreign_session` RPCs.
 */

import { Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RpcForeignSessionInfo, RpcResponse } from "../../../shared/rpc-types";
import { cx, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Input, Modal, Spinner } from "../common";

type Source = "claude" | "codex";

const SOURCES: Source[] = ["claude", "codex"];

interface SourceState {
	loading: boolean;
	error: string | null;
	sessions: RpcForeignSessionInfo[];
}

export function ImportForeignDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const close = useUiStore(s => s.closeImportDialog);
	const [source, setSource] = useState<Source>("claude");
	const [states, setStates] = useState<Partial<Record<Source, SourceState>>>({});
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [importing, setImporting] = useState(false);
	const [importError, setImportError] = useState<string | null>(null);
	const [completed, setCompleted] = useState<Set<string>>(new Set());
	const generation = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a different session client invalidates pending imports.
	useEffect(() => {
		generation.current++;
		return () => {
			generation.current++;
		};
	}, [tabRpc]);

	const load = useCallback(
		async (target: Source, force = false) => {
			const existing = states[target];
			if (!force && existing && (existing.sessions.length > 0 || existing.error !== null || existing.loading)) {
				return;
			}
			setStates(current => ({ ...current, [target]: { loading: true, error: null, sessions: [] } }));
			const version = generation.current;
			try {
				const response = await tabRpc.listForeignSessions(target);
				if (version !== generation.current) return;
				if (!response.success) {
					setStates(current => ({
						...current,
						[target]: { loading: false, error: response.error, sessions: [] },
					}));
					return;
				}
				const data = response.data as { sessions?: RpcForeignSessionInfo[] } | undefined;
				setStates(current => ({
					...current,
					[target]: { loading: false, error: null, sessions: data?.sessions ?? [] },
				}));
			} catch (cause) {
				if (generation.current === version)
					setStates(current => ({ ...current, [target]: { loading: false, error: String(cause), sessions: [] } }));
			}
		},
		[states, tabRpc.listForeignSessions],
	);

	// Reload only when the source tab changes (load() closes over cached states).
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed reload by design
	useEffect(() => {
		void load(source, true);
	}, [source, tabRpc]);

	const state = states[source];
	const filtered = useMemo(() => {
		const sessions = state?.sessions ?? [];
		const q = query.trim().toLowerCase();
		if (!q) return sessions;
		return sessions.filter(
			session =>
				(session.title ?? "").toLowerCase().includes(q) ||
				(session.firstMessage ?? "").toLowerCase().includes(q) ||
				session.cwd.toLowerCase().includes(q),
		);
	}, [state, query]);

	const toggle = (id: string) => {
		id = `${source}:${id}`;
		setSelected(current => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const doImport = async () => {
		const sessions = (state?.sessions ?? []).filter(session => selected.has(`${source}:${session.id}`));
		if (sessions.length === 0 || importing) return;
		setImporting(true);
		setImportError(null);
		const failed = new Set<string>();
		const version = generation.current;
		try {
			let firstImported: { sessionPath: string; sessionId: string; cwd: string } | null = null;
			let importedCount = 0;
			for (const session of sessions) {
				let response: RpcResponse;
				try {
					response = await tabRpc.importForeignSession(source, session.id);
				} catch (cause) {
					failed.add(`${source}:${session.id}`);
					setImportError(String(cause));
					continue;
				}
				if (generation.current !== version) return;
				if (!response.success) {
					failed.add(`${source}:${session.id}`);
					setImportError(response.error);
					continue;
				}
				const data = response.data as { sessionPath?: string; sessionId?: string; cwd?: string } | undefined;
				if (data?.sessionPath && data.sessionId) {
					importedCount += 1;
					setCompleted(current => new Set([...current, `${source}:${session.id}`]));
					firstImported ??= {
						sessionPath: data.sessionPath,
						sessionId: data.sessionId,
						cwd: data.cwd ?? session.cwd,
					};
				}
			}
			if (importedCount === 0) return;
			if (sessions.length === 1 && firstImported) {
				const tabId = await useTabsStore.getState().openTab({ sessionPath: firstImported.sessionPath });
				if (tabId) close();
				else setImportError(t("import.openFailed", { path: firstImported.sessionPath }));
				return;
			}
			toast({ variant: "success", message: t("import.imported", { count: importedCount }) });
			setSelected(failed);
			// Refresh the list after a batch so newly available source sessions and
			// completion markers are reconciled instead of leaving a stale snapshot.
			await load(source, true);
		} catch (cause) {
			setImportError(String(cause));
		} finally {
			if (generation.current === version) setImporting(false);
		}
	};

	return (
		<Modal
			open
			onClose={() => {
				if (!importing) close();
			}}
			title={t("import.title")}
			size="lg"
		>
			<div className="mb-3 flex items-center gap-2">
				{SOURCES.map(candidate => (
					<button
						key={candidate}
						type="button"
						disabled={importing}
						aria-pressed={source === candidate}
						onClick={() => {
							setSource(candidate);
							setSelected(new Set());
						}}
						className={cx(
							"rounded-lg px-3 py-1.5 text-omp-md font-medium capitalize",
							source === candidate
								? "bg-(--omp-btn-primary-bg) text-(--omp-btn-primary-text)"
								: "border border-(--omp-border) text-(--omp-muted) hover:bg-(--omp-selected-bg)",
						)}
					>
						{candidate === "claude" ? "Claude" : "Codex"}
					</button>
				))}
				<span className="ml-auto">
					<Input
						aria-label={t("import.search")}
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder={t("import.search")}
					/>
				</span>
			</div>

			{importError && (
				<p role="alert" className="mb-2 text-omp-sm text-(--omp-error)">
					{importError}
				</p>
			)}
			<Button size="sm" disabled={importing || state?.loading} onClick={() => void load(source, true)}>
				{t("common.refresh")}
			</Button>
			<div className="max-h-[46vh] min-h-[200px] overflow-y-auto rounded-lg border border-(--omp-border-muted)">
				{state?.loading && (
					<div className="flex h-32 items-center justify-center text-(--omp-dim)">
						<Loader2 size={16} className="animate-spin" />
					</div>
				)}
				{state?.error && (
					<div className="px-4 py-6 text-center text-omp-md text-(--omp-muted)">
						{t("import.sourceUnavailable", { source })}
						<div className="mt-1 text-omp-sm text-(--omp-dim)">{state.error}</div>
					</div>
				)}
				{!state?.loading && !state?.error && filtered.length === 0 && (
					<div className="px-4 py-6 text-center text-omp-md text-(--omp-dim)">{t("import.empty")}</div>
				)}
				{!state?.loading &&
					!state?.error &&
					filtered.map(session => (
						<label
							key={session.id}
							className="flex cursor-pointer items-start gap-3 border-b border-(--omp-border-muted) px-3 py-2.5 last:border-0 hover:bg-(--omp-selected-bg)"
						>
							<input
								type="checkbox"
								disabled={importing || completed.has(`${source}:${session.id}`)}
								checked={selected.has(`${source}:${session.id}`)}
								onChange={() => toggle(session.id)}
								className="mt-1"
							/>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-omp-md font-medium text-(--omp-text)">
									{session.title ?? session.firstMessage ?? t("import.untitled")}
									{completed.has(`${source}:${session.id}`) && (
										<span className="ml-2 text-(--omp-success)">{t("import.done")}</span>
									)}
								</span>
								<span className="mt-0.5 block whitespace-pre-wrap text-omp-sm text-(--omp-muted)">
									{session.firstMessage}
								</span>
								<span className="mt-0.5 block truncate font-mono text-omp-xs text-(--omp-dim)">
									{session.cwd}
								</span>
							</span>
							<span className="shrink-0 text-right text-omp-xs text-(--omp-dim)">
								{formatTimeAgo(session.modified)}
								{session.messageCount !== undefined && (
									<span className="block">{t("import.messages", { count: session.messageCount })}</span>
								)}
							</span>
						</label>
					))}
			</div>

			<div className="mt-3 flex items-center gap-3">
				<span className="text-omp-sm text-(--omp-dim)">{t("import.copyNote")}</span>
				<span className="ml-auto">
					<Button
						disabled={selected.size === 0 || importing}
						icon={importing ? <Spinner size="sm" /> : <Download size={13} />}
						onClick={() => void doImport()}
						size="sm"
					>
						{selected.size > 0 ? t("import.importN", { count: selected.size }) : t("import.import")}
					</Button>
				</span>
			</div>
		</Modal>
	);
}
