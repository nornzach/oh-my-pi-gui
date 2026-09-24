import {
	Ban,
	CheckCircle2,
	CircleAlert,
	CircleX,
	Clock3,
	Loader2,
	MessageCircle,
	SquareTerminal,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { AnsiText, hasAnsi } from "../../lib/ansi";
import { cx, formatDuration, resultDetails, resultText, sanitizeToolText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { PREVIEW_SCROLL_SM } from "../../lib/preview";
import type { ToolRendererProps } from "./ToolCard";

type JobStatus = "running" | "completed" | "failed" | "cancelled";

interface JobRow {
	id: string;
	type?: string;
	status: JobStatus;
	label?: string;
	durationMs?: number;
	exitCode?: number;
	resultText?: string;
	errorText?: string;
}

interface AgentRow {
	id: string;
	live: boolean;
	activity?: string;
	ageMs?: number;
}

interface DaemonRow {
	name: string;
	state?: string;
	pid?: number;
	startedAt?: number;
	exitedAt?: number;
	detached?: boolean;
	persist?: boolean;
}

interface MessageRow {
	from?: string;
	body?: string;
	ts?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value != null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asJob(value: unknown): JobRow | undefined {
	const row = asRecord(value);
	if (!row || typeof row.id !== "string") return undefined;
	const status = row.status;
	if (status !== "running" && status !== "completed" && status !== "failed" && status !== "cancelled")
		return undefined;
	return {
		id: row.id,
		type: asString(row.type),
		status,
		label: asString(row.label),
		durationMs: typeof row.durationMs === "number" ? Math.max(0, row.durationMs) : undefined,
		exitCode: typeof row.exitCode === "number" ? row.exitCode : undefined,
		resultText: asString(row.resultText),
		errorText: asString(row.errorText),
	};
}

function asJobs(value: unknown): JobRow[] {
	return asArray(value)
		.map(asJob)
		.filter((job): job is JobRow => job !== undefined);
}

function asAgent(value: unknown): AgentRow | undefined {
	const row = asRecord(value);
	if (!row || typeof row.id !== "string") return undefined;
	return {
		id: row.id,
		live: row.live !== false,
		activity: asString(row.activity),
		ageMs: typeof row.ageMs === "number" ? Math.max(0, row.ageMs) : undefined,
	};
}

function asAgents(value: unknown): AgentRow[] {
	return asArray(value)
		.map(asAgent)
		.filter((agent): agent is AgentRow => agent !== undefined);
}

function asDaemon(value: unknown): DaemonRow | undefined {
	const row = asRecord(value);
	if (!row || typeof row.name !== "string") return undefined;
	return {
		name: row.name,
		state: asString(row.state),
		pid: typeof row.pid === "number" ? row.pid : undefined,
		startedAt: typeof row.startedAt === "number" ? row.startedAt : undefined,
		exitedAt: typeof row.exitedAt === "number" ? row.exitedAt : undefined,
		detached: row.detached === true,
		persist: row.persist === true,
	};
}

function asDaemons(value: unknown): DaemonRow[] {
	return asArray(value)
		.map(asDaemon)
		.filter((daemon): daemon is DaemonRow => daemon !== undefined);
}

function asMessage(value: unknown): MessageRow | undefined {
	const row = asRecord(value);
	if (!row) return undefined;
	return { from: asString(row.from), body: asString(row.body), ts: typeof row.ts === "number" ? row.ts : undefined };
}

function statusColor(status: JobStatus): string {
	switch (status) {
		case "completed":
			return "var(--omp-success)";
		case "failed":
			return "var(--omp-error)";
		case "cancelled":
			return "var(--omp-warning)";
		case "running":
			return "var(--omp-accent)";
	}
}

function StatusIcon({ status }: { status: JobStatus }) {
	if (status === "running") return <Loader2 aria-hidden className="shrink-0 animate-spin" size={12} />;
	if (status === "completed") return <CheckCircle2 aria-hidden className="shrink-0" size={12} />;
	if (status === "failed") return <CircleX aria-hidden className="shrink-0" size={12} />;
	return <Ban aria-hidden className="shrink-0" size={12} />;
}

function statusLabel(t: (key: string) => string, status: string): string {
	const key = `tools.coordination.status.${status}`;
	const translated = t(key);
	return translated === key ? shortText(status, 80) : translated;
}

function shortText(value: string | undefined, max = 240): string {
	if (!value) return "";
	const clean = sanitizeToolText(value);
	return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function JobRowView({ job, t }: { job: JobRow; t: (key: string, params?: Record<string, string | number>) => string }) {
	return (
		<div className="flex min-w-0 items-center gap-2 py-1 font-mono text-omp-sm">
			<span className="shrink-0" style={{ color: statusColor(job.status) }}>
				<StatusIcon status={job.status} />
			</span>
			<span className="shrink-0 font-semibold text-[var(--omp-text)]">{shortText(job.id, 120)}</span>
			{job.type && <span className="shrink-0 text-omp-xs text-[var(--omp-dim)]">{shortText(job.type, 80)}</span>}
			{job.label && (
				<span className="min-w-0 flex-1 truncate text-[var(--omp-muted)]" title={shortText(job.label, 240)}>
					{shortText(job.label)}
				</span>
			)}
			<span className="shrink-0 text-omp-xs" style={{ color: statusColor(job.status) }}>
				{statusLabel(t, job.status)}
			</span>
			{job.durationMs !== undefined && (
				<span className="shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
					{formatDuration(job.durationMs)}
				</span>
			)}
			{job.exitCode !== undefined && (
				<span className="shrink-0 text-omp-xs text-[var(--omp-dim)]">
					{t("tools.coordination.exit", { code: job.exitCode })}
				</span>
			)}
		</div>
	);
}

function JobPreview({ job }: { job: JobRow }) {
	const text = job.errorText ?? job.resultText;
	if (!text) return null;
	const preview = shortText(text, 4_000);
	return (
		<pre
			className={cx(
				"mt-1 whitespace-pre-wrap break-words rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-xs leading-[1.45]",
				PREVIEW_SCROLL_SM,
			)}
		>
			{hasAnsi(preview) ? <AnsiText text={preview} /> : preview}
		</pre>
	);
}

function AgentRowView({
	agent,
	t,
}: {
	agent: AgentRow;
	t: (key: string, params?: Record<string, string | number>) => string;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2 py-1 font-mono text-omp-sm">
			<span
				className="h-1.5 w-1.5 shrink-0 rounded-full"
				style={{ background: agent.live ? "var(--omp-accent)" : "var(--omp-warning)" }}
			/>
			<span className="shrink-0 font-semibold text-[var(--omp-text)]">{shortText(agent.id, 120)}</span>
			{agent.activity && (
				<span className="min-w-0 flex-1 truncate text-[var(--omp-muted)]">{shortText(agent.activity)}</span>
			)}
			<span
				className="shrink-0 text-omp-xs"
				style={{ color: agent.live ? "var(--omp-accent)" : "var(--omp-warning)" }}
			>
				{agent.live ? t("tools.coordination.agentRunning") : t("tools.coordination.agentStale")}
			</span>
			{agent.ageMs !== undefined && (
				<span className="shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
					{formatDuration(agent.ageMs)}
				</span>
			)}
		</div>
	);
}

function DaemonRowView({
	daemon,
	t,
}: {
	daemon: DaemonRow;
	t: (key: string, params?: Record<string, string | number>) => string;
}) {
	const elapsed =
		daemon.startedAt !== undefined ? Math.max(0, (daemon.exitedAt ?? Date.now()) - daemon.startedAt) : undefined;
	return (
		<div className="flex min-w-0 items-center gap-2 py-1 font-mono text-omp-sm">
			<SquareTerminal aria-hidden className="shrink-0 text-[var(--omp-dim)]" size={12} />
			<span className="shrink-0 font-semibold text-[var(--omp-text)]">{shortText(daemon.name, 120)}</span>
			{daemon.state && (
				<span className="shrink-0 text-omp-xs text-[var(--omp-muted)]">{shortText(daemon.state, 80)}</span>
			)}
			{daemon.pid !== undefined && (
				<span className="shrink-0 text-omp-xs text-[var(--omp-dim)]">
					{t("tools.coordination.pid", { pid: daemon.pid })}
				</span>
			)}
			{elapsed !== undefined && (
				<span className="ml-auto shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
					{formatDuration(elapsed)}
				</span>
			)}
		</div>
	);
}

function Section({ children }: { children: ReactNode }) {
	return <div className="max-h-56 overflow-auto rounded bg-[var(--omp-code-bg)] px-2 py-1">{children}</div>;
}

/** Renderer for the upstream `wait` coordination tool. */
export function WaitRenderer({ result, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const effective = isPartial ? partialResult : result;
	const details = resultDetails(effective);
	const jobs = asJobs(details?.jobs);
	const agents = asAgents(details?.agents);
	const waited = asMessage(details?.waited);
	const cancelled = asArray(details?.cancelled)
		.map(value => asRecord(value))
		.filter((value): value is Record<string, unknown> => value !== undefined && typeof value.id === "string");
	const text = shortText(resultText(effective));
	const running = jobs.filter(job => job.status === "running").length;
	const failed = jobs.filter(job => job.status === "failed").length;
	const Icon = waited ? MessageCircle : running > 0 ? Clock3 : failed > 0 ? CircleAlert : CheckCircle2;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<Icon aria-hidden className="shrink-0 text-[var(--omp-status-subagents)]" size={12} />
				<span className="font-semibold text-[var(--omp-text)]">{t("tools.coordination.wait")}</span>
				{jobs.length > 0 && (
					<span className="text-omp-xs text-[var(--omp-dim)]">
						{t("tools.coordination.jobs", { count: jobs.length })}
					</span>
				)}
				{agents.length > 0 && (
					<span className="text-omp-xs text-[var(--omp-dim)]">
						{t("tools.coordination.agents", { count: agents.length })}
					</span>
				)}
				{isPartial && (
					<span className="ml-auto text-omp-xs text-[var(--omp-accent)]">{t("tools.coordination.waiting")}</span>
				)}
			</div>
			{waited && (
				<div className="rounded bg-[var(--omp-code-bg)] px-2 py-1.5 text-omp-sm">
					<div className="flex items-center gap-2 font-mono text-omp-xs text-[var(--omp-dim)]">
						<MessageCircle aria-hidden size={11} />
						{waited.from && (
							<span className="font-semibold text-[var(--omp-text)]">{shortText(waited.from, 120)}</span>
						)}
					</div>
					{waited.body && (
						<div className="mt-0.5 whitespace-pre-wrap text-[var(--omp-muted)]">
							{shortText(waited.body, 2_000)}
						</div>
					)}
				</div>
			)}
			{jobs.length > 0 && (
				<Section>
					{jobs.map(job => (
						<div key={job.id}>
							<JobRowView job={job} t={t} />
							<JobPreview job={job} />
						</div>
					))}
				</Section>
			)}
			{agents.length > 0 && (
				<Section>
					{agents.map(agent => (
						<AgentRowView agent={agent} key={agent.id} t={t} />
					))}
				</Section>
			)}
			{cancelled.length > 0 && (
				<Section>
					{cancelled.map(row => (
						<div className="flex items-center gap-2 py-1 font-mono text-omp-sm" key={String(row.id)}>
							<Ban aria-hidden className="text-[var(--omp-warning)]" size={12} />
							<span className="font-semibold text-[var(--omp-text)]">{shortText(String(row.id), 120)}</span>
							<span className="text-omp-xs text-[var(--omp-warning)]">
								{statusLabel(t, typeof row.status === "string" ? row.status : "cancelled")}
							</span>
						</div>
					))}
				</Section>
			)}
			{!waited && jobs.length === 0 && agents.length === 0 && cancelled.length === 0 && text && (
				<div className="whitespace-pre-wrap rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-xs text-[var(--omp-tool-output)]">
					{text}
				</div>
			)}
		</div>
	);
}

/** Renderer for `read proc://…` snapshots introduced by the upstream protocol. */
export function ProcReadRenderer({
	id,
	result,
	isError,
	isPartial,
	partialResult,
	procDetails,
}: ToolRendererProps & { id: string; procDetails?: unknown }) {
	const t = useT();
	const effective = isPartial ? partialResult : result;
	const proc = asRecord(procDetails);
	const job = asJob(proc?.job);
	const jobs = asJobs(proc?.jobs);
	const agents = asAgents(proc?.agents);
	const daemon = asDaemon(proc?.daemon);
	const daemons = asDaemons(proc?.daemons);
	const lines = asArray(proc?.terminalRows).filter((line): line is string => typeof line === "string");
	const procLog = asString(proc?.log);
	const log = procLog ?? resultText(effective);
	const daemonOutput = lines.length > 0 ? lines.join("\n") : log;
	const title = id ? `${t("tools.coordination.process")} ${shortText(id, 120)}` : t("tools.coordination.processes");
	const allJobs = job ? [job] : jobs;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<SquareTerminal aria-hidden className="shrink-0 text-[var(--omp-dim)]" size={12} />
				<span className="font-semibold text-[var(--omp-text)]">{title}</span>
				{daemon?.state && <span className="text-omp-xs text-[var(--omp-muted)]">{daemon.state}</span>}
				{isPartial && (
					<span className="ml-auto text-omp-xs text-[var(--omp-accent)]">{t("tools.coordination.reading")}</span>
				)}
			</div>
			{isError ? (
				<div className="whitespace-pre-wrap rounded bg-[var(--omp-tool-error-bg)] px-2 py-1.5 font-mono text-omp-xs text-[var(--omp-error)]">
					{shortText(resultText(effective), 4_000)}
				</div>
			) : null}
			{allJobs.length > 0 && (
				<Section>
					{allJobs.map(item => (
						<div key={item.id}>
							<JobRowView job={item} t={t} />
							<JobPreview job={item} />
						</div>
					))}
					{job && procLog && (
						<pre
							className={cx(
								"mt-1 whitespace-pre-wrap break-words border-t border-[var(--omp-border-muted)] pt-1 font-mono text-omp-xs text-[var(--omp-tool-output)]",
								PREVIEW_SCROLL_SM,
							)}
						>
							{shortText(procLog, 4_000)}
						</pre>
					)}
				</Section>
			)}
			{daemon && (
				<Section>
					<DaemonRowView daemon={daemon} t={t} />
					{daemonOutput && (
						<pre
							className={cx(
								"mt-1 whitespace-pre-wrap break-words border-t border-[var(--omp-border-muted)] pt-1 font-mono text-omp-xs text-[var(--omp-tool-output)]",
								PREVIEW_SCROLL_SM,
							)}
						>
							{shortText(daemonOutput, 4_000)}
						</pre>
					)}
				</Section>
			)}
			{daemons.length > 0 && (
				<Section>
					{daemons.map(item => (
						<DaemonRowView daemon={item} key={item.name} t={t} />
					))}
				</Section>
			)}
			{agents.length > 0 && (
				<Section>
					{agents.map(agent => (
						<AgentRowView agent={agent} key={agent.id} t={t} />
					))}
				</Section>
			)}
			{!isError && allJobs.length === 0 && !daemon && daemons.length === 0 && agents.length === 0 && log && (
				<pre
					className={cx(
						"whitespace-pre-wrap break-words rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-xs text-[var(--omp-tool-output)]",
						PREVIEW_SCROLL_SM,
					)}
				>
					{shortText(log, 4_000)}
				</pre>
			)}
		</div>
	);
}

/** Renderer for `write agent://…` peer messages and `write proc://…` controls. */
export function ProtocolWriteRenderer({
	target,
	content,
	result,
	isError,
	isPartial,
	partialResult,
}: ToolRendererProps & { target: string; content?: string }) {
	const t = useT();
	const effective = isPartial ? partialResult : result;
	const outer = resultDetails(effective);
	const isAgent = /^agent:\/\//i.test(target);
	const targetId = target.replace(/^agent:\/\//i, "").replace(/^proc:\/\//i, "");
	const action = targetId.endsWith("/kill") ? "kill" : targetId.endsWith("/mode") ? "mode" : "stdin";
	const id = targetId.replace(/\/(?:kill|mode)$/, "") || t("tools.coordination.processes");
	const protocolDetails = asRecord(outer?.[isAgent ? "message" : "proc"]);
	const daemon = asDaemon(protocolDetails?.daemon);
	const jobs = asJobs(protocolDetails?.jobs);
	const cancelled = asArray(protocolDetails?.cancelled)
		.map(value => asRecord(value))
		.filter((value): value is Record<string, unknown> => value !== undefined && typeof value.id === "string");
	const receipts = asArray(protocolDetails?.receipts)
		.map(value => asRecord(value))
		.filter((value): value is Record<string, unknown> => value !== undefined && typeof value.to === "string");
	const title = isAgent ? t("tools.coordination.message") : `${t("tools.coordination.process")} ${action}`;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				{isAgent ? (
					<MessageCircle aria-hidden className="shrink-0 text-[var(--omp-status-subagents)]" size={12} />
				) : (
					<SquareTerminal aria-hidden className="shrink-0 text-[var(--omp-dim)]" size={12} />
				)}
				<span className="font-semibold text-[var(--omp-text)]">{title}</span>
				<span className="min-w-0 truncate text-omp-xs text-[var(--omp-muted)]">
					{isAgent ? shortText(targetId, 120) : shortText(id, 120)}
				</span>
				{isPartial && <Loader2 aria-hidden className="ml-auto animate-spin text-[var(--omp-accent)]" size={12} />}
			</div>
			{content && (
				<div className="whitespace-pre-wrap rounded bg-[var(--omp-code-bg)] px-2 py-1.5 text-omp-sm text-[var(--omp-muted)]">
					{shortText(content, 2_000)}
				</div>
			)}
			{isError && (
				<div className="whitespace-pre-wrap rounded bg-[var(--omp-tool-error-bg)] px-2 py-1.5 font-mono text-omp-xs text-[var(--omp-error)]">
					{shortText(resultText(effective), 4_000)}
				</div>
			)}
			{daemon && (
				<Section>
					<DaemonRowView daemon={daemon} t={t} />
				</Section>
			)}
			{jobs.length > 0 && (
				<Section>
					{jobs.map(job => (
						<div key={job.id}>
							<JobRowView job={job} t={t} />
						</div>
					))}
				</Section>
			)}
			{cancelled.length > 0 && (
				<Section>
					{cancelled.map(row => (
						<div className="flex items-center gap-2 py-1 font-mono text-omp-sm" key={String(row.id)}>
							<Ban aria-hidden className="text-[var(--omp-warning)]" size={12} />
							<span className="font-semibold text-[var(--omp-text)]">{shortText(String(row.id), 120)}</span>
							<span className="text-omp-xs text-[var(--omp-warning)]">
								{statusLabel(t, typeof row.status === "string" ? row.status : "cancelled")}
							</span>
						</div>
					))}
				</Section>
			)}
			{receipts.length > 0 && (
				<Section>
					{receipts.map(row => (
						<div className="flex items-center gap-2 py-1 font-mono text-omp-sm" key={String(row.to)}>
							<Users aria-hidden className="text-[var(--omp-status-subagents)]" size={12} />
							<span className="text-[var(--omp-text)]">{shortText(String(row.to), 120)}</span>
							<span className="text-omp-xs text-[var(--omp-muted)]">
								{shortText(String(row.outcome ?? "sent"), 80)}
							</span>
						</div>
					))}
				</Section>
			)}
			{!isError &&
				!content &&
				!daemon &&
				jobs.length === 0 &&
				cancelled.length === 0 &&
				receipts.length === 0 &&
				resultText(effective) && (
					<div className="whitespace-pre-wrap rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-xs text-[var(--omp-tool-output)]">
						{shortText(resultText(effective), 4_000)}
					</div>
				)}
		</div>
	);
}
