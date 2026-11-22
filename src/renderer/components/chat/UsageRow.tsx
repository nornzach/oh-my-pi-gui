import { ArrowDown, ArrowUp, Clock, DollarSign, Zap } from "lucide-react";
import { useDisplayPreference } from "../../lib/display-preferences";
import { formatDuration, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";

/** Below this the rate is nonsense (cached/instant responses yield absurd tok/s). */
const MIN_DURATION_MS = 100;

export interface MessageUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costTotal: number | undefined;
}

/**
 * The usage slice UsageRow renders: a full finalized assistant message or the
 * narrower ReadGroupUsage carried by a read-group card. AgentMessage satisfies
 * it via its index signature; read-group.ts builds the slice directly.
 */
export interface UsageSource {
	role?: string;
	usage?: unknown;
	model?: string;
	duration?: number;
	ttft?: number;
	timestamp?: string | number;
}

/**
 * Narrow the pi-ai `usage` payload that rides on finalized assistant messages
 * (absent on other roles). Returns null when nothing billable was recorded —
 * aborted/errored turns carry an all-zero usage block not worth a row.
 */
export function readUsage(message: UsageSource): MessageUsage | null {
	const usage = message.usage;
	if (usage == null || typeof usage !== "object") return null;
	const record = usage as Record<string, unknown>;
	const read = (key: string): number => {
		const value = record[key];
		return typeof value === "number" && Number.isFinite(value) ? value : 0;
	};
	const input = read("input");
	const output = read("output");
	const cacheRead = read("cacheRead");
	const cacheWrite = read("cacheWrite");
	let costTotal: number | undefined;
	const cost = record.cost;
	if (cost != null && typeof cost === "object") {
		const total = (cost as Record<string, unknown>).total;
		if (typeof total === "number" && Number.isFinite(total) && total > 0) costTotal = total;
	}
	if (input + output + cacheRead + cacheWrite <= 0 && costTotal === undefined) return null;
	return { input, output, cacheRead, cacheWrite, costTotal };
}

function formatCost(total: number): string {
	return `$${total >= 1 ? total.toFixed(2) : total.toPrecision(2)}`;
}

/** Output tok/s of a turn; null below the duration floor where the rate is nonsense. */
export function usageTokPerSec(output: number, durationMs: number): number | null {
	return durationMs > MIN_DURATION_MS && output > 0 ? (output / durationMs) * 1000 : null;
}

/**
 * Compact usage/cost footer under completed assistant messages (TUI
 * usage-row.ts parity): model, in/out tokens, cache reads, cost, wall-clock
 * duration, and throughput — only the segments the message actually carries.
 * Accepts a full AgentMessage or the narrower usage slice carried by a read
 * group card (read-group.ts ReadGroupUsage).
 */
export function UsageRow({ message }: { message: UsageSource }) {
	const t = useT();
	// Honors the shared `display.showTokenUsage` setting (schema default off) —
	// previously the GUI ignored it and always rendered usage.
	const showTokenUsage = useDisplayPreference("showTokenUsage");
	if (!showTokenUsage) return null;
	if (message.role !== "assistant") return null;
	const usage = readUsage(message);
	if (!usage) return null;

	const model = typeof message.model === "string" ? message.model : "";
	const durationMs = typeof message.duration === "number" && Number.isFinite(message.duration) ? message.duration : 0;
	const ttftMs = typeof message.ttft === "number" && Number.isFinite(message.ttft) ? message.ttft : 0;
	const totalInput = usage.input + usage.cacheWrite;
	const tokPerSec = usageTokPerSec(usage.output, durationMs) ?? 0;
	// Message time (TUI usage-row parity): the wire timestamp is an ISO string
	// or epoch ms; render a compact HH:MM.
	const timestampMs =
		typeof message.timestamp === "number"
			? message.timestamp
			: typeof message.timestamp === "string"
				? Date.parse(message.timestamp)
				: Number.NaN;
	const timeText = Number.isFinite(timestampMs)
		? (() => {
				const date = new Date(timestampMs);
				const hours = String(date.getHours()).padStart(2, "0");
				const minutes = String(date.getMinutes()).padStart(2, "0");
				return `${hours}:${minutes}`;
			})()
		: "";

	return (
		<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-omp-xs tabular-nums text-[var(--omp-dim)]">
			{model && <span className="font-mono">{model}</span>}
			<span
				className="flex items-center gap-1"
				title={t("chat.usage.inputTokens", { count: totalInput.toLocaleString() })}
			>
				<ArrowUp size={10} />
				{formatTokens(totalInput)}
			</span>
			<span
				className="flex items-center gap-1"
				title={t("chat.usage.outputTokens", { count: usage.output.toLocaleString() })}
			>
				<ArrowDown size={10} />
				{formatTokens(usage.output)}
			</span>
			{usage.cacheRead > 0 && (
				<span title={t("chat.usage.cachedTokens", { count: usage.cacheRead.toLocaleString() })}>
					{t("chat.usage.cached", { tokens: formatTokens(usage.cacheRead) })}
				</span>
			)}
			{usage.costTotal !== undefined && (
				<span className="flex items-center gap-1" title={t("chat.usage.cost")}>
					<DollarSign size={10} />
					{formatCost(usage.costTotal)}
				</span>
			)}
			{durationMs > 0 && (
				<span className="flex items-center gap-1" title={t("chat.usage.duration")}>
					<Clock size={10} />
					{formatDuration(durationMs)}
				</span>
			)}
			{ttftMs > 0 && <span title={t("chat.usage.ttft")}>TTFT {formatDuration(ttftMs)}</span>}
			{tokPerSec > 0 && (
				<span className="flex items-center gap-1" title={t("chat.usage.throughput")}>
					<Zap size={10} />
					{tokPerSec.toFixed(1)}/s
				</span>
			)}
			{timeText && <span title={t("chat.usage.time")}>{timeText}</span>}
		</div>
	);
}
