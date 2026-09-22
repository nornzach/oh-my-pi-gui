import { ChevronRight, Clock3, Coins, Database, FolderOpen, Gauge, PanelLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionStats } from "../../../shared/rpc-types";
import { useSessionList } from "../../hooks/use-session-list";
import { basename, cx, formatCost, formatDuration, formatPercent, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { onEscape } from "../../lib/keymap";
import { useTabRpc } from "../../lib/tab-rpc";
import { useMessagesStore } from "../../stores/messages";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { useActiveTabKind } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { useToolsStore } from "../../stores/tools";
import { useUiStore } from "../../stores/ui";
import { WorkspaceDialog } from "../dialogs/WorkspaceDialog";
import { sessionCacheHitPercent, sessionExecutionDurationMs } from "./session-metrics";

/**
 * Native desktop toolbar. Session controls stay here; model and execution
 * controls live beside the composer where they affect the next message.
 */
export function TitleBar() {
	const tabRpc = useTabRpc();
	const t = useT();
	const tabId = useRuntimeTabId();
	const sessionId = useSessionStore(s => s.sessionId);
	const sessionName = useSessionStore(s => s.sessionName);
	const cwd = useSessionStore(s => s.cwd);
	const status = useSessionStore(s => s.status);
	const isStreaming = useSessionStore(s => s.isStreaming);
	const isCompacting = useSessionStore(s => s.isCompacting);
	const statsPulse = useSessionStore(s => s.statsPulse);
	const isChat = useActiveTabKind() === "chat";

	const planModeEnabled = useSessionStore(s => s.planModeEnabled);
	const awaitingModelSince = useSessionStore(s => s.awaitingModelSince);
	const messages = useMessagesStore(s => s.messages);
	const streamingMessage = useMessagesStore(s => s.streamingMessage);
	const tools = useToolsStore(s => s.activeTools);
	const sidebarVisible = useUiStore(s => s.sidebarVisible);
	const toggleSidebar = useUiStore(s => s.toggleSidebar);
	const { sessions } = useSessionList("local");
	const projectName = !isChat && cwd ? basename(cwd) : t("titlebar.openProject");

	const [editingName, setEditingName] = useState(false);
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [stats, setStats] = useState<SessionStats | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const nameInputRef = useRef<HTMLInputElement>(null);
	const statsMessageCount = messages.length;
	// A settled transcript append and a fresh sidecar snapshot are the two things
	// that can move these figures. Mid-run appends come several times a turn, so
	// only the pulse may re-queue a stats command there — the serial command queue
	// has to stay free for the agent's own traffic.
	const statsTrigger = isStreaming ? `streaming:${statsPulse}` : `idle:${statsMessageCount}:${statsPulse}`;
	const prevSessionRef = useRef<string | null>(null);

	useEffect(() => {
		if (editingName) nameInputRef.current?.select();
	}, [editingName]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the settled transcript and the snapshot pulse both refresh the cost figures even when the session ID is stable.
	useEffect(() => {
		if (!sessionId || status !== "ready") {
			setStats(null);
			prevSessionRef.current = null;
			return;
		}
		// Cross-session staleness is the bug: session A's tokens/cost must never
		// display over session B. Within ONE session, keeping the previous read
		// while the refetch is in flight beats a clear-refetch flicker on every
		// message append; the session-id guard rejects mismatched responses.
		if (prevSessionRef.current !== sessionId) setStats(null);
		prevSessionRef.current = sessionId;
		// Compaction rewrites the journal, so a reading taken mid-shake is noise.
		// Streaming is no longer a reason to freeze the figures — the pulse paces it.
		if (isCompacting) return;
		let cancelled = false;
		const requestedSessionId = sessionId;
		const originSession = sessionRuntimeStore<SessionStore>(tabId, "session") ?? useSessionStore;
		void tabRpc
			.getSessionStats()
			.then(response => {
				if (!cancelled && response.success && originSession.getState().sessionId === requestedSessionId) {
					setStats(response.data as SessionStats);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [sessionId, statsTrigger, status, tabRpc.getSessionStats, tabId, isCompacting]);

	const hasRunningTool = [...tools.values()].some(tool => tool.endTime === null);
	useEffect(() => {
		setNow(Date.now());
		if (!isStreaming && !hasRunningTool) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [hasRunningTool, isStreaming]);

	const current = sessions.find(s => s.id === sessionId);
	// `||` everywhere: empty-string titles (never-generated auto-title slot)
	// fall through like null, ending at the "New Session" placeholder.
	const displayName = sessionName || current?.title || t("sidebar.newSession");
	const visibleStats = stats?.sessionId === sessionId ? stats : null;
	const cacheHit = sessionCacheHitPercent(visibleStats);
	const executionDuration = sessionExecutionDurationMs({
		messages,
		streamingMessage,
		tools,
		awaitingModelSince,
		isStreaming,
		now,
	});

	const commitName = () => {
		const name = draft.trim();
		setEditingName(false);
		if (!name || name === displayName) return;
		const originSession = sessionRuntimeStore<SessionStore>(tabId, "session") ?? useSessionStore;
		const originId = originSession.getState().sessionId;
		void tabRpc
			.setSessionName(name)
			.then(response => {
				if (response.success) {
					if (originSession.getState().sessionId === originId) originSession.setState({ sessionName: name });
				} else toast({ variant: "error", title: t("titlebar.renameFailed"), message: response.error });
			})
			.catch(error => {
				toast({ variant: "error", title: t("titlebar.renameFailed"), message: String(error) });
			});
	};

	const iconButton =
		"no-drag omp-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]";
	const working = isStreaming || isCompacting;
	const statusActive = working || status === "starting" || status === "restarting";
	const statusLabel = working
		? t("titlebar.status.working")
		: status === "ready"
			? t("titlebar.status.ready")
			: status === "starting"
				? t("titlebar.status.connecting")
				: status === "error" || status === "exited" || status === "restarting"
					? t(`titlebar.status.${status}`)
					: status;
	const statusColor = working
		? "var(--omp-accent)"
		: status === "ready"
			? "var(--omp-dim)"
			: status === "error" || status === "exited"
				? "var(--omp-error)"
				: "var(--omp-warning)";

	return (
		<header className="omp-titlebar drag-region flex h-12 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b border-[var(--omp-border-muted)] bg-[var(--omp-titlebar-bg)] px-2.5">
			<button type="button" onClick={toggleSidebar} title={t("titlebar.toggleSidebar")} className={iconButton}>
				<PanelLeft size={18} className={cx(sidebarVisible && "text-[var(--omp-text)]")} />
			</button>

			<div className="omp-titlebar-identity no-drag flex min-w-0 items-center gap-1.5">
				<button
					className="omp-pressable flex min-w-0 max-w-48 items-center gap-2 truncate rounded-lg px-2 py-1.5 text-omp-lg font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)] disabled:cursor-not-allowed disabled:text-[var(--omp-dim)]"
					disabled={isStreaming}
					onClick={() => setWorkspaceOpen(true)}
					title={isStreaming ? t("titlebar.abortHint") : t("titlebar.openProject")}
					type="button"
				>
					<FolderOpen className="shrink-0" size={15} />
					<span className="truncate">{projectName}</span>
				</button>
				<ChevronRight size={14} className="text-[var(--omp-dim)]" />
				{editingName ? (
					<input
						ref={nameInputRef}
						value={draft}
						onChange={event => setDraft(event.target.value)}
						onBlur={commitName}
						onKeyDown={event => {
							if (isImeKeyEvent(event)) return;
							if (event.key === "Enter") commitName();
							onEscape(event, () => setEditingName(false));
						}}
						className="min-w-0 max-w-56 rounded-lg border border-[var(--omp-input-focus-border)] bg-[var(--omp-input-bg)] px-2.5 py-1.5 text-omp-lg font-medium text-[var(--omp-text)] outline-none"
					/>
				) : (
					<button
						type="button"
						title={t("titlebar.rename")}
						onClick={() => {
							setDraft(sessionName ?? "");
							setEditingName(true);
						}}
						className="omp-pressable min-w-0 max-w-72 truncate rounded-lg px-2 py-1.5 text-omp-lg font-semibold text-[var(--omp-text)] hover:bg-[var(--omp-selected-bg)]"
					>
						{displayName}
					</button>
				)}
			</div>

			<div className="omp-titlebar-status no-drag flex shrink-0 items-center gap-1.5 px-1 text-omp-sm font-medium text-[var(--omp-muted)]">
				<span
					role="img"
					aria-label={statusLabel}
					title={statusLabel}
					className={cx("omp-signal-light", statusActive && "omp-signal-light--active")}
					style={{ color: statusColor }}
				/>
				<span className="omp-titlebar-status-label">{statusLabel}</span>
			</div>

			{planModeEnabled && (
				<span
					className="no-drag shrink-0 rounded-full border border-[var(--omp-border-accent)] bg-[var(--omp-accent-dim)] px-2 py-1 text-omp-xs font-semibold text-[var(--omp-accent)]"
					title={t("titlebar.planMode")}
				>
					{t("titlebar.plan")}
				</span>
			)}

			<div className="flex-1" />

			<div className="omp-session-metrics no-drag flex shrink-0 items-center gap-3 font-mono text-omp-sm tabular-nums text-[var(--omp-muted)]">
				<span
					className="flex items-center gap-1"
					title={t(visibleStats?.history ? "titlebar.metric.historyTokens" : "titlebar.metric.tokens")}
				>
					<Database aria-hidden="true" size={14} />
					{visibleStats ? formatTokens(visibleStats.history?.totalTokens ?? visibleStats.tokens.total) : "—"}
				</span>
				<span
					className="flex items-center gap-1"
					title={t(visibleStats?.history ? "titlebar.metric.historyCost" : "titlebar.metric.cost")}
				>
					<Coins aria-hidden="true" size={14} />
					{visibleStats ? formatCost(visibleStats.history?.cost ?? visibleStats.cost, 4) : "—"}
				</span>
				<span className="flex items-center gap-1" title={t("titlebar.metric.cacheHit")}>
					<Gauge aria-hidden="true" size={14} />
					{formatPercent(cacheHit, 0)}
				</span>
				<span className="flex items-center gap-1" title={t("titlebar.metric.duration")}>
					<Clock3 aria-hidden="true" size={14} />
					{executionDuration > 0 ? formatDuration(executionDuration) : t("time.secondsShort", { count: 0 })}
				</span>
			</div>
			<WorkspaceDialog open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
		</header>
	);
}
