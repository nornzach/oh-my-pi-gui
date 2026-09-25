import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Debugger console: structured front-end over the agent `debug` RPC tool.
 * Three zones — sessions strip (auto-refreshed on open and after every
 * state-changing action), first-class action bar, structured results pane —
 * plus a collapsed raw-JSON request editor for advanced actions.
 *
 * Wire shape (packages/coding-agent/src/modes/rpc/rpc-mode.ts): response data
 * is `{ content: [{ type: "text", text }], details }` where `details` is
 * DebugToolDetails (packages/coding-agent/src/tools/debug.ts):
 *   { action, snapshot?, sessions?, threads?, stackFrames?, output?, adapter?,
 *     state?, timedOut? }
 * The tool schema has no session selector — actions target the backend's
 * implicit active session, so the strip re-syncs selection from each result's
 * snapshot and approximates "active" by most-recent use between snapshots.
 */

import {
	ArrowDownToLine,
	ArrowRightToLine,
	ArrowUpFromLine,
	Bug,
	ChevronDown,
	ChevronRight,
	Layers,
	ListTree,
	Pause,
	Play,
	Plug,
	RefreshCw,
	Rocket,
	Square,
	Terminal,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { RpcDebugAction, RpcDebugParams } from "../../../shared/rpc-types";
import { cx, resultDetails, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";
import { Badge, type BadgeVariant, Button, Modal, Spinner, TextArea } from "../common";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** Subset of DapSessionSummary the console renders (see dap/types.ts). */
interface DebugSessionSummary {
	id: string;
	adapter: string;
	status: string;
	cwd?: string;
	program?: string;
	stopReason?: string;
	frameName?: string;
	sourcePath?: string;
	line?: number;
	column?: number;
	exitCode?: number;
	threadId?: number;
	needsConfigurationDone: boolean;
	lastUsedAt?: string;
}

/** DapThread: id + name only; the stopped thread is inferred from the snapshot. */
interface DebugThread {
	id: number;
	name: string;
}

interface DebugStackFrame {
	id: number;
	name: string;
	sourcePath?: string;
	line?: number;
	column?: number;
}

interface DebugResultData {
	action: RpcDebugAction;
	data: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value != null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function asSummary(value: unknown): DebugSessionSummary | undefined {
	const record = asRecord(value);
	const id = asString(record?.id);
	const adapter = asString(record?.adapter);
	const status = asString(record?.status);
	if (!record || !id || !adapter || !status) return undefined;
	const source = asRecord(record.source);
	return {
		id,
		adapter,
		status,
		cwd: asString(record.cwd),
		program: asString(record.program),
		stopReason: asString(record.stopReason),
		frameName: asString(record.frameName),
		sourcePath: asString(source?.path) ?? asString(source?.name),
		line: asNumber(record.line),
		column: asNumber(record.column),
		exitCode: asNumber(record.exitCode),
		threadId: asNumber(record.threadId),
		needsConfigurationDone: record.needsConfigurationDone === true,
		lastUsedAt: asString(record.lastUsedAt),
	};
}

function asSessions(value: unknown): DebugSessionSummary[] {
	if (!Array.isArray(value)) return [];
	const sessions: DebugSessionSummary[] = [];
	for (const item of value) {
		const summary = asSummary(item);
		if (summary) sessions.push(summary);
	}
	return sessions;
}

function asThreads(value: unknown): DebugThread[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const threads: DebugThread[] = [];
	for (const item of value) {
		const record = asRecord(item);
		const id = asNumber(record?.id);
		const name = asString(record?.name);
		if (id !== undefined && name) threads.push({ id, name });
	}
	return threads;
}

function asFrames(value: unknown): DebugStackFrame[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const frames: DebugStackFrame[] = [];
	for (const item of value) {
		const record = asRecord(item);
		if (!record) continue;
		const id = asNumber(record.id);
		const name = asString(record.name);
		if (id === undefined || !name) continue;
		const source = asRecord(record.source);
		frames.push({
			id,
			name,
			sourcePath: asString(source?.path) ?? asString(source?.name),
			line: asNumber(record.line),
			column: asNumber(record.column),
		});
	}
	return frames;
}

/** `file:line[:column]` for a snapshot/frame source, when known. */
function formatLocation(sourcePath: string | undefined, line: number | undefined, column?: number): string | undefined {
	if (!sourcePath) return undefined;
	if (line === undefined) return sourcePath;
	return `${sourcePath}:${line}${column !== undefined ? `:${column}` : ""}`;
}

function summaryLocation(summary: DebugSessionSummary): string | undefined {
	return formatLocation(summary.sourcePath, summary.line, summary.column);
}

/** The backend exposes no "active" flag; prefer the snapshot-pinned id, else the most recently used live session. */
function pickActiveSession(sessions: DebugSessionSummary[], preferredId: string | null): string | null {
	if (preferredId && sessions.some(session => session.id === preferredId)) return preferredId;
	const live = sessions.filter(session => session.status !== "terminated");
	const pool = live.length > 0 ? live : sessions;
	let best: DebugSessionSummary | undefined;
	for (const session of pool) {
		if (!best || (session.lastUsedAt ?? "") > (best.lastUsedAt ?? "")) best = session;
	}
	return best?.id ?? null;
}

/** Mirrors DEBUG_READONLY_ACTIONS in packages/coding-agent/src/tools/debug.ts — everything else may change session state. */
const READONLY_ACTIONS: Record<string, true> = {
	output: true,
	threads: true,
	stack_trace: true,
	scopes: true,
	variables: true,
	disassemble: true,
	read_memory: true,
	loaded_sources: true,
	modules: true,
	sessions: true,
};

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
	launching: "info",
	configuring: "info",
	stopped: "warning",
	running: "success",
	terminated: "muted",
};

const STATUS_KEYS: Record<string, string> = {
	launching: "debug.status.launching",
	configuring: "debug.status.configuring",
	stopped: "debug.status.stopped",
	running: "debug.status.running",
	terminated: "debug.status.terminated",
};

const PRESETS: Array<{ labelKey: string; params: RpcDebugParams }> = [
	{ labelKey: "debug.sessions", params: { action: "sessions" } },
	{ labelKey: "debug.threads", params: { action: "threads" } },
	{ labelKey: "debug.stack", params: { action: "stack_trace" } },
	{ labelKey: "debug.continue", params: { action: "continue" } },
	{ labelKey: "debug.pause", params: { action: "pause" } },
	{ labelKey: "debug.output", params: { action: "output" } },
];

const LAUNCH_EXAMPLE: RpcDebugParams = {
	action: "launch",
	program: "./path/to/program",
	adapter: "lldb-dap",
};

const ATTACH_EXAMPLE: RpcDebugParams = { action: "attach", pid: 1234 };

interface ActionDef {
	action: RpcDebugAction;
	labelKey: string;
	icon: ReactNode;
	danger?: boolean;
	enabled: (active: DebugSessionSummary | undefined) => boolean;
}

const isLive = (active: DebugSessionSummary | undefined): boolean =>
	active !== undefined && active.status !== "terminated";
const isStopped = (active: DebugSessionSummary | undefined): boolean => active?.status === "stopped";

const ACTION_DEFS: ActionDef[] = [
	{ action: "threads", labelKey: "debug.threads", icon: <ListTree size={12} />, enabled: isLive },
	{ action: "stack_trace", labelKey: "debug.stack", icon: <Layers size={12} />, enabled: isStopped },
	{
		action: "continue",
		labelKey: "debug.continue",
		icon: <Play size={12} />,
		enabled: active => isStopped(active) || active?.status === "configuring",
	},
	{
		action: "pause",
		labelKey: "debug.pause",
		icon: <Pause size={12} />,
		enabled: active => active?.status === "running",
	},
	{ action: "step_over", labelKey: "debug.stepOver", icon: <ArrowRightToLine size={12} />, enabled: isStopped },
	{ action: "step_in", labelKey: "debug.stepIn", icon: <ArrowDownToLine size={12} />, enabled: isStopped },
	{ action: "step_out", labelKey: "debug.stepOut", icon: <ArrowUpFromLine size={12} />, enabled: isStopped },
	{
		action: "output",
		labelKey: "debug.output",
		icon: <Terminal size={12} />,
		enabled: active => active !== undefined,
	},
	{
		action: "terminate",
		labelKey: "debug.terminate",
		icon: <Square size={12} />,
		danger: true,
		enabled: isLive,
	},
];

function StatusBadge({ status, t }: { status: string; t: TranslateFn }) {
	const key = STATUS_KEYS[status];
	return (
		<Badge dot pulse={status === "running"} variant={STATUS_VARIANTS[status] ?? "default"}>
			{key ? t(key) : status}
		</Badge>
	);
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="flex gap-2">
			<span className="w-20 shrink-0">{label}</span>
			<span className={cx("min-w-0 break-all text-(--omp-text)", mono && "font-mono")}>{value}</span>
		</div>
	);
}

function SessionRow({
	session,
	active,
	selected,
	onSelect,
	t,
}: {
	session: DebugSessionSummary;
	active: boolean;
	selected: boolean;
	onSelect: () => void;
	t: TranslateFn;
}) {
	const details: string[] = [];
	if (session.program) details.push(session.program);
	if (session.stopReason) details.push(`${t("debug.meta.stopReason")}: ${session.stopReason}`);
	const location = summaryLocation(session);
	if (location) details.push(location);
	return (
		<button
			className={cx(
				"flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
				selected
					? "border-(--omp-accent) bg-(--omp-selected-bg)"
					: "border-(--omp-border-muted) bg-transparent hover:border-(--omp-border-strong)",
			)}
			onClick={onSelect}
			type="button"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-mono text-omp-md font-medium text-(--omp-text)">{session.adapter}</span>
				<StatusBadge status={session.status} t={t} />
				{active ? <Badge variant="info">{t("debug.active")}</Badge> : null}
				<span className="ml-auto font-mono text-omp-xs text-(--omp-dim)">{session.id}</span>
			</div>
			{details.length > 0 ? (
				<div className="truncate text-omp-sm text-(--omp-dim)">{details.join(" · ")}</div>
			) : null}
		</button>
	);
}

function ThreadsTable({
	threads,
	snapshot,
	t,
}: {
	threads: DebugThread[];
	snapshot: DebugSessionSummary | undefined;
	t: TranslateFn;
}) {
	if (threads.length === 0) {
		return <div className="px-3 py-4 text-center text-omp-sm text-(--omp-dim)">{t("debug.emptyThreads")}</div>;
	}
	return (
		<div className="overflow-hidden rounded-lg border border-(--omp-border-muted)">
			<div className="grid grid-cols-[48px_1fr_auto] gap-2 border-b border-(--omp-border-muted) bg-transparent px-3 py-1.5 text-omp-xs font-medium tracking-wide text-(--omp-dim) uppercase">
				<span>{t("debug.col.id")}</span>
				<span>{t("debug.col.name")}</span>
				<span>{t("debug.col.state")}</span>
			</div>
			{threads.map(thread => (
				<div
					className="grid grid-cols-[48px_1fr_auto] items-center gap-2 border-t border-(--omp-border-muted) px-3 py-1.5"
					key={thread.id}
				>
					<span className="font-mono text-omp-md text-(--omp-text)">{thread.id}</span>
					<span className="truncate text-omp-md text-(--omp-text)">{thread.name}</span>
					{snapshot?.threadId === thread.id ? (
						<StatusBadge status={snapshot.status} t={t} />
					) : (
						<span className="text-omp-sm text-(--omp-dim)">—</span>
					)}
				</div>
			))}
		</div>
	);
}

function FrameList({ frames, t }: { frames: DebugStackFrame[]; t: TranslateFn }) {
	if (frames.length === 0) {
		return <div className="px-3 py-4 text-center text-omp-sm text-(--omp-dim)">{t("debug.emptyFrames")}</div>;
	}
	return (
		<div className="flex flex-col gap-0.5">
			{frames.map((frame, index) => {
				const location = formatLocation(frame.sourcePath, frame.line, frame.column);
				return (
					<div
						className="flex items-baseline gap-2 rounded-md px-2 py-1 hover:bg-(--omp-bg-secondary)"
						key={frame.id}
					>
						<span className="w-7 shrink-0 text-right font-mono text-omp-sm text-(--omp-dim)">#{index}</span>
						<span className="min-w-0 break-all font-mono text-omp-md text-(--omp-text)">{frame.name}</span>
						{location ? (
							<span className="ml-auto shrink-0 font-mono text-omp-sm text-(--omp-dim)">{location}</span>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

/** Localized outcome sentence for execution actions, derived from details.state/timedOut. */
function outcomeFor(
	action: RpcDebugAction,
	details: Record<string, unknown> | undefined,
	snapshot: DebugSessionSummary,
	t: TranslateFn,
): string | null {
	switch (action) {
		case "pause":
			return t("debug.outcome.paused");
		case "terminate":
			return t("debug.outcome.sessionTerminated");
		case "continue":
		case "step_over":
		case "step_in":
		case "step_out": {
			if (details?.timedOut === true) return t("debug.outcome.timeout");
			const state = asString(details?.state);
			if (state === "stopped") {
				const location = summaryLocation(snapshot);
				return location ? t("debug.outcome.stopped", { location }) : t("debug.outcome.stoppedGeneric");
			}
			if (state === "terminated") return t("debug.outcome.terminated");
			if (state === "running") return t("debug.outcome.running");
			return null;
		}
		default:
			return null;
	}
}

function SnapshotCard({
	snapshot,
	outcome,
	t,
}: {
	snapshot: DebugSessionSummary;
	outcome: string | null;
	t: TranslateFn;
}) {
	const location = summaryLocation(snapshot);
	const frame = [snapshot.frameName, location].filter((part): part is string => Boolean(part)).join(" @ ");
	return (
		<div className="flex flex-col gap-1.5 rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2.5">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-mono text-omp-md font-medium text-(--omp-text)">{snapshot.adapter}</span>
				<StatusBadge status={snapshot.status} t={t} />
				<span className="ml-auto font-mono text-omp-xs text-(--omp-dim)">{snapshot.id}</span>
			</div>
			{outcome ? <div className="text-omp-md text-(--omp-text)">{outcome}</div> : null}
			<div className="flex flex-col gap-0.5 text-omp-sm text-(--omp-dim)">
				{snapshot.program ? <MetaRow label={t("debug.meta.program")} mono value={snapshot.program} /> : null}
				{snapshot.stopReason ? <MetaRow label={t("debug.meta.stopReason")} value={snapshot.stopReason} /> : null}
				{frame ? <MetaRow label={t("debug.meta.location")} mono value={frame} /> : null}
				{snapshot.exitCode !== undefined ? (
					<MetaRow label={t("debug.meta.exitCode")} value={String(snapshot.exitCode)} />
				) : null}
			</div>
		</div>
	);
}

const SCROLLBACK_CLASS =
	"max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg font-mono text-omp-sm leading-relaxed text-(--omp-text)";

function ResultBody({ result, t }: { result: DebugResultData; t: TranslateFn }) {
	const details = resultDetails(result.data);
	const snapshot = asSummary(details?.snapshot);
	switch (result.action) {
		case "threads": {
			const threads = asThreads(details?.threads);
			if (threads) return <ThreadsTable snapshot={snapshot} t={t} threads={threads} />;
			break;
		}
		case "stack_trace": {
			const frames = asFrames(details?.stackFrames);
			if (frames) return <FrameList frames={frames} t={t} />;
			break;
		}
		case "output": {
			const output = asString(details?.output) ?? resultText(result.data);
			if (output) return <pre className={SCROLLBACK_CLASS}>{output}</pre>;
			return <div className="px-3 py-4 text-center text-omp-sm text-(--omp-dim)">{t("debug.noOutput")}</div>;
		}
		case "continue":
		case "step_over":
		case "step_in":
		case "step_out":
		case "pause":
		case "terminate":
		case "launch":
		case "attach": {
			if (snapshot) {
				return <SnapshotCard outcome={outcomeFor(result.action, details, snapshot, t)} snapshot={snapshot} t={t} />;
			}
			break;
		}
		default:
			break;
	}
	const text = resultText(result.data);
	if (text) return <pre className={SCROLLBACK_CLASS}>{text}</pre>;
	return <div className="px-3 py-4 text-center text-omp-sm text-(--omp-dim)">{t("debug.noResult")}</div>;
}

export function DebugConsoleDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const open = useUiStore(state => state.debugOpen);
	const close = useUiStore(state => state.closeDebug);
	const [sessions, setSessions] = useState<DebugSessionSummary[] | null>(null);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
	const [result, setResult] = useState<DebugResultData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(0);
	const [request, setRequest] = useState('{\n  "action": "sessions"\n}');
	const [advancedOpen, setAdvancedOpen] = useState(false);

	const execDebug = useCallback(
		async (params: RpcDebugParams): Promise<unknown> => {
			if (!sidecarReady) throw new Error(t("common.notConnected"));
			setPending(value => value + 1);
			try {
				const response = await tabRpc.debug(params);
				if (!response.success) throw new Error(response.error);
				return response.data;
			} finally {
				setPending(value => Math.max(0, value - 1));
			}
		},
		[sidecarReady, t, tabRpc.debug],
	);

	const refreshSessions = useCallback(async () => {
		setSessionsError(null);
		try {
			const data = await execDebug({ action: "sessions" });
			const list = asSessions(resultDetails(data)?.sessions);
			setSessions(list);
			setActiveSessionId(previous => pickActiveSession(list, previous));
			setSelectedSessionId(previous =>
				previous && list.some(session => session.id === previous) ? previous : pickActiveSession(list, null),
			);
		} catch (cause) {
			setSessionsError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [execDebug]);

	useEffect(() => {
		if (open) void refreshSessions();
	}, [open, refreshSessions]);

	const runAction = async (params: RpcDebugParams) => {
		setError(null);
		setRequest(JSON.stringify(params, null, 2));
		try {
			const data = await execDebug(params);
			setResult({ action: params.action, data });
			const snapshot = asSummary(resultDetails(data)?.snapshot);
			if (snapshot) {
				setActiveSessionId(snapshot.id);
				setSelectedSessionId(snapshot.id);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
		if (!READONLY_ACTIONS[params.action]) await refreshSessions();
	};

	const runRaw = async () => {
		setError(null);
		let parsed: RpcDebugParams;
		try {
			const value: unknown = JSON.parse(request);
			const action = asRecord(value)?.action;
			if (typeof action !== "string") throw new Error(t("debug.actionRequired"));
			parsed = value as RpcDebugParams;
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			return;
		}
		await runAction(parsed);
	};

	const fillExample = (example: RpcDebugParams) => {
		setRequest(JSON.stringify(example, null, 2));
		setAdvancedOpen(true);
	};

	const activeSession = sessions?.find(session => session.id === activeSessionId);

	return (
		<Modal onClose={close} open={open} size="lg" title={t("debug.title")}>
			<div className="flex flex-col gap-4">
				<section>
					<div className="mb-1 flex items-center justify-between">
						<span className="text-xs font-medium text-(--omp-text)">{t("debug.sessions")}</span>
						<Button
							disabled={!sidecarReady || pending > 0}
							icon={<RefreshCw size={12} />}
							onClick={() => void refreshSessions()}
							size="sm"
							variant="ghost"
							title={!sidecarReady ? t("common.notConnected") : undefined}
						>
							{t("debug.refresh")}
						</Button>
					</div>
					{sessions === null ? (
						sessionsError ? (
							<div className="flex flex-col items-center gap-2 rounded-lg border border-(--omp-border-muted) px-4 py-6 text-center">
								<span className="text-omp-sm break-all text-(--omp-error)">{sessionsError}</span>
								<Button
									disabled={!sidecarReady}
									icon={<RefreshCw size={12} />}
									onClick={() => void refreshSessions()}
									size="sm"
									variant="secondary"
									title={!sidecarReady ? t("common.notConnected") : undefined}
								>
									{t("debug.refresh")}
								</Button>
							</div>
						) : (
							<div className="flex items-center justify-center rounded-lg border border-(--omp-border-muted) px-4 py-6">
								<Spinner size="sm" />
							</div>
						)
					) : sessions.length === 0 ? (
						<div className="flex flex-col items-center gap-2 rounded-lg border border-(--omp-border-muted) px-4 py-6 text-center">
							<Bug className="text-(--omp-dim)" size={16} />
							<span className="text-omp-md font-medium text-(--omp-text)">{t("debug.noSessions")}</span>
							<span className="max-w-sm text-omp-sm text-(--omp-dim)">{t("debug.noSessionsHint")}</span>
							<div className="mt-1 flex flex-wrap justify-center gap-2">
								<Button
									icon={<Rocket size={12} />}
									onClick={() => fillExample(LAUNCH_EXAMPLE)}
									size="sm"
									variant="secondary"
								>
									{t("debug.fillLaunch")}
								</Button>
								<Button
									icon={<Plug size={12} />}
									onClick={() => fillExample(ATTACH_EXAMPLE)}
									size="sm"
									variant="secondary"
								>
									{t("debug.fillAttach")}
								</Button>
							</div>
						</div>
					) : (
						<div className="flex max-h-40 flex-col gap-1.5 overflow-auto">
							{sessionsError ? (
								<div className="rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-3 py-1.5 text-omp-sm text-(--omp-error)">
									{sessionsError}
								</div>
							) : null}
							{sessions.map(session => (
								<SessionRow
									active={session.id === activeSessionId}
									key={session.id}
									onSelect={() => setSelectedSessionId(session.id)}
									selected={session.id === selectedSessionId}
									session={session}
									t={t}
								/>
							))}
						</div>
					)}
				</section>

				<div className="flex flex-wrap gap-2">
					{ACTION_DEFS.map(def => (
						<Button
							disabled={!sidecarReady || pending > 0 || !def.enabled(activeSession)}
							icon={def.icon}
							key={def.action}
							onClick={() => void runAction({ action: def.action })}
							size="sm"
							variant={def.danger ? "danger" : "secondary"}
							title={!sidecarReady ? t("common.notConnected") : undefined}
						>
							{t(def.labelKey)}
						</Button>
					))}
				</div>

				{error ? (
					<div className="rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent p-3 text-sm text-(--omp-error)">
						{error}
					</div>
				) : null}

				<section>
					<div className="mb-1 flex items-center justify-between">
						<span className="text-xs font-medium text-(--omp-text)">{t("debug.result")}</span>
						{pending > 0 ? <Spinner label={t("debug.running")} size="sm" /> : null}
					</div>
					<div className="max-h-72 min-h-28 overflow-auto rounded-lg border border-(--omp-border-muted) bg-transparent p-3">
						{result ? (
							<ResultBody result={result} t={t} />
						) : (
							<div className="flex min-h-24 items-center justify-center text-omp-sm text-(--omp-dim)">
								{t("debug.noResult")}
							</div>
						)}
					</div>
				</section>

				<section className="rounded-lg border border-(--omp-border-muted)">
					<button
						className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-omp-md font-medium text-(--omp-muted) transition-colors hover:text-(--omp-text)"
						onClick={() => setAdvancedOpen(value => !value)}
						type="button"
					>
						{advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
						{t("debug.advanced")}
					</button>
					{advancedOpen ? (
						<div className="flex flex-col gap-3 border-t border-(--omp-border-muted) px-3 py-3">
							<div className="flex flex-wrap gap-2">
								{PRESETS.map(preset => (
									<Button
										disabled={!sidecarReady}
										key={preset.labelKey}
										onClick={() => void runAction(preset.params)}
										size="sm"
										variant="secondary"
										title={!sidecarReady ? t("common.notConnected") : undefined}
									>
										{t(preset.labelKey)}
									</Button>
								))}
							</div>
							<div>
								<label className="mb-1 block text-xs font-medium text-(--omp-text)" htmlFor="debug-request">
									{t("debug.request")}
								</label>
								<TextArea
									id="debug-request"
									mono
									onChange={event => setRequest(event.target.value)}
									rows={7}
									spellCheck={false}
									value={request}
								/>
							</div>
							<div className="flex items-center justify-end">
								<Button
									disabled={!sidecarReady || pending > 0}
									onClick={() => void runRaw()}
									title={!sidecarReady ? t("common.notConnected") : undefined}
								>
									<Bug size={14} /> {t("debug.run")}
								</Button>
							</div>
						</div>
					) : null}
				</section>
			</div>
		</Modal>
	);
}
