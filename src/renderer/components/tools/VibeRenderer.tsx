import { List, Rocket, Send, Skull, Tv } from "lucide-react";
import { cx, formatDuration, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useNowTick } from "../../lib/now-tick";
import { resultDetails } from "./result";
import type { ToolRendererProps } from "./ToolCard";

/**
 * Vibe tools (vibe_spawn/vibe_send/vibe_wait/vibe_kill/vibe_list): the
 * director's surface over persistent worker sessions. Mirrors the TUI
 * renderers (packages/coding-agent/src/tools/vibe.ts):
 * - spawn/send → composer-style frame: the typed message plus an ack footer
 *   (turn started job N / steered / queued).
 * - wait → the "TV wall": one live screen per watched worker plus
 *   settled/timeout meta.
 * - kill → cancelled-turn note.
 * - list → the session table.
 *
 * Wire shape: `{ content, details }` where details is `VibeToolDetails`:
 *   { op, screens: VibeScreenSnapshot[], spawned?, send?, wait?, killed? }
 */

type VibeOp = "spawn" | "send" | "wait" | "kill" | "list";

interface VibeScreen {
	id: string;
	cli?: string;
	state?: string;
	model?: string;
	turns: number;
	queued: number;
	turnStartedAt?: number;
	turnMessage?: string;
	currentTool?: string;
	currentToolArgs?: string;
	lastIntent?: string;
	trace: string[];
	outputTail: string[];
	lastActivity?: string;
}

interface VibeSettled {
	id: string;
	jobId?: string;
	status?: string;
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
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
	return asArray(value).filter((v): v is string => typeof v === "string");
}

function asScreen(value: unknown): VibeScreen | undefined {
	const r = asRecord(value);
	if (!r || typeof r.id !== "string") return undefined;
	return {
		id: r.id,
		cli: asString(r.cli),
		state: asString(r.state),
		model: asString(r.model),
		turns: asNumber(r.turns) ?? 0,
		queued: asNumber(r.queued) ?? 0,
		turnStartedAt: asNumber(r.turnStartedAt),
		turnMessage: asString(r.turnMessage),
		currentTool: asString(r.currentTool),
		currentToolArgs: asString(r.currentToolArgs),
		lastIntent: asString(r.lastIntent),
		trace: asStringArray(r.trace),
		outputTail: asStringArray(r.outputTail),
		lastActivity: asString(r.lastActivity),
	};
}

function asSettled(value: unknown): VibeSettled | undefined {
	const r = asRecord(value);
	if (!r || typeof r.id !== "string") return undefined;
	return { id: r.id, jobId: asString(r.jobId), status: asString(r.status) };
}

const STATE_COLOR: Record<string, string> = {
	running: "var(--omp-accent)",
	starting: "var(--omp-accent)",
	idle: "var(--omp-success)",
	dead: "var(--omp-dim)",
};

const SETTLED_COLOR: Record<string, string> = {
	completed: "var(--omp-success)",
	failed: "var(--omp-error)",
	cancelled: "var(--omp-warning)",
};

/** Locale key per session state; "running" reuses the shared subagent label. */
const STATE_LABEL_KEY: Record<string, string> = {
	running: "subagent.status.started",
	starting: "tools.vibe.state.starting",
	idle: "tools.vibe.state.idle",
	dead: "tools.vibe.state.dead",
};

/** Locale key per settled turn status, from the shared subagent labels. */
const SETTLED_LABEL_KEY: Record<string, string> = {
	completed: "subagent.status.completed",
	failed: "subagent.status.failed",
	cancelled: "subagent.status.cancelled",
};

function isLive(screen: VibeScreen): boolean {
	return screen.state === "running" || screen.state === "starting";
}

/** One-line preview of the message typed into the mini composer. */
function composerLines(message: string): string[] {
	const lines = message.split(/\r?\n/).filter(line => line.trim().length > 0);
	return lines.length > 0 ? lines : [""];
}

/** Cli flavor badge (`fast` / `good`) — proper nouns, never translated. */
function CliBadge({ cli, live }: { cli: string; live?: boolean }) {
	return (
		<span
			className="rounded px-1 py-px font-mono text-omp-xxs font-semibold"
			style={{
				background: live ? "var(--omp-accent)" : "var(--omp-success)",
				color: "var(--omp-btn-primary-text)",
				opacity: 0.9,
			}}
		>
			{cli}
		</span>
	);
}

/** Composer card for spawn/send: the typed message + ack footer. */
function ComposerCard({ message, ack, ackColor }: { message: string; ack: string; ackColor: string }) {
	const lines = composerLines(message);
	return (
		<div className="overflow-hidden rounded-md border border-[var(--omp-border-muted)]">
			<div className="max-h-32 overflow-auto bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-sm leading-[1.5]">
				{lines.map((line, i) => (
					<div key={i} className="flex gap-1.5">
						<span className="shrink-0 font-semibold text-[var(--omp-accent)]">{i === 0 ? ">" : " "}</span>
						<span className="whitespace-pre-wrap text-[var(--omp-tool-output)]">{line}</span>
					</div>
				))}
			</div>
			<div
				className="border-t border-[var(--omp-border-muted)] px-2 py-1 font-mono text-omp-xs font-medium"
				style={{ color: ackColor }}
			>
				{ack}
			</div>
		</div>
	);
}

const TRACE_CAP = 3;
const OUTPUT_CAP = 2;

/** One worker "TV": header + live tool trace + streamed text tail. */
function ScreenCard({ screen, now, settledStatus }: { screen: VibeScreen; now: number; settledStatus?: string }) {
	const t = useT();
	const live = isLive(screen);
	const stateColor = STATE_COLOR[screen.state ?? ""] ?? "var(--omp-dim)";
	const settledColor = settledStatus ? (SETTLED_COLOR[settledStatus] ?? "var(--omp-warning)") : undefined;
	const turnsLabel = `${screen.turns}t${screen.queued > 0 ? `+${screen.queued}q` : ""}`;
	const detail = screen.lastIntent ?? screen.currentToolArgs;
	const trace = screen.trace.slice(-TRACE_CAP);
	const output = screen.outputTail.slice(-OUTPUT_CAP).filter(line => line.trim().length > 0);

	return (
		<div className="overflow-hidden rounded-md border border-[var(--omp-border-muted)]">
			<div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--omp-border-muted)]/70 px-2 py-1 font-mono text-omp-xs">
				<span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: settledColor ?? stateColor }} />
				{screen.cli && <CliBadge cli={screen.cli} live={live} />}
				<span className={cx("font-semibold", live ? "text-[var(--omp-accent)]" : "text-[var(--omp-text)]")}>
					{screen.id}
				</span>
				<span style={{ color: settledColor ?? stateColor }}>
					{settledStatus
						? t(SETTLED_LABEL_KEY[settledStatus] ?? "subagent.status.cancelled")
						: t(STATE_LABEL_KEY[screen.state ?? ""] ?? "tools.vibe.state.starting")}
				</span>
				<span className="text-[var(--omp-dim)] tabular-nums">{turnsLabel}</span>
				{screen.turnStartedAt != null && live && (
					<span className="text-[var(--omp-dim)] tabular-nums">
						{formatDuration(Math.max(0, now - screen.turnStartedAt))}
					</span>
				)}
				{screen.model && <span className="truncate text-[var(--omp-dim)]">{screen.model}</span>}
			</div>
			<div className="bg-[var(--omp-code-bg)] px-2 py-1 font-mono text-omp-sm leading-[1.55]">
				{live ? (
					<>
						{screen.turnMessage && (
							<div className="flex gap-1.5">
								<span className="shrink-0 font-semibold text-[var(--omp-accent)]">&gt;</span>
								<span className="truncate text-[var(--omp-dim)]" title={screen.turnMessage}>
									{screen.turnMessage}
								</span>
							</div>
						)}
						{trace.map((line, i) => (
							<div key={i} className="flex gap-1.5">
								<span className="shrink-0 text-[var(--omp-dim)]">└</span>
								<span className="truncate text-[var(--omp-dim)]" title={line}>
									{line}
								</span>
							</div>
						))}
						{screen.currentTool ? (
							<div className="flex gap-1.5">
								<span className="shrink-0 text-[var(--omp-accent)]">└</span>
								<span
									className="truncate text-[var(--omp-muted)]"
									title={detail ? `${screen.currentTool}: ${detail}` : screen.currentTool}
								>
									{screen.currentTool}
									{detail && <span className="text-[var(--omp-dim)]">: {detail}</span>}
								</span>
							</div>
						) : (
							screen.lastIntent && (
								<div className="flex gap-1.5">
									<span className="shrink-0 text-[var(--omp-accent)]">└</span>
									<span className="truncate text-[var(--omp-muted)]" title={screen.lastIntent}>
										{screen.lastIntent}
									</span>
								</div>
							)
						)}
						{output.map((line, i) => (
							<div key={i} className="truncate pl-3 text-[var(--omp-muted)]" title={line}>
								{line}
							</div>
						))}
					</>
				) : (
					screen.lastActivity && (
						<div className="flex gap-1.5">
							<span className="shrink-0 text-[var(--omp-dim)]">└</span>
							<span className="truncate text-[var(--omp-muted)]" title={screen.lastActivity}>
								{screen.lastActivity}
							</span>
						</div>
					)
				)}
			</div>
			{settledStatus && (
				<div
					className="border-t border-[var(--omp-border-muted)] px-2 py-1 font-mono text-omp-xs font-medium"
					style={{ color: settledColor }}
				>
					{t("tools.vibe.turnSettled", {
						status: t(SETTLED_LABEL_KEY[settledStatus] ?? "subagent.status.cancelled"),
					})}
				</div>
			)}
		</div>
	);
}

/** vibe_list: the session table. */
function SessionTable({ screens }: { screens: VibeScreen[] }) {
	const t = useT();
	return (
		<div className="max-h-56 overflow-auto rounded bg-[var(--omp-code-bg)] px-2 py-1 font-mono text-omp-sm leading-[1.7]">
			{screens.map(screen => {
				const stateColor = STATE_COLOR[screen.state ?? ""] ?? "var(--omp-dim)";
				const turnsLabel = `${screen.turns}t${screen.queued > 0 ? `+${screen.queued}q` : ""}`;
				return (
					<div key={screen.id} className="flex items-center gap-2">
						<span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: stateColor }} />
						<span className="shrink-0 font-semibold text-[var(--omp-text)]">{screen.id}</span>
						{screen.cli && <CliBadge cli={screen.cli} live={isLive(screen)} />}
						<span className="shrink-0 text-omp-xs" style={{ color: stateColor }}>
							{t(STATE_LABEL_KEY[screen.state ?? ""] ?? "tools.vibe.state.starting")}
						</span>
						<span className="shrink-0 text-omp-xs text-[var(--omp-dim)] tabular-nums">{turnsLabel}</span>
						{screen.model && <span className="shrink-0 text-omp-xs text-[var(--omp-dim)]">{screen.model}</span>}
						{screen.lastActivity && (
							<span
								className="min-w-0 flex-1 truncate text-right text-omp-xs text-[var(--omp-muted)]"
								title={screen.lastActivity}
							>
								{screen.lastActivity}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}

function VibeView({ op, args, result, isError, isPartial, partialResult }: ToolRendererProps & { op: VibeOp }) {
	const t = useT();
	const effective = isPartial && partialResult != null ? partialResult : result;
	const details = resultDetails(effective);
	const text = resultText(effective);

	const screens = asArray(details?.screens)
		.map(asScreen)
		.filter((s): s is VibeScreen => s != null);
	const spawned = asRecord(details?.spawned);
	const send = asRecord(details?.send);
	const wait = asRecord(details?.wait);
	const killed = asRecord(details?.killed);
	const settled = asArray(wait?.settled)
		.map(asSettled)
		.filter((s): s is VibeSettled => s != null);
	const settledById = new Map(settled.map(entry => [entry.id, entry.status] as const));
	const waiting = wait?.waiting === true;
	const timedOut = wait?.timedOut === true;
	const runningCount = screens.filter(isLive).length;

	// Live wall screens carry turn elapsed times — tick once a second while any
	// worker is on air so the durations stay fresh between partial emissions.
	const now = useNowTick(runningCount > 0);

	const Icon = op === "spawn" ? Rocket : op === "send" ? Send : op === "kill" ? Skull : op === "list" ? List : Tv;

	const sessionArg = typeof args.session === "string" ? args.session : "";
	const sessionsArg = asStringArray(args.sessions);
	const describe = (() => {
		switch (op) {
			case "spawn": {
				const cli = typeof args.cli === "string" ? args.cli : "?";
				const name = typeof args.name === "string" ? args.name : null;
				return t("tools.vibe.call.spawn", { cli }) + (name ? ` · ${name}` : "");
			}
			case "send":
				return t("tools.vibe.call.send", { session: sessionArg || "?" });
			case "wait":
				return sessionsArg.length > 0
					? t("tools.vibe.call.waitOn", { sessions: sessionsArg.join(", ") })
					: t("tools.vibe.call.waitRunning");
			case "kill":
				return t("tools.vibe.call.kill", { session: sessionArg || "?" });
			case "list":
				return t("tools.vibe.call.list");
		}
	})();

	const composerOp = op === "spawn" || op === "send";
	const message = op === "spawn" ? asString(args.prompt) : asString(args.message);

	const ack = (() => {
		if (!composerOp) return null;
		// Errors and detail-less results fall back to the raw content text.
		if (isError || (!isPartial && details == null)) return null;
		if (isPartial) {
			return {
				text: op === "spawn" ? t("tools.vibe.booting") : t("tools.vibe.delivering"),
				color: "var(--omp-dim)",
			};
		}
		if (op === "spawn") {
			const jobId = asString(spawned?.jobId);
			return {
				text: jobId ? t("tools.vibe.turnStartedJob", { jobId }) : t("tools.vibe.turnStarted"),
				color: "var(--omp-success)",
			};
		}
		const mode = asString(send?.mode);
		const jobId = asString(send?.jobId);
		if (mode === "steered") return { text: t("tools.vibe.steered"), color: "var(--omp-success)" };
		if (mode === "queued") return { text: t("tools.vibe.queued"), color: "var(--omp-warning)" };
		return {
			text: jobId ? t("tools.vibe.turnStartedJob", { jobId }) : t("tools.vibe.turnStarted"),
			color: "var(--omp-success)",
		};
	})();

	const killedId = asString(killed?.id) ?? sessionArg;
	const cancelledTurn = killed?.cancelledTurn === true;

	const showWall = (op === "wait" || op === "list") && screens.length > 0;
	const hasStructured = composerOp ? ack != null : showWall || (op === "kill" && killed != null);

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<Icon size={12} className="shrink-0 text-[var(--omp-status-subagents)]" />
				<span className="font-semibold text-[var(--omp-text)]">vibe</span>
				<span className="min-w-0 truncate text-[var(--omp-muted)]" title={describe}>
					{describe}
				</span>
				{op === "wait" && waiting && !isError && (
					<span className="ml-auto shrink-0 text-omp-xs text-[var(--omp-accent)]">{t("tools.vibe.watching")}</span>
				)}
			</div>

			{composerOp && message != null && ack && (
				<ComposerCard message={message} ack={ack.text} ackColor={ack.color} />
			)}
			{composerOp && message == null && ack && (
				<div className="font-mono text-omp-xs font-medium" style={{ color: ack.color }}>
					{ack.text}
				</div>
			)}

			{op === "wait" && (runningCount > 0 || settled.length > 0 || timedOut) && (
				<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-omp-xs">
					{runningCount > 0 && (
						<span className="text-[var(--omp-accent)]">{t("tools.vibe.onAir", { count: runningCount })}</span>
					)}
					{settled.length > 0 && (
						<span className="text-[var(--omp-success)]">
							{t("tools.vibe.settled", { count: settled.length })}
						</span>
					)}
					{timedOut && <span className="text-[var(--omp-warning)]">{t("tools.vibe.timedOut")}</span>}
				</div>
			)}

			{op === "wait" && showWall && (
				<div className="flex max-h-72 flex-col gap-1.5 overflow-auto">
					{screens.map(screen => (
						<ScreenCard key={screen.id} now={now} screen={screen} settledStatus={settledById.get(screen.id)} />
					))}
				</div>
			)}

			{op === "wait" && !isPartial && text.trim() && (
				<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-sm leading-[1.45] text-[var(--omp-tool-output)]">
					{text}
				</pre>
			)}

			{op === "list" && showWall && <SessionTable screens={screens} />}

			{op === "kill" && killed != null && (
				<div className="flex flex-col gap-0.5">
					<div className="flex items-center gap-2 font-mono text-omp-sm">
						<span className="font-semibold text-[var(--omp-text)]">
							{t("tools.vibe.killed", { id: killedId || "?" })}
						</span>
						{cancelledTurn && (
							<span className="rounded bg-[var(--omp-warning)]/15 px-1 py-px text-omp-xxs font-semibold text-[var(--omp-warning)]">
								{t("tools.vibe.cancelledTurn")}
							</span>
						)}
					</div>
					{killedId && (
						<div className="font-mono text-omp-xs text-[var(--omp-dim)]">
							{t("tools.vibe.transcriptNote", { id: killedId })}
						</div>
					)}
				</div>
			)}

			{(!hasStructured || isError) && text && (
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

export function VibeSpawnRenderer(props: ToolRendererProps) {
	return <VibeView {...props} op="spawn" />;
}

export function VibeSendRenderer(props: ToolRendererProps) {
	return <VibeView {...props} op="send" />;
}

export function VibeWaitRenderer(props: ToolRendererProps) {
	return <VibeView {...props} op="wait" />;
}

export function VibeKillRenderer(props: ToolRendererProps) {
	return <VibeView {...props} op="kill" />;
}

export function VibeListRenderer(props: ToolRendererProps) {
	return <VibeView {...props} op="list" />;
}
