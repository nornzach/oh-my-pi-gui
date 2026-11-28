import { Radio, Send, SquareTerminal, Users } from "lucide-react";
import { OutputText } from "../../lib/ansi";
import { cx, formatDuration, resultText } from "../../lib/format";
import { translate, useT } from "../../lib/i18n";
import { resultDetails } from "./result";
import type { ToolRendererProps } from "./ToolCard";

/**
 * Hub wire shape: `{ content: [{ type: "text", text }], details }` where
 * `details` is `HubDetails` (packages/coding-agent/src/tools/hub/types.ts) —
 * either `CoordinationDetails` (messaging/jobs):
 *   { op, from?, to?, receipts?, waited?, inbox?, peers?, jobs?, agents?, cancelled? }
 * or `LaunchToolDetails` (supervised processes):
 *   { op, daemon?, daemons?, terminalRows?, spec?, state?, cursor?, matched? }
 */

interface RosterPeer {
	id: string;
	agent?: string;
	state?: string;
	unread?: number;
	activity?: string;
}

interface JobRow {
	id: string;
	status?: string;
	label?: string;
	durationMs?: number;
}

interface Receipt {
	to: string;
	outcome?: string;
	error?: string;
}

interface HubMessage {
	from?: string;
	body?: string;
	ts?: number;
}

interface ProcRow {
	name: string;
	state?: string;
	pid?: number;
	exitCode?: number;
	restartCount?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value != null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function extractPeers(details: Record<string, unknown> | undefined): RosterPeer[] {
	const out: RosterPeer[] = [];
	for (const p of asArray(details?.peers)) {
		if (typeof p === "string") {
			out.push({ id: p });
			continue;
		}
		const pr = asRecord(p);
		if (!pr) continue;
		out.push({
			id:
				typeof pr.id === "string"
					? pr.id
					: typeof pr.displayName === "string"
						? pr.displayName
						: typeof pr.name === "string"
							? pr.name
							: "?",
			agent: typeof pr.kind === "string" ? pr.kind : typeof pr.agent === "string" ? pr.agent : undefined,
			state: typeof pr.status === "string" ? pr.status : typeof pr.state === "string" ? pr.state : undefined,
			unread: typeof pr.unread === "number" && pr.unread > 0 ? pr.unread : undefined,
			activity: typeof pr.activity === "string" ? pr.activity : undefined,
		});
		if (out.length >= 50) break;
	}
	return out;
}

function extractJobs(details: Record<string, unknown> | undefined): JobRow[] {
	const out: JobRow[] = [];
	for (const j of asArray(details?.jobs)) {
		const jr = asRecord(j);
		if (!jr || typeof jr.id !== "string") continue;
		out.push({
			id: jr.id,
			status: typeof jr.status === "string" ? jr.status : undefined,
			label: typeof jr.label === "string" ? jr.label : undefined,
			durationMs: typeof jr.durationMs === "number" ? jr.durationMs : undefined,
		});
		if (out.length >= 50) break;
	}
	for (const a of asArray(details?.agents)) {
		const ar = asRecord(a);
		if (!ar || typeof ar.id !== "string") continue;
		out.push({
			id: ar.id,
			status: ar.live === false ? "stale" : "running",
			label: typeof ar.activity === "string" ? ar.activity : undefined,
			durationMs: typeof ar.ageMs === "number" ? ar.ageMs : undefined,
		});
		if (out.length >= 50) break;
	}
	return out;
}

function extractReceipts(details: Record<string, unknown> | undefined): Receipt[] {
	const out: Receipt[] = [];
	for (const r of asArray(details?.receipts)) {
		const rr = asRecord(r);
		if (!rr || typeof rr.to !== "string") continue;
		out.push({
			to: rr.to,
			outcome: typeof rr.outcome === "string" ? rr.outcome : undefined,
			error: typeof rr.error === "string" ? rr.error : undefined,
		});
	}
	return out;
}

function extractCancelled(details: Record<string, unknown> | undefined): Array<{ id: string; status?: string }> {
	const out: Array<{ id: string; status?: string }> = [];
	for (const c of asArray(details?.cancelled)) {
		const cr = asRecord(c);
		if (!cr || typeof cr.id !== "string") continue;
		out.push({ id: cr.id, status: typeof cr.status === "string" ? cr.status : undefined });
	}
	return out;
}

function asMessage(value: unknown): HubMessage | undefined {
	const mr = asRecord(value);
	if (!mr) return undefined;
	return {
		from: typeof mr.from === "string" ? mr.from : undefined,
		body: typeof mr.body === "string" ? mr.body : undefined,
		ts: typeof mr.ts === "number" ? mr.ts : undefined,
	};
}

function extractProcs(details: Record<string, unknown> | undefined): ProcRow[] {
	const out: ProcRow[] = [];
	const push = (value: unknown): void => {
		const dr = asRecord(value);
		if (!dr || typeof dr.name !== "string") return;
		out.push({
			name: dr.name,
			state: typeof dr.state === "string" ? dr.state : undefined,
			pid: typeof dr.pid === "number" ? dr.pid : undefined,
			exitCode: typeof dr.exitCode === "number" ? dr.exitCode : undefined,
			restartCount: typeof dr.restartCount === "number" && dr.restartCount > 0 ? dr.restartCount : undefined,
		});
	};
	push(details?.daemon);
	for (const d of asArray(details?.daemons)) push(d);
	return out;
}

/** Launch details carry process state keys coordination results never define. */
function isLaunchDetails(details: Record<string, unknown>): boolean {
	return (
		"daemon" in details ||
		"daemons" in details ||
		"terminalRows" in details ||
		"spec" in details ||
		"state" in details ||
		"cursor" in details
	);
}

function messageAge(ts: number | undefined): string {
	if (!ts) return "";
	const seconds = Math.max(0, (Date.now() - ts) / 1000);
	return seconds < 45 ? translate("time.justNow") : formatDuration(Date.now() - ts);
}

const STATE_COLOR: Record<string, string> = {
	running: "var(--omp-success)",
	ready: "var(--omp-success)",
	completed: "var(--omp-dim)",
	exited: "var(--omp-dim)",
	idle: "var(--omp-dim)",
	parked: "var(--omp-warning)",
	starting: "var(--omp-accent)",
	stopping: "var(--omp-warning)",
	cancelled: "var(--omp-warning)",
	failed: "var(--omp-error)",
	stale: "var(--omp-warning)",
};

/** Hub: peer roster, job list, process list, or message log depending on the op. */
export function HubRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const stateLabel = (state: string): string => {
		const key = `tools.hub.state.${state}`;
		const label = t(key);
		return label === key ? state : label;
	};
	const op = typeof args.op === "string" ? args.op : "";
	const effective = isPartial ? partialResult : result;
	const details = resultDetails(effective);
	const launch = details != null && isLaunchDetails(details);
	const peers = launch ? [] : extractPeers(details);
	const jobs = launch ? [] : extractJobs(details);
	const receipts = launch ? [] : extractReceipts(details);
	const procs = extractProcs(details);
	const terminalRows = launch ? asArray(details?.terminalRows).filter((r): r is string => typeof r === "string") : [];
	// describe/wait payloads the card previously dropped entirely: a describe
	// without its spec showed nothing the call was made for, and a timed-out
	// wait rendered like a normal process row.
	const spec =
		launch && details?.spec != null && typeof details.spec === "object"
			? (details.spec as Record<string, unknown>)
			: null;
	const hubState = launch && typeof details?.state === "string" ? details.state : undefined;
	const timedOut = launch && details?.timedOut === true;
	const matched = launch && typeof details?.matched === "string" ? details.matched : undefined;
	const waited = launch ? undefined : asMessage(details?.waited);
	const inbox = launch
		? []
		: asArray(details?.inbox)
				.map(asMessage)
				.filter((m): m is HubMessage => m != null);
	const cancelled = launch ? [] : extractCancelled(details);
	const text = resultText(effective);
	const hasStructured =
		peers.length > 0 ||
		jobs.length > 0 ||
		receipts.length > 0 ||
		procs.length > 0 ||
		terminalRows.length > 0 ||
		spec != null ||
		hubState != null ||
		timedOut ||
		cancelled.length > 0 ||
		waited != null ||
		inbox.length > 0;

	const Icon =
		op === "send"
			? Send
			: op === "start" || op === "stop" || op === "restart"
				? SquareTerminal
				: op === "list"
					? Users
					: Radio;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<Icon size={12} className="shrink-0 text-[var(--omp-status-subagents)]" />
				<span className="font-semibold text-[var(--omp-text)]">{op || "hub"}</span>
				{typeof args.to === "string" && <span className="text-[var(--omp-md-link)]">→ {args.to}</span>}
				{typeof args.name === "string" && <span className="text-[var(--omp-status-path)]">{args.name}</span>}
				{hubState && (
					<span
						className="ml-auto shrink-0 text-omp-xs"
						style={{ color: STATE_COLOR[hubState] ?? "var(--omp-dim)" }}
					>
						{stateLabel(hubState)}
					</span>
				)}
				{timedOut && (
					<span className="ml-auto shrink-0 text-omp-xs text-[var(--omp-warning)]">{t("tools.hub.timedOut")}</span>
				)}
			</div>
			{spec && (
				<div className="rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-sm leading-[1.6] text-[var(--omp-tool-output)]">
					<div className="truncate">
						<span className="text-[var(--omp-dim)]">$ </span>
						{String(spec.application ?? "")} {asArray(spec.args).map(String).join(" ")}
					</div>
					{typeof spec.cwd === "string" && (
						<div className="truncate text-[var(--omp-dim)]">{t("tools.hub.cwd", { path: spec.cwd })}</div>
					)}
					<div className="text-[var(--omp-dim)]">
						{t("tools.hub.policy", {
							pty: t(spec.pty === true ? "settings.effect.on" : "settings.effect.off"),
							restart:
								spec.restart === "always"
									? t("tools.hub.restartAlways")
									: spec.restart === "on-failure"
										? t("tools.hub.restartFailed")
										: spec.restart == null || spec.restart === "no"
											? t("settings.effect.off")
											: String(spec.restart),
							persist: t(spec.persist === true ? "settings.effect.on" : "settings.effect.off"),
						})}
						{spec.detached === true && ` · ${t("tools.hub.detached")}`}
					</div>
				</div>
			)}
			{typeof args.message === "string" && args.message && (
				<div className="rounded-md bg-[var(--omp-code-bg)] px-2 py-1.5 text-omp-sm leading-[1.45] text-[var(--omp-muted)]">
					{args.message}
				</div>
			)}

			{receipts.length > 0 && (
				<div className="rounded bg-[var(--omp-code-bg)] px-2 py-1 font-mono text-omp-sm leading-[1.7]">
					{receipts.map(r => (
						<div key={r.to} className="flex items-center gap-2">
							<span
								className="h-1.5 w-1.5 shrink-0 rounded-full"
								style={{ background: r.outcome === "failed" ? "var(--omp-error)" : "var(--omp-success)" }}
							/>
							<span className="text-[var(--omp-md-link)]">→ {r.to}</span>
							<span className="text-[var(--omp-dim)]">{r.outcome ?? "sent"}</span>
							{r.error && <span className="truncate text-[var(--omp-error)]">{r.error}</span>}
						</div>
					))}
				</div>
			)}

			{waited && (
				<div className="rounded-md bg-[var(--omp-code-bg)] px-2 py-1.5">
					<div className="flex items-center gap-2 font-mono text-omp-xs text-[var(--omp-dim)]">
						{waited.from && <span className="font-semibold text-[var(--omp-text)]">{waited.from}</span>}
						{messageAge(waited.ts) && <span>{messageAge(waited.ts)}</span>}
					</div>
					{waited.body && (
						<div className="mt-0.5 text-omp-sm leading-[1.45] text-[var(--omp-muted)]">{waited.body}</div>
					)}
				</div>
			)}

			{inbox.length > 0 && (
				<div className="max-h-48 overflow-auto rounded bg-[var(--omp-code-bg)] px-2 py-1">
					{inbox.map((m, i) => (
						<div key={i} className="py-0.5">
							<span className="font-mono text-omp-xs font-semibold text-[var(--omp-text)]">{m.from ?? "?"}</span>
							{messageAge(m.ts) && (
								<span className="ml-2 font-mono text-omp-xs text-[var(--omp-dim)]">{messageAge(m.ts)}</span>
							)}
							{m.body && <div className="text-omp-sm leading-[1.45] text-[var(--omp-muted)]">{m.body}</div>}
						</div>
					))}
				</div>
			)}

			{peers.length > 0 && (
				<div className="max-h-48 overflow-auto rounded bg-[var(--omp-code-bg)] px-2 py-1 font-mono text-omp-sm leading-[1.7]">
					{peers.map(peer => (
						<div key={peer.id} className="flex items-center gap-2">
							<span
								className="h-1.5 w-1.5 shrink-0 rounded-full"
								style={{ background: STATE_COLOR[peer.state ?? ""] ?? "var(--omp-dim)" }}
							/>
							<span className="font-semibold text-[var(--omp-text)]">{peer.id}</span>
							{peer.agent && <span className="text-[var(--omp-dim)]">({peer.agent})</span>}
							{peer.unread != null && (
								<span className="rounded bg-[var(--omp-accent)]/15 px-1 py-px text-omp-xxs font-semibold text-[var(--omp-accent)]">
									{peer.unread}
								</span>
							)}
							{peer.state && (
								<span className="ml-auto text-omp-xs text-[var(--omp-dim)]">{stateLabel(peer.state)}</span>
							)}
						</div>
					))}
				</div>
			)}

			{jobs.length > 0 && (
				<div className="max-h-48 overflow-auto rounded bg-[var(--omp-code-bg)] px-2 py-1 font-mono text-omp-sm leading-[1.7]">
					{jobs.map(job => (
						<div key={job.id} className="flex items-center gap-2">
							<span
								className="h-1.5 w-1.5 shrink-0 rounded-full"
								style={{ background: STATE_COLOR[job.status ?? ""] ?? "var(--omp-dim)" }}
							/>
							<span className="shrink-0 font-semibold text-[var(--omp-text)]">{job.id}</span>
							{job.label && (
								<span className="min-w-0 flex-1 truncate text-[var(--omp-muted)]" title={job.label}>
									{job.label}
								</span>
							)}
							{job.status === "stale" && (
								<span className="ml-auto shrink-0 text-omp-xs text-[var(--omp-warning)]">
									{stateLabel(job.status)}
								</span>
							)}
							{job.durationMs != null && (
								<span className="shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
									{formatDuration(job.durationMs)}
								</span>
							)}
						</div>
					))}
				</div>
			)}

			{cancelled.length > 0 && (
				<div className="rounded bg-[var(--omp-code-bg)] px-2 py-1 font-mono text-omp-sm leading-[1.7]">
					{cancelled.map(c => (
						<div key={c.id} className="flex items-center gap-2">
							<span className="font-semibold text-[var(--omp-text)]">{c.id}</span>
							<span className="text-[var(--omp-dim)]">{stateLabel(c.status ?? "cancelled")}</span>
						</div>
					))}
				</div>
			)}

			{procs.length > 0 && (
				<div className="max-h-48 overflow-auto rounded bg-[var(--omp-code-bg)] px-2 py-1 font-mono text-omp-sm leading-[1.7]">
					{procs.map(proc => (
						<div key={proc.name} className="flex items-center gap-2">
							<span
								className="h-1.5 w-1.5 shrink-0 rounded-full"
								style={{ background: STATE_COLOR[proc.state ?? ""] ?? "var(--omp-dim)" }}
							/>
							<span className="font-semibold text-[var(--omp-text)]">{proc.name}</span>
							{proc.pid != null && (
								<span className="text-omp-xs text-[var(--omp-dim)]">
									{t("tools.hub.pid", { pid: proc.pid })}
								</span>
							)}
							{proc.exitCode != null && (
								<span className="text-omp-xs text-[var(--omp-dim)]">
									{t("tools.hub.exit", { code: proc.exitCode })}
								</span>
							)}
							{proc.restartCount != null && (
								<span className="text-omp-xs text-[var(--omp-dim)]">↻ {proc.restartCount}</span>
							)}
							{proc.state && (
								<span className="ml-auto text-omp-xs text-[var(--omp-dim)]">{stateLabel(proc.state)}</span>
							)}
						</div>
					))}
				</div>
			)}

			{matched && (
				<div className="font-mono text-omp-sm text-[var(--omp-success)]">
					{t("tools.hub.matched", { value: matched })}
				</div>
			)}

			{terminalRows.length > 0 && (
				<pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-sm leading-[1.45] text-[var(--omp-tool-output)]">
					<OutputText text={terminalRows.join("\n")} />
				</pre>
			)}

			{!hasStructured && text && (
				<pre
					className={cx(
						"max-h-40 overflow-auto whitespace-pre-wrap rounded px-2 py-1.5 font-mono text-omp-sm leading-[1.45]",
						isError
							? "bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)]"
							: "bg-[var(--omp-code-bg)] text-[var(--omp-tool-output)]",
					)}
				>
					{text}
				</pre>
			)}
		</div>
	);
}
