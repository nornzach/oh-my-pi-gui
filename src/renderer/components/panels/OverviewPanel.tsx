/**
 * Overview drawer tab: what is true of this session right now, one card per
 * question — how full the context is, where the agent works, what it changed,
 * what is running, and which MCP servers it can reach. Each card links to the
 * full view instead of repeating its controls. Chat tabs have no tools, so they
 * show only Context, Workspace and Running.
 */
import { Activity, FolderGit2, Gauge, GitCompare, type LucideIcon, Server } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { getBtwLatestTurn, type RpcMcpServerInfo, type RpcMcpServersResult } from "../../../shared/rpc-types";
import { useAutoCompactAt } from "../../hooks/use-compaction-config";
import { useContextReport } from "../../hooks/use-context-report";
import { useGitStatus } from "../../hooks/use-git-status";
import { useWorkingTreeChanges } from "../../hooks/use-working-tree-changes";
import { contextSegments, contextUsageView, formatContextUsage } from "../../lib/context-usage";
import { describeError } from "../../lib/errors";
import { basename, cx, dirname, shortenPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useBtwStore } from "../../stores/btw";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { useSubagentsStore } from "../../stores/subagents";
import { useActiveTabKind } from "../../stores/tabs";
import { useTodoStore } from "../../stores/todo";
import { useUiStore } from "../../stores/ui";
import { subagentActivity } from "../agents/agent-activity";
import { Badge, type BadgeVariant, Button, Spinner } from "../common";
import { ContextBreakdown } from "../layout/ContextBreakdown";
import { inSpawnOrder } from "./subagent-graph";

/** Files listed in the Changes card before it points at the full view. */
const CHANGES_PREVIEW = 6;
/** Running rows per kind (subagents, side questions) before the rest fold into a count. */
const RUNNING_PREVIEW = 3;

function plural(count: number): string {
	return count === 1 ? "" : "s";
}

function Card({
	icon: Icon,
	title,
	action,
	children,
}: {
	icon: LucideIcon;
	title: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={title}
			className="rounded-xl border border-(--omp-border-muted) bg-(--omp-bg-elevated) px-3 pt-2 pb-3"
		>
			<header className="flex h-7 items-center gap-2">
				<Icon aria-hidden className="shrink-0 text-(--omp-dim)" size={14} />
				<h3 className="min-w-0 flex-1 truncate text-omp-sm font-medium text-(--omp-muted)">{title}</h3>
				{action}
			</header>
			<div className="mt-1.5">{children}</div>
		</section>
	);
}

function CardLink({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<Button className="-me-1.5" onClick={onClick} size="sm" variant="ghost">
			{label}
		</Button>
	);
}

function Muted({ children }: { children: ReactNode }) {
	return <p className="text-omp-md text-(--omp-dim)">{children}</p>;
}

function Row({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
	return (
		<div className="flex items-baseline gap-3 text-omp-md">
			<span className="w-16 shrink-0 text-(--omp-dim)">{label}</span>
			<span className="min-w-0 flex-1 truncate text-(--omp-text)" title={title}>
				{value}
			</span>
		</div>
	);
}

function ContextCard() {
	const t = useT();
	const openContextReport = useUiStore(state => state.openContextReport);
	const { contextUsage, breakdown, loading, error, retry } = useContextReport(true);
	const view = contextUsageView(contextUsage, breakdown);
	const autoCompactAt = useAutoCompactAt(view.contextWindow);
	const segments = breakdown ? contextSegments(breakdown, view, autoCompactAt) : [];

	return (
		<Card
			action={<CardLink label={t("overview.context.details")} onClick={openContextReport} />}
			icon={Gauge}
			title={t("overview.context.title")}
		>
			{contextUsage ? (
				<>
					<div className="mb-2 flex items-baseline justify-between gap-3 text-omp-md">
						<span className="text-(--omp-text)">
							{view.capacityKnown
								? t("overview.context.used", { percent: Math.round(view.percent) })
								: t("contextUsage.windowUnknown")}
						</span>
						<span className="shrink-0 font-mono tabular-nums text-(--omp-dim)">{formatContextUsage(view)}</span>
					</div>
					<ContextBreakdown approximate segments={segments} view={view} />
					{loading && segments.length === 0 ? (
						<div className="mt-2 flex items-center gap-2 text-omp-md text-(--omp-dim)">
							<Spinner size="sm" /> {t("contextUsage.loading")}
						</div>
					) : error && segments.length === 0 ? (
						<div className="mt-2 flex items-center gap-2">
							<span className="min-w-0 flex-1 text-omp-md text-(--omp-dim)">
								{t("contextUsage.unavailable")}
							</span>
							<Button onClick={retry} size="sm" variant="secondary">
								{t("common.retry")}
							</Button>
						</div>
					) : null}
				</>
			) : (
				<Muted>{t("overview.context.none")}</Muted>
			)}
		</Card>
	);
}

/** Its own component so a chat tab, which shows no branch, never polls git. */
function BranchRow() {
	const t = useT();
	const { status } = useGitStatus();
	const branch = !status
		? "—"
		: !status.isRepo
			? t("overview.workspace.noRepo")
			: (status.branch ?? t("overview.workspace.detached"));
	return <Row label={t("overview.workspace.branch")} value={branch} />;
}

function WorkspaceCard({ withGit }: { withGit: boolean }) {
	const t = useT();
	const cwd = useSessionStore(state => state.cwd);
	const model = useModelStore(state => state.model);

	return (
		<Card icon={FolderGit2} title={t("overview.workspace.title")}>
			<div className="space-y-1.5">
				<Row label={t("overview.workspace.folder")} title={cwd || undefined} value={cwd ? shortenPath(cwd) : "—"} />
				{withGit && <BranchRow />}
				<Row
					label={t("overview.workspace.model")}
					value={model ? (model.name ?? model.id) : t("overview.workspace.noModel")}
				/>
			</div>
		</Card>
	);
}

const CHANGE_STATUS_CLASS: Record<string, string> = {
	A: "text-(--omp-success)",
	U: "text-(--omp-success)",
	D: "text-(--omp-error)",
	R: "text-(--omp-info)",
};

function ChangesCard() {
	const t = useT();
	const setPanelTab = useUiStore(state => state.setPanelTab);
	const changes = useWorkingTreeChanges(true);
	const files = changes?.files ?? [];

	return (
		<Card
			action={
				files.length > 0 ? (
					<CardLink label={t("overview.changes.review")} onClick={() => setPanelTab("diff")} />
				) : undefined
			}
			icon={GitCompare}
			title={t("overview.changes.title")}
		>
			{!changes ? (
				<Muted>{t("overview.changes.unavailable")}</Muted>
			) : files.length === 0 ? (
				<Muted>{t("overview.changes.none")}</Muted>
			) : (
				<>
					<p className="mb-1.5 text-omp-md text-(--omp-text)">
						{t("overview.changes.count", { count: files.length, plural: plural(files.length) })}
					</p>
					<ul className="space-y-1">
						{files.slice(0, CHANGES_PREVIEW).map(file => {
							// Porcelain XY: the first non-blank side; untracked "??" reads as U.
							const raw = file.status.trim().charAt(0) || "M";
							const code = raw === "?" ? "U" : raw;
							return (
								<li className="flex items-center gap-2 text-omp-md" key={file.path} title={file.path}>
									<span
										className={cx(
											"w-3 shrink-0 text-center font-mono text-omp-xs",
											CHANGE_STATUS_CLASS[code] ?? "text-(--omp-warning)",
										)}
									>
										{code}
									</span>
									<span className="shrink-0 text-(--omp-text)">{basename(file.path)}</span>
									{/* Name, then its folder — the shape tool rows use; a root file has no folder to show. */}
									{dirname(file.path) && (
										<span className="min-w-0 truncate text-omp-sm text-(--omp-dim)">
											{dirname(file.path)}
										</span>
									)}
								</li>
							);
						})}
					</ul>
					{files.length > CHANGES_PREVIEW && (
						<p className="mt-1.5 text-omp-sm text-(--omp-dim)">
							{t("overview.more", { count: files.length - CHANGES_PREVIEW })}
						</p>
					)}
				</>
			)}
		</Card>
	);
}

function RunningCard() {
	const t = useT();
	const setPanelTab = useUiStore(state => state.setPanelTab);
	const isStreaming = useSessionStore(state => state.isStreaming);
	const isCompacting = useSessionStore(state => state.isCompacting);
	const subagents = useSubagentsStore(state => state.subagents);
	const btwRecords = useBtwStore(state => state.records);
	const phases = useTodoStore(state => state.phases);

	const liveAgents = inSpawnOrder(subagents.values()).filter(agent => subagentActivity(agent) === "working");
	const sideQuestions = btwRecords.filter(record => getBtwLatestTurn(record).status === "running");
	const tasks = phases.flatMap(phase => phase.tasks);
	const doneTasks = tasks.filter(task => task.status === "completed").length;
	const currentTask = tasks.find(task => task.status === "in_progress");
	const idle =
		!isStreaming && !isCompacting && liveAgents.length === 0 && sideQuestions.length === 0 && tasks.length === 0;

	return (
		<Card icon={Activity} title={t("overview.running.title")}>
			{idle ? (
				<Muted>{t("overview.running.none")}</Muted>
			) : (
				<ul className="space-y-1.5 text-omp-md">
					{(isStreaming || isCompacting) && (
						<li className="flex items-center gap-2 text-(--omp-text)">
							<Spinner size="sm" />
							{isCompacting ? t("overview.running.compacting") : t("overview.running.agent")}
						</li>
					)}
					{liveAgents.length > 0 && (
						<li>
							<button
								className="w-full truncate text-start text-(--omp-text) hover:text-(--omp-link)"
								onClick={() => setPanelTab("agents")}
								type="button"
							>
								{t("overview.running.subagents", {
									count: liveAgents.length,
									plural: plural(liveAgents.length),
								})}
							</button>
							<ul className="mt-1 space-y-0.5 ps-3">
								{liveAgents.slice(0, RUNNING_PREVIEW).map(agent => (
									<li className="truncate text-omp-sm text-(--omp-dim)" key={agent.id}>
										<span className="text-(--omp-muted)">{agent.agent}</span>
										{agent.description ? ` · ${agent.description}` : null}
									</li>
								))}
								{liveAgents.length > RUNNING_PREVIEW && (
									<li className="text-omp-sm text-(--omp-dim)">
										{t("overview.more", { count: liveAgents.length - RUNNING_PREVIEW })}
									</li>
								)}
							</ul>
						</li>
					)}
					{sideQuestions.slice(0, RUNNING_PREVIEW).map(record => (
						<li key={record.id}>
							<button
								className="w-full truncate text-start text-(--omp-text) hover:text-(--omp-link)"
								onClick={() => {
									useBtwStore.getState().select(record.id);
									setPanelTab("btw");
								}}
								type="button"
							>
								{t("overview.running.sideQuestion", { question: getBtwLatestTurn(record).question })}
							</button>
						</li>
					))}
					{tasks.length > 0 && (
						<li>
							<div className="text-(--omp-text)">
								{t("overview.running.todos", { done: doneTasks, total: tasks.length })}
							</div>
							{currentTask && (
								<div className="mt-0.5 truncate ps-3 text-omp-sm text-(--omp-dim)">{currentTask.content}</div>
							)}
						</li>
					)}
				</ul>
			)}
		</Card>
	);
}

function serverState(server: RpcMcpServerInfo): { key: string; variant: BadgeVariant; pulse?: boolean } {
	if (!server.enabled) return { key: "off", variant: "muted" };
	if (server.lastError || server.authState === "expired" || server.authState === "required")
		return { key: "error", variant: "error" };
	if (server.status === "connected") return { key: "connected", variant: "success" };
	if (server.status === "connecting") return { key: "connecting", variant: "warning", pulse: true };
	return { key: "disconnected", variant: "muted" };
}

function ServersCard() {
	const t = useT();
	const rpc = useTabRpc();
	const ready = useSessionStore(state => state.status) === "ready";
	const sessionId = useSessionStore(state => state.sessionId);
	const openExtensions = useUiStore(state => state.openExtensions);
	const [servers, setServers] = useState<RpcMcpServerInfo[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new session or a retry re-reads the server list.
	useEffect(() => {
		if (!ready) return;
		let cancelled = false;
		setFailed(false);
		void rpc
			.getMcpServers()
			.then(response => {
				if (cancelled) return;
				if (response.success) setServers((response.data as RpcMcpServersResult | undefined)?.servers ?? []);
				else setFailed(true);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [ready, rpc, sessionId, attempt]);

	return (
		<Card
			action={<CardLink label={t("overview.servers.manage")} onClick={() => openExtensions("mcp")} />}
			icon={Server}
			title={t("overview.servers.title")}
		>
			{failed && !servers ? (
				<div className="flex items-center gap-2">
					<span className="min-w-0 flex-1 text-omp-md text-(--omp-dim)">{t("overview.servers.failed")}</span>
					<Button onClick={() => setAttempt(count => count + 1)} size="sm" variant="secondary">
						{t("common.retry")}
					</Button>
				</div>
			) : !servers ? (
				<div className="flex items-center gap-2 text-omp-md text-(--omp-dim)">
					<Spinner size="sm" /> {t("common.loading")}
				</div>
			) : servers.length === 0 ? (
				<Muted>{t("overview.servers.none")}</Muted>
			) : (
				<ul className="space-y-1.5">
					{servers.map(server => {
						const state = serverState(server);
						return (
							<li
								className="flex items-center gap-2 text-omp-md"
								key={server.name}
								title={server.lastError ? describeError(server.lastError) : undefined}
							>
								<span className="min-w-0 flex-1 truncate text-(--omp-text)">{server.name}</span>
								{server.status === "connected" && server.enabled && (
									<span className="shrink-0 text-omp-sm tabular-nums text-(--omp-dim)">
										{t("overview.servers.tools", {
											count: server.toolCount,
											plural: plural(server.toolCount),
										})}
									</span>
								)}
								<Badge dot pulse={state.pulse} variant={state.variant}>
									{t(`overview.servers.status.${state.key}`)}
								</Badge>
							</li>
						);
					})}
				</ul>
			)}
		</Card>
	);
}

export function OverviewPanel() {
	const isChat = useActiveTabKind() === "chat";
	return (
		<div className="h-full space-y-3 overflow-y-auto p-3">
			<ContextCard />
			<WorkspaceCard withGit={!isChat} />
			{!isChat && <ChangesCard />}
			<RunningCard />
			{!isChat && <ServersCard />}
		</div>
	);
}
