import { Terminal } from "lucide-react";
import { truncateMiddle } from "../../../shared/text";
import { OutputText } from "../../lib/ansi";
import { cx, extractImageDataUrls, formatBytes, resultText, sanitizeToolText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { PREVIEW_SCROLL_MD } from "../../lib/preview";
import { ResultImages } from "./ResultImages";
import { resultDetails } from "./result";
import type { ToolRendererProps } from "./ToolCard";

/**
 * Bash wire shape: `{ content: [{ type: "text", text }], details }` where
 * `details` is `BashToolDetails` (packages/coding-agent/src/tools/bash.ts):
 *   { meta?: { truncation?, minimized? }, timeoutSeconds?, requestedTimeoutSeconds?,
 *     timeoutDisabled?, wallTimeMs?, exitCode?, timedOut?, terminalId?,
 *     async?: { state, jobId } }
 * The text body carries the combined stdout/stderr stream plus LLM-facing
 * trailer notices (background / truncation / exit code / wall time / raw
 * artifact). Like the TUI, strip those notices and re-state them from
 * `details` as a stats line instead.
 */

interface BashParsed {
	output: string;
	exitCode: number | null;
	stats: string[];
	truncation: string | null;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * `git 120.4 KB → 3.2 KB`: the output minimizer's filter and the bytes it took
 * the output from and to (`meta.minimized`). The label is a short word from the
 * agent, but a rehydrated session or extension may carry any text, so it is
 * kept to one plain line with home paths shortened.
 */
function formatMinimized(minimized: Record<string, unknown> | undefined): string | null {
	const inputBytes = asNumber(minimized?.inputBytes);
	const outputBytes = asNumber(minimized?.outputBytes);
	if (typeof minimized?.filter !== "string" || inputBytes == null || outputBytes == null) return null;
	const label = sanitizeToolText(minimized.filter)
		.replace(/\/(?:Users|home)\/[^/\s]+/g, "~")
		.replace(/\s+/g, " ")
		.trim();
	return `${truncateMiddle(label, 40)} ${formatBytes(inputBytes)} → ${formatBytes(outputBytes)}`;
}

/**
 * Trailer notices the agent appends to the text body. Matched by anchored
 * regex rather than the exact mirror strings: the `details` block decides
 * WHETHER a notice exists (only strip when the wire carries the field), the
 * pattern tolerates rewording on the agent side. Wire append order (bash.ts
 * + enforceInlineByteCap + wrappedExecute): wall time first, then
 * intermediate notices (timeout clamp, pty, truncation), then the exit-code
 * line, then — when the inline byte cap spills — the
 * `[raw output: artifact://N]` footer, and finally wrappedExecute's
 * `[Showing …]` limit line OUTERMOST. Strip in reverse wire order so each
 * end-anchored match sees the real end of the text.
 */
const BACKGROUND_NOTICE_RE = /\n?Backgrounded as job [^\n]*; result will be delivered automatically\.\s*$/;
const EXIT_CODE_NOTICE_RE = /\n?Command exited with code -?\d+\s*$/;
const WALL_TIME_NOTICE_RE = /\n?Wall time: \d+(?:\.\d+)? seconds/;

function stripTrailer(text: string, re: RegExp): string {
	return text.replace(re, "").trimEnd();
}

/** Strip the LAST occurrence of a non-terminal notice (wall time). */
function stripLastOccurrence(text: string, re: RegExp): string {
	const matches = [...text.matchAll(new RegExp(re.source, "g"))];
	if (matches.length === 0) return text;
	const last = matches[matches.length - 1];
	const index = last.index ?? 0;
	return (text.slice(0, index) + text.slice(index + last[0].length)).trimEnd();
}

const RAW_ARTIFACT_RE = /\n?\[raw output: artifact:\/\/(\d+)\]\s*$/;
/** Trailing `[Showing …]` / limits notice line appended by wrappedExecute. */
const GENERATED_NOTICE_RE =
	/^\[(?:Showing .+|\d+ (?:matches|results) limit reached\. .+|Some lines truncated to .+)\]$/;

function stripGeneratedOutputNotice(text: string): string {
	const trimmed = text.trimEnd();
	const lineStart = trimmed.lastIndexOf("\n");
	const candidate = trimmed.slice(lineStart === -1 ? 0 : lineStart + 1);
	if (!GENERATED_NOTICE_RE.test(candidate)) return text;
	return trimmed.slice(0, lineStart === -1 ? 0 : lineStart).trimEnd();
}

function formatTruncation(truncation: Record<string, unknown>): string | null {
	const totalLines = asNumber(truncation.totalLines);
	const outputLines = asNumber(truncation.outputLines);
	const shownRange = truncation.shownRange as { start?: number; end?: number } | undefined;
	if (truncation.direction === "middle") {
		return totalLines != null && outputLines != null
			? `Showing ${outputLines} of ${totalLines} lines; middle elided`
			: "Middle of output elided";
	}
	if (shownRange && asNumber(shownRange.start) != null && asNumber(shownRange.end) != null && totalLines != null) {
		return `Showing lines ${shownRange.start}-${shownRange.end} of ${totalLines}`;
	}
	if (outputLines != null && totalLines != null) return `Showing ${outputLines} of ${totalLines} lines`;
	return null;
}

function parseBashResult(result: unknown, isError: boolean | undefined): BashParsed {
	const details = resultDetails(result);
	let text = resultText(result);

	const wallTimeMs = asNumber(details?.wallTimeMs);
	const exitCode = asNumber(details?.exitCode) ?? null;
	const timeoutSeconds = asNumber(details?.timeoutSeconds);
	const requestedTimeoutSeconds = asNumber(details?.requestedTimeoutSeconds);
	const timeoutDisabled = details?.timeoutDisabled === true;
	const asyncInfo =
		details?.async != null && typeof details.async === "object"
			? (details.async as { state?: unknown; jobId?: unknown })
			: undefined;
	const backgroundJobId = typeof asyncInfo?.jobId === "string" ? asyncInfo.jobId : undefined;
	const meta =
		details?.meta != null && typeof details.meta === "object" ? (details.meta as Record<string, unknown>) : undefined;
	const truncation =
		meta?.truncation != null && typeof meta.truncation === "object"
			? (meta.truncation as Record<string, unknown>)
			: undefined;

	// Strip trailer notices only when `details` confirms they were appended;
	// re-stated below from the structured fields instead. Reverse wire order:
	// wrappedExecute's notice, then the artifact footer, then the inner
	// background/exit/wall lines.
	if (meta) text = stripGeneratedOutputNotice(text);
	let artifactId =
		typeof details?.artifactId === "string"
			? details.artifactId
			: typeof truncation?.artifactId === "string"
				? truncation.artifactId
				: undefined;
	const artifactMatch = artifactId ? text.match(RAW_ARTIFACT_RE) : null;
	if (artifactMatch) {
		artifactId = artifactMatch[1];
		text = text.slice(0, artifactMatch.index).trimEnd();
	}
	if (asyncInfo?.state === "running" && backgroundJobId) {
		text = stripTrailer(text, BACKGROUND_NOTICE_RE);
	}
	if (exitCode != null) text = stripTrailer(text, EXIT_CODE_NOTICE_RE);
	if (wallTimeMs != null) text = stripLastOccurrence(text, WALL_TIME_NOTICE_RE);

	const stats: string[] = [];
	if (asyncInfo?.state === "running" && backgroundJobId) stats.push(`Backgrounded: ${backgroundJobId}`);
	if (wallTimeMs != null) stats.push(`Wall: ${(wallTimeMs / 1000).toFixed(2)}s`);
	if (timeoutDisabled) stats.push("Timeout: disabled");
	if (timeoutSeconds != null) {
		stats.push(
			requestedTimeoutSeconds != null && requestedTimeoutSeconds !== timeoutSeconds
				? `Timeout: ${timeoutSeconds}s (requested ${requestedTimeoutSeconds}s clamped)`
				: `Timeout: ${timeoutSeconds}s`,
		);
	}
	if (artifactId) stats.push(`Artifact: ${artifactId}`);
	const minimized = formatMinimized(
		meta?.minimized != null && typeof meta.minimized === "object"
			? (meta.minimized as Record<string, unknown>)
			: undefined,
	);
	if (minimized) stats.push(`Minimized: ${minimized}`);
	if (isError && exitCode != null) stats.push(`Exit: ${exitCode}`);

	return {
		output: text.trimEnd(),
		exitCode,
		stats,
		truncation: truncation ? formatTruncation(truncation) : null,
	};
}

/** Bash: command line, terminal-style output, exit-code badge, stats footer. */
export function BashRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const command = typeof args.command === "string" ? args.command : "";
	const effective = isPartial ? partialResult : result;
	const parsed = parseBashResult(effective, isError);
	const images = extractImageDataUrls(effective);
	const hasOutput = parsed.output.length > 0;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-start gap-1.5 rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-sm leading-[1.45]">
				<Terminal size={12} className="mt-0.5 shrink-0 text-[var(--omp-success)]" />
				<span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[var(--omp-text)]">$ {command}</span>
				{parsed.exitCode != null && (
					<span
						className={cx(
							"ml-1 shrink-0 rounded px-1 py-px text-omp-xxs font-semibold tabular-nums",
							parsed.exitCode === 0 && !isError
								? "bg-[var(--omp-success)]/15 text-[var(--omp-success)]"
								: "bg-[var(--omp-error)]/15 text-[var(--omp-error)]",
						)}
					>
						{t("tools.bash.exit", { code: parsed.exitCode })}
					</span>
				)}
				{isPartial && parsed.exitCode == null && (
					<span className="ml-1 shrink-0 text-omp-xs text-[var(--omp-accent)]">{t("tools.bash.running")}</span>
				)}
			</div>
			{hasOutput && (
				<div
					className={cx(
						"rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-sm leading-[1.5]",
						PREVIEW_SCROLL_MD,
					)}
				>
					<div className="whitespace-pre-wrap text-[var(--omp-tool-output)]">
						<OutputText text={parsed.output} />
					</div>
				</div>
			)}
			<ResultImages images={images} />
			{parsed.stats.length > 0 && (
				<div className="font-mono text-omp-xs text-[var(--omp-dim)]">[{parsed.stats.join(" | ")}]</div>
			)}
			{parsed.truncation && (
				<div className="font-mono text-omp-xs text-[var(--omp-warning)]">[{parsed.truncation}]</div>
			)}
			{isError && !hasOutput && <div className="text-omp-sm text-[var(--omp-error)]">{t("tools.bash.failed")}</div>}
		</div>
	);
}
