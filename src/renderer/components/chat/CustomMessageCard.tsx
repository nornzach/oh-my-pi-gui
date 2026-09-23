/**
 * Dedicated cards for custom/extension message types (TUI parity:
 * packages/coding-agent/src/modes/components/chat-transcript-builder.ts
 * `#appendCustomMessage` + modes/utils/transcript-render-helpers.ts).
 *
 * The TUI renders each of these customTypes as a purpose-built transcript
 * block; the GUI used to flatten them to a bare label. Each card here reads
 * the message `details`/content through the shared unwrappers
 * (`resultDetails`/`resultText`) so live and persisted payloads render alike.
 * `display: false` filtering stays in MessageBubble (same as the TUI).
 */
import {
	AlertTriangle,
	ArrowRightLeft,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Lightbulb,
	MessagesSquare,
	XCircle,
	Zap,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { AgentMessage } from "../../../shared/rpc-types";
import { cx, formatDuration, formatTimeAgo, headLines, resultDetails, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { Badge, type BadgeVariant } from "../common/Badge";
import { launchCompletionDaemons } from "./completion-events";

/** customTypes with a dedicated card (the TUI dispatch set). */
const CARD_TYPES: Record<string, true> = {
	advisor: true,
	"async-result": true,
	"launch-completion": true,
	"lsp-late-diagnostic": true,
	"skill-prompt": true,
	"collab-prompt": true,
	"irc:incoming": true,
	"irc:autoreply": true,
	"irc:relay": true,
	handoff: true,
};

/** Whether this customType renders as a dedicated card instead of the generic bubble. */
export function isCustomMessageCardType(customType: string | undefined): boolean {
	return customType != null && CARD_TYPES[customType] === true;
}

export function CustomMessageCard({ message, inProcess = false }: { message: AgentMessage; inProcess?: boolean }) {
	switch (message.customType) {
		case "advisor":
			return <AdvisorCard message={message} />;
		case "async-result":
			return <AsyncResultCard inProcess={inProcess} message={message} />;
		case "launch-completion":
			return <LaunchCompletionCard inProcess={inProcess} message={message} />;
		case "lsp-late-diagnostic":
			return <LateDiagnosticsCard message={message} />;
		case "skill-prompt":
			return <SkillCard message={message} />;
		case "collab-prompt":
			return <CollabCard message={message} />;
		case "irc:incoming":
		case "irc:autoreply":
		case "irc:relay":
			return <IrcCard message={message} />;
		case "handoff":
			return <HandoffCard message={message} />;
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const HEADER_CLASS =
	"mb-2 flex items-center gap-1.5 text-omp-xs font-bold uppercase tracking-[0.12em] text-[var(--omp-custom-msg-label)]";
const HEADER_META_CLASS = "font-medium normal-case tracking-normal text-[var(--omp-dim)]";

/** Card frame matching ContextBubble: rounded custom-message background on the chat gutter. */
function CardFrame({ children }: { children: ReactNode }) {
	return (
		<div className="omp-custom-turn omp-fade-up ps-(--omp-editorial-inset) pe-(--omp-editorial-edge) py-3">
			<div className="omp-transcript-content rounded-[10px] border border-[var(--omp-border-muted)] bg-[var(--omp-custom-msg-bg)] px-3.5 py-3 shadow-[var(--omp-shadow-sm)]">
				{children}
			</div>
		</div>
	);
}

/** Body text capped at `lines` with a "+N more lines" / "Show less" toggle. */
function CollapsibleText({ text, lines, className }: { text: string; lines: number; className?: string }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const { head, omitted } = headLines(text, lines);
	return (
		<div>
			<pre
				className={cx(
					"font-mono text-omp-sm leading-[1.55] break-words whitespace-pre-wrap text-[var(--omp-tool-output)]",
					!open && "max-h-60 overflow-hidden",
					open && "max-h-80 overflow-auto",
					className,
				)}
			>
				{open ? text : head}
			</pre>
			{omitted > 0 && (
				<button
					type="button"
					onClick={() => setOpen(v => !v)}
					className="omp-pressable mt-0.5 text-omp-xs font-medium text-[var(--omp-dim)] hover:text-[var(--omp-text)]"
				>
					{open
						? t("chat.custom.showLess")
						: t("chat.custom.moreLines", { count: omitted, plural: omitted === 1 ? "" : "s" })}
				</button>
			)}
		</div>
	);
}

function CompletionRows({ children, inProcess }: { children: ReactNode; inProcess: boolean }) {
	return (
		<div
			className={
				inProcess
					? "py-0.5"
					: "omp-custom-turn omp-fade-up ps-(--omp-editorial-inset) pe-(--omp-editorial-edge) py-2"
			}
		>
			<div className={cx("space-y-0.5", !inProcess && "omp-transcript-content")}>{children}</div>
		</div>
	);
}

function CompletionRow({
	failed,
	label,
	meta,
	output,
}: {
	failed?: boolean;
	label: string;
	meta?: string;
	output?: string;
}) {
	const Icon = failed === undefined ? Zap : failed ? XCircle : CheckCircle2;
	const content = (
		<>
			<Icon
				aria-hidden="true"
				className={cx(
					"shrink-0",
					failed === undefined
						? "text-[var(--omp-custom-msg-label)]"
						: failed
							? "text-[var(--omp-error)]"
							: "text-[var(--omp-success)]",
				)}
				size={13}
			/>
			<span className="min-w-0 truncate text-omp-md font-medium text-[var(--omp-text)]">{label}</span>
			{meta && <span className="min-w-0 truncate font-mono text-omp-xs text-[var(--omp-dim)]">{meta}</span>}
		</>
	);
	const rowClass = "flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left";
	if (!output) return <div className={rowClass}>{content}</div>;
	return (
		<details className="group">
			<summary className={cx("omp-pressable cursor-pointer list-none", rowClass)}>
				{content}
				<ChevronRight
					aria-hidden="true"
					className="omp-disclosure-chevron ml-auto shrink-0 text-[var(--omp-dim)] group-open:rotate-90"
					size={13}
				/>
			</summary>
			<div className="pb-2 pl-6">
				<CollapsibleText className="mt-0.5" lines={3} text={output} />
			</div>
		</details>
	);
}

// ---------------------------------------------------------------------------
// advisor — batch of advisor notes injected into the session
// ---------------------------------------------------------------------------

interface AdvisorNote {
	note: string;
	severity?: string;
	advisor?: string;
}

const COLLAPSED_NOTES = 3;

function advisorVariant(severity: string | undefined): BadgeVariant {
	switch (severity) {
		case "blocker":
			return "error";
		case "concern":
			return "warning";
		default:
			return "muted";
	}
}

function advisorRailColor(severity: string | undefined): string {
	switch (severity) {
		case "blocker":
			return "var(--omp-error)";
		case "concern":
			return "var(--omp-warning)";
		default:
			return "var(--omp-dim)";
	}
}

function AdvisorCard({ message }: { message: AgentMessage }) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const details = resultDetails(message);
	const notesValue = details?.notes;
	const notes: AdvisorNote[] = (Array.isArray(notesValue) ? notesValue : [])
		.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
		.map(entry => ({ note: str(entry.note) ?? "", severity: str(entry.severity), advisor: str(entry.advisor) }))
		.filter(entry => entry.note);

	const blockers = notes.filter(note => note.severity === "blocker").length;
	const shown = expanded ? notes : notes.slice(0, COLLAPSED_NOTES);
	const hidden = notes.length - shown.length;

	return (
		<CardFrame>
			<div className={HEADER_CLASS}>
				<Lightbulb size={12} />
				<span>{t("chat.custom.advisor")}</span>
				<span className={HEADER_META_CLASS}>
					{t("chat.custom.advisorNotes", { count: notes.length, plural: notes.length === 1 ? "" : "s" })}
					{blockers > 0 && (
						<span className="text-[var(--omp-error)]">
							{" "}
							· {t("chat.custom.blockers", { count: blockers, plural: blockers === 1 ? "" : "s" })}
						</span>
					)}
				</span>
			</div>
			<div className="space-y-2">
				{shown.map((note, i) => (
					<div
						key={i}
						className="flex items-start gap-2 border-l-2 pl-2.5"
						style={{ borderLeftColor: advisorRailColor(note.severity) }}
					>
						{note.severity && (
							<Badge variant={advisorVariant(note.severity)} className="mt-0.5">
								{note.severity}
							</Badge>
						)}
						<div className="min-w-0 flex-1 text-omp-md leading-[1.55] text-[var(--omp-text)]">
							{note.advisor && note.advisor !== "default" && (
								<span className="mr-1.5 font-mono text-omp-xs text-[var(--omp-dim)]">[{note.advisor}]</span>
							)}
							<span className="whitespace-pre-wrap">{note.note}</span>
						</div>
					</div>
				))}
				{hidden > 0 && (
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="omp-pressable border-l-2 border-[var(--omp-border-muted)] pl-2.5 text-omp-sm font-medium text-[var(--omp-dim)] hover:text-[var(--omp-text)]"
					>
						{t("chat.custom.moreNotes", { count: hidden, plural: hidden === 1 ? "" : "s" })}
					</button>
				)}
			</div>
		</CardFrame>
	);
}

// ---------------------------------------------------------------------------
// async-result — completed background bash/task job rows
// ---------------------------------------------------------------------------

interface AsyncJob {
	jobId?: string;
	type?: string;
	label?: string;
	durationMs?: number;
}

function asyncJobs(details: Record<string, unknown> | undefined): AsyncJob[] {
	const jobsValue = details?.jobs;
	if (!Array.isArray(jobsValue)) return [];
	return jobsValue
		.filter((job): job is Record<string, unknown> => typeof job === "object" && job !== null)
		.map(job => ({
			jobId: str(job.jobId),
			type: str(job.type),
			label: str(job.label),
			durationMs: num(job.durationMs),
		}));
}

/**
 * Recover each job's result text from the agent-facing message content (a
 * `<system-notice>` block; multi-job batches split on `── Job <id> ──`
 * section headers). Best-effort: jobs without a recoverable section just
 * render their status row.
 */
function asyncJobResults(content: string, jobs: AsyncJob[]): Map<string, string> {
	const results = new Map<string, string>();
	const body = content.replace(/<\/?system-notice\s*>/g, "").trim();
	if (!body) return results;
	const sectionRe = /^── Job (\S+)(?:\s+\([^)]*\))? ──\s*$/gm;
	const matches = [...body.matchAll(sectionRe)];
	if (matches.length > 0) {
		for (let i = 0; i < matches.length; i++) {
			const match = matches[i];
			const start = (match.index ?? 0) + match[0].length;
			const next = matches[i + 1];
			const end = next ? (next.index ?? body.length) : body.length;
			const text = body.slice(start, end).trim();
			if (text && match[1]) results.set(match[1], text);
		}
		return results;
	}
	// Single job: the first line is the notice sentence, the rest is the result.
	const firstBreak = body.indexOf("\n");
	const text = (firstBreak === -1 ? "" : body.slice(firstBreak + 1)).trim();
	const onlyId = jobs.length === 1 ? jobs[0].jobId : undefined;
	if (onlyId && text) results.set(onlyId, text);
	return results;
}

function AsyncResultCard({ message, inProcess }: { message: AgentMessage; inProcess: boolean }) {
	const t = useT();
	const jobs = asyncJobs(resultDetails(message));
	const results = asyncJobResults(resultText(message.content), jobs);

	// A batch without job rows must not invent one: the delivery text is the
	// only truthful summary left.
	if (jobs.length === 0) {
		return (
			<CompletionRows inProcess={inProcess}>
				<CompletionRow label={resultText(message.content) || t("chat.exec.finished")} />
			</CompletionRows>
		);
	}

	return (
		<CompletionRows inProcess={inProcess}>
			{jobs.map((job, index) => {
				const id = job.jobId ?? "unknown";
				const meta = [
					t("chat.custom.asyncDone"),
					`[${job.type ?? "job"}]`,
					job.label ? id : undefined,
					job.durationMs != null ? formatDuration(job.durationMs) : undefined,
				]
					.filter(Boolean)
					.join(" · ");
				return (
					<CompletionRow
						failed={false}
						key={job.jobId ?? index}
						label={job.label ?? id}
						meta={meta}
						output={job.jobId ? results.get(job.jobId) : undefined}
					/>
				);
			})}
		</CompletionRows>
	);
}

function LaunchCompletionCard({ message, inProcess }: { message: AgentMessage; inProcess: boolean }) {
	const t = useT();
	const daemons = launchCompletionDaemons(message);
	if (daemons.length === 0) {
		return (
			<CompletionRows inProcess={inProcess}>
				<CompletionRow label={resultText(message.content) || t("chat.exec.finished")} />
			</CompletionRows>
		);
	}
	return (
		<CompletionRows inProcess={inProcess}>
			{daemons.map(daemon => {
				const failed = daemon.state === "failed" || (daemon.exitCode !== undefined && daemon.exitCode !== 0);
				const duration =
					daemon.startedAt !== undefined && daemon.exitedAt !== undefined
						? formatDuration(daemon.exitedAt - daemon.startedAt)
						: undefined;
				const meta = [
					daemon.exitCode !== undefined ? t("chat.exec.exit", { code: daemon.exitCode }) : undefined,
					duration,
				]
					.filter(Boolean)
					.join(" · ");
				return <CompletionRow failed={failed} key={daemon.name} label={daemon.name} meta={meta} />;
			})}
		</CompletionRows>
	);
}

// ---------------------------------------------------------------------------
// lsp-late-diagnostic — diagnostics that arrived after edit/write returned
// ---------------------------------------------------------------------------

/** TUI diagnostic line format: `path:line:col [severity] [source]? message (code)?`. */
const DIAG_LINE_RE = /^(.+?):(\d+):(\d+)\s+\[(\w+)\]\s+(?:\[([^\]]+)\]\s+)?(.+?)(?:\s+\(([^)]+)\))?$/;
const COLLAPSED_DIAGS = 5;

interface DiagEntry {
	line: number;
	col: number;
	severity: string;
	source?: string;
	text: string;
	code?: string;
}

type DiagItem = { kind: "diag"; diag: DiagEntry } | { kind: "raw"; text: string };

interface DiagGroup {
	path?: string;
	items: DiagItem[];
}

function severityRank(severity: string): number {
	switch (severity) {
		case "error":
			return 0;
		case "warning":
			return 1;
		case "info":
			return 2;
		case "hint":
			return 3;
		default:
			return 4;
	}
}

function severityColor(severity: string): string {
	switch (severity) {
		case "error":
			return "var(--omp-error)";
		case "warning":
			return "var(--omp-warning)";
		case "info":
			return "var(--omp-link)";
		default:
			return "var(--omp-dim)";
	}
}

function diagGroups(details: Record<string, unknown> | undefined): DiagGroup[] {
	const filesValue = details?.files;
	const files = Array.isArray(filesValue) ? filesValue : [];
	const groups: DiagGroup[] = [];
	for (const file of files) {
		if (typeof file !== "object" || file === null) continue;
		const record = file as Record<string, unknown>;
		const messages = Array.isArray(record.messages) ? record.messages.filter(m => typeof m === "string") : [];
		if (messages.length === 0) continue;
		const diags: DiagEntry[] = [];
		const raws: string[] = [];
		for (const message of messages as string[]) {
			const match = message.match(DIAG_LINE_RE);
			if (!match) {
				raws.push(message);
				continue;
			}
			diags.push({
				line: Number.parseInt(match[2], 10),
				col: Number.parseInt(match[3], 10),
				severity: match[4],
				source: match[5],
				text: match[6],
				code: match[7],
			});
		}
		diags.sort(
			(a, b) =>
				severityRank(a.severity) - severityRank(b.severity) ||
				a.line - b.line ||
				a.col - b.col ||
				a.text.localeCompare(b.text),
		);
		const items: DiagItem[] = [
			...diags.map(diag => ({ kind: "diag", diag }) as DiagItem),
			...raws.map(text => ({ kind: "raw", text }) as DiagItem),
		];
		groups.push({ path: str(record.path), items });
	}
	return groups;
}

function LateDiagnosticsCard({ message }: { message: AgentMessage }) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const details = resultDetails(message);
	const filesValue = details?.files;
	const files = Array.isArray(filesValue) ? filesValue : [];
	const errored = files.some(
		file => typeof file === "object" && file !== null && (file as Record<string, unknown>).errored === true,
	);
	const summary = files
		.map(file =>
			typeof file === "object" && file !== null ? str((file as Record<string, unknown>).summary) : undefined,
		)
		.filter(Boolean)
		.join(", ");
	const groups = diagGroups(details);
	const total = groups.reduce((sum, group) => sum + group.items.length, 0);
	// TUI renders nothing when no diagnostics survived; keep that.
	if (total === 0) return null;

	let budget = expanded ? Number.POSITIVE_INFINITY : COLLAPSED_DIAGS;
	const rendered = groups
		.map(group => {
			const take = Math.max(0, Math.min(group.items.length, budget));
			budget -= take;
			return { path: group.path, items: group.items.slice(0, take) };
		})
		.filter(group => group.items.length > 0);
	const hidden = total - rendered.reduce((sum, group) => sum + group.items.length, 0);

	return (
		<CardFrame>
			<div className={HEADER_CLASS}>
				{errored ? (
					<XCircle size={12} className="text-[var(--omp-error)]" />
				) : (
					<AlertTriangle size={12} className="text-[var(--omp-warning)]" />
				)}
				<span>{t("chat.custom.lateDiagnostics")}</span>
				{summary && <span className={HEADER_META_CLASS}>({summary})</span>}
			</div>
			<div className="space-y-2">
				{rendered.map((group, gi) => (
					<div key={group.path ?? gi}>
						{group.path && (
							<div className="mb-0.5 font-mono text-omp-sm text-[var(--omp-status-path)]">{group.path}</div>
						)}
						{group.items.map((item, ii) =>
							item.kind === "raw" ? (
								<div
									key={ii}
									className="font-mono text-omp-sm leading-[1.55] break-words whitespace-pre-wrap text-[var(--omp-muted)]"
								>
									{item.text}
								</div>
							) : (
								<div key={ii} className="flex items-baseline gap-1.5 font-mono text-omp-sm leading-[1.55]">
									<span className="shrink-0 tabular-nums text-[var(--omp-dim)]">
										{item.diag.line}:{item.diag.col}
									</span>
									<span
										className="shrink-0 font-semibold"
										style={{ color: severityColor(item.diag.severity) }}
									>
										{item.diag.severity}
									</span>
									<span className="min-w-0 break-words text-[var(--omp-text)]">
										{item.diag.text}
										{item.diag.code && <span className="text-[var(--omp-dim)]"> ({item.diag.code})</span>}
										{item.diag.source && <span className="text-[var(--omp-dim)]"> [{item.diag.source}]</span>}
									</span>
								</div>
							),
						)}
					</div>
				))}
				{hidden > 0 && (
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="omp-pressable text-omp-xs font-medium text-[var(--omp-dim)] hover:text-[var(--omp-text)]"
					>
						{t("chat.custom.moreDiagnostics", { count: hidden, plural: hidden === 1 ? "" : "s" })}
					</button>
				)}
			</div>
		</CardFrame>
	);
}

// ---------------------------------------------------------------------------
// skill-prompt — a skill invocation rendered as a distinct card
// ---------------------------------------------------------------------------

function SkillCard({ message }: { message: AgentMessage }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const details = resultDetails(message);
	const name = str(details?.name) ?? "unknown";
	// Collapse args to one line: a stray newline/tab would split the header.
	const args = str(details?.args)?.replace(/\s+/g, " ");
	const path = str(details?.path);
	const lineCount = num(details?.lineCount);
	const text = resultText(message.content).trim();

	return (
		<CardFrame>
			<button
				type="button"
				onClick={() => text && setOpen(v => !v)}
				className={cx("flex w-full items-center gap-1.5 text-left", text && "cursor-pointer")}
			>
				<Zap size={12} className="shrink-0 text-[var(--omp-custom-msg-label)]" />
				<span className="text-omp-xs font-bold uppercase tracking-[0.12em] text-[var(--omp-custom-msg-label)]">
					{t("chat.custom.skill")}
				</span>
				<span className="shrink-0 text-omp-md font-semibold text-[var(--omp-text)]">{name}</span>
				{args && (
					<span className="min-w-0 flex-1 truncate font-mono text-omp-sm text-[var(--omp-dim)]">{args}</span>
				)}
				{text &&
					(open ? (
						<ChevronDown size={13} className="ml-auto shrink-0 text-[var(--omp-dim)]" />
					) : (
						<ChevronRight size={13} className="ml-auto shrink-0 text-[var(--omp-dim)]" />
					))}
			</button>
			{(path || lineCount != null) && (
				<div className="mt-1 flex items-center gap-1.5 font-mono text-omp-xs">
					{path && <span className="min-w-0 truncate text-[var(--omp-accent)]">{path}</span>}
					{path && lineCount != null && <span className="text-[var(--omp-dim)]">·</span>}
					{lineCount != null && (
						<span className="shrink-0 text-[var(--omp-muted)]">
							{t("chat.custom.skillLines", { count: lineCount, plural: lineCount === 1 ? "" : "s" })}
						</span>
					)}
				</div>
			)}
			{open && text && (
				<div className="omp-fade-in mt-2 border-t border-[var(--omp-border-muted)]/70 pt-2">
					<div className="mb-1 text-omp-xs font-bold uppercase tracking-[0.12em] text-[var(--omp-muted)]">
						{t("chat.custom.prompt")}
					</div>
					<MarkdownRenderer content={text} />
				</div>
			)}
		</CardFrame>
	);
}

// ---------------------------------------------------------------------------
// collab-prompt — guest prompt shown on every participant's transcript
// ---------------------------------------------------------------------------

function CollabCard({ message }: { message: AgentMessage }) {
	const from = str(resultDetails(message)?.from) ?? "guest";
	const text = resultText(message.content).trim();
	return (
		<div className="omp-fade-up ps-(--omp-editorial-inset) pe-(--omp-editorial-edge) py-3">
			<div className="omp-transcript-content rounded-xl border border-[var(--omp-user-msg-border)] bg-[var(--omp-user-msg-bg)] px-3.5 py-3 shadow-[var(--omp-shadow-sm)]">
				<div className="mb-1.5 text-omp-md font-bold text-[var(--omp-accent)]">«{from}» ›</div>
				{text && <MarkdownRenderer content={text} singleDollarTextMath={false} />}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// irc:incoming / irc:autoreply / irc:relay — live IRC traffic cards
// ---------------------------------------------------------------------------

function IrcCard({ message }: { message: AgentMessage }) {
	const t = useT();
	const details = resultDetails(message);
	const kind =
		message.customType === "irc:incoming"
			? "incoming"
			: message.customType === "irc:autoreply"
				? "autoreply"
				: "relay";
	const from = str(details?.from) ?? "?";
	const to = str(details?.to) ?? "?";
	const body = str(kind === "incoming" ? details?.message : details?.body) ?? "";
	const title = kind === "incoming" ? `IRC ← ${from}` : kind === "autoreply" ? `IRC → ${to}` : `IRC ${from} → ${to}`;
	// Relative age ("8m"); timestamp arrives as epoch ms or ISO.
	const age =
		message.timestamp == null
			? ""
			: formatTimeAgo(
					typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : message.timestamp,
				);

	return (
		<CardFrame>
			<div className="mb-1.5 flex items-center gap-1.5 text-omp-sm font-semibold text-[var(--omp-custom-msg-label)]">
				<MessagesSquare size={12} className="shrink-0" />
				<span className="min-w-0 truncate">{title}</span>
				{kind === "autoreply" && <Badge variant="muted">{t("chat.custom.ircAuto")}</Badge>}
				{str(details?.replyTo) && <Badge variant="muted">{t("chat.custom.ircReply")}</Badge>}
				{age && (
					<span className="ml-auto shrink-0 font-mono text-omp-xs font-normal text-[var(--omp-dim)]">{age}</span>
				)}
			</div>
			{body && <CollapsibleText text={body} lines={3} />}
		</CardFrame>
	);
}

// ---------------------------------------------------------------------------
// handoff — handoff context extracted from <handoff-context> tags
// ---------------------------------------------------------------------------

/** Pull the `<handoff-context>` document out of the raw message content. */
function extractHandoffDocument(text: string): string {
	const openTag = "<handoff-context>";
	const closeTag = "</handoff-context>";
	const openIndex = text.indexOf(openTag);
	if (openIndex === -1) return text.trim();
	const start = openIndex + openTag.length;
	const closeIndex = text.indexOf(closeTag, start);
	return (closeIndex === -1 ? text.slice(start) : text.slice(start, closeIndex)).trim();
}

function HandoffCard({ message }: { message: AgentMessage }) {
	const t = useT();
	const doc = extractHandoffDocument(resultText(message.content));
	return (
		<CardFrame>
			<div className={HEADER_CLASS}>
				<ArrowRightLeft size={12} />
				<span>{t("chat.custom.handoff")}</span>
			</div>
			<MarkdownRenderer content={doc || t("chat.custom.handoffEmpty")} />
		</CardFrame>
	);
}
