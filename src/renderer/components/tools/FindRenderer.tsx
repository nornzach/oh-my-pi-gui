import { Search } from "lucide-react";
import { cx, headLines, resultDetails, resultText, sanitizeToolText, shortenPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import {
	GREP_PREVIEW_MATCHES,
	PREVIEW_SCROLL_MD,
	PREVIEW_SCROLL_SM,
	PREVIEW_TEXT_CHARS,
	READ_PREVIEW_LINES,
} from "../../lib/preview";
import { PathLink } from "./PathLink";
import type { ToolRendererProps } from "./ToolCard";

/** Display projection of pi-tui/tools/find's FindToolDetails, not grep's wire format. */
interface FindRange {
	start: number;
	end: number;
	p: number;
	snippet: string;
}

interface FindHit {
	rel: string;
	contentScore: number;
	ranges: FindRange[];
	linesSeen: number;
	truncated: boolean;
}

function isRange(value: unknown): value is FindRange {
	if (!value || typeof value !== "object") return false;
	const range = value as FindRange;
	return (
		Number.isSafeInteger(range.start) &&
		range.start > 0 &&
		Number.isSafeInteger(range.end) &&
		range.end >= range.start &&
		Number.isFinite(range.p) &&
		typeof range.snippet === "string"
	);
}

function isHit(value: unknown): value is FindHit {
	if (!value || typeof value !== "object") return false;
	const hit = value as FindHit;
	return typeof hit.rel === "string" && Number.isFinite(hit.contentScore) && Array.isArray(hit.ranges);
}

function previewText(text: string, lines = READ_PREVIEW_LINES): string {
	const capped = headLines(text, lines);
	const cleaned = headLines(sanitizeToolText(capped.head), lines);
	return cleaned.head + (capped.omitted || cleaned.omitted ? "…" : "");
}

/** Core emits cwd-relative paths, or absolute paths for searches outside cwd.
 * Never prepend args.path (the hit already contains that scope). Keep the
 * recorded cwd for history, rather than opening an unrelated current file.
 * Reject traversal/schemes/control bytes; opening still goes through PathLink's IPC.
 */
function hitPath(rel: string, cwd: unknown): string {
	if (/[\x00-\x1f\x7f]/.test(rel) || rel.split(/[\\/]/).includes("..")) return "";
	if (/^(?:[a-z]:[\\/]|\/)/i.test(rel)) return rel;
	if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) return "";
	return typeof cwd === "string" && /^(?:[a-z]:[\\/]|\/)/i.test(cwd) ? `${cwd}/${rel}` : rel;
}

/** Semantic search: ranked files and verified passages, plus text-only phase updates. */
export function FindRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const effective = isPartial ? partialResult : result;
	const details = resultDetails(effective);
	const query = typeof details?.query === "string" ? details.query : typeof args.query === "string" ? args.query : "";
	const scope =
		typeof details?.scopePath === "string" ? details.scopePath : typeof args.path === "string" ? args.path : "";
	const rawKeywords = details?.keywords ?? args.grep_keywords;
	const keywords = Array.isArray(rawKeywords)
		? rawKeywords.filter((value): value is string => typeof value === "string")
		: [];
	const stats =
		details?.stats && typeof details.stats === "object" ? (details.stats as Record<string, unknown>) : undefined;
	const failed = Boolean(
		isError || (effective && typeof effective === "object" && "isError" in effective && effective.isError),
	);
	const pending = !failed && (isPartial || result == null);
	const structured = Array.isArray(details?.hits);
	const hits = structured
		? (details.hits as unknown[]).filter(isHit).sort((a, b) => b.contentScore - a.contentScore)
		: [];
	const failures = Array.isArray(stats?.failures)
		? stats.failures.filter((value): value is string => typeof value === "string")
		: [];

	// One shared row AND character budget for the whole hit list, not per file.
	let rows = GREP_PREVIEW_MATCHES;
	let chars = PREVIEW_TEXT_CHARS;
	let clipped = false;
	const shown: Array<{ hit: FindHit; label: string; ranges: FindRange[] }> = [];
	for (const hit of hits) {
		if (rows <= 0 || chars <= 0) {
			clipped = true;
			break;
		}
		const label = shortenPath(previewText(hit.rel, 1)).slice(0, chars);
		chars -= label.length;
		rows--;
		const ranges: FindRange[] = [];
		for (const range of hit.ranges.filter(isRange).sort((a, b) => b.p - a.p || a.start - b.start)) {
			if (rows <= 0 || chars <= 0) {
				clipped = true;
				break;
			}
			const text = previewText(range.snippet, 1);
			const snippet = text.slice(0, chars);
			if (snippet.length < text.length) clipped = true;
			chars -= snippet.length;
			rows--;
			ranges.push({ ...range, snippet });
		}
		shown.push({ hit, label, ranges });
	}
	const text = previewText(resultText(effective));

	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<div className="flex min-w-0 items-center gap-1.5 font-mono text-omp-sm">
				<Search size={12} className="shrink-0 text-[var(--omp-dim)]" />
				<span className="min-w-0 flex-1 truncate text-[var(--omp-accent)]">{previewText(query, 1)}</span>
				<span className="shrink-0 text-omp-xs text-[var(--omp-dim)]">
					{failed
						? t("tools.find.failed")
						: pending
							? t("tools.grep.searching")
							: structured
								? t("tools.find.hits", { count: hits.length })
								: ""}
				</span>
			</div>
			{scope && (
				<div className="truncate font-mono text-omp-xs text-[var(--omp-dim)]">
					{t("tools.grep.scope", { scope: shortenPath(previewText(scope, 1)) })}
				</div>
			)}
			{keywords.length > 0 && (
				<div className="truncate font-mono text-omp-xs text-[var(--omp-dim)]">
					{t("tools.find.keywords", { keywords: previewText(keywords.join(", "), 1) })}
				</div>
			)}
			{!pending && !failed && structured && (
				<>
					<div className="flex flex-wrap gap-2 text-omp-xs text-[var(--omp-dim)]">
						{typeof stats?.filesRead === "number" && (
							<span>{t("tools.find.filesRead", { count: stats.filesRead })}</span>
						)}
						{typeof details?.threshold === "number" && (
							<span>{t("tools.find.threshold", { score: details.threshold.toFixed(2) })}</span>
						)}
					</div>
					{hits.length === 0 ? (
						<div className="text-omp-sm italic text-[var(--omp-dim)]">{t("tools.find.empty")}</div>
					) : (
						<ol
							className={cx(
								"rounded bg-[var(--omp-code-bg)] px-2 py-1 font-mono text-omp-sm",
								PREVIEW_SCROLL_MD,
							)}
						>
							{shown.map(({ hit, label, ranges }, index) => (
								<li key={index} className="py-1">
									<div className="flex items-center gap-2">
										<span className="shrink-0 tabular-nums text-[var(--omp-dim)]">{index + 1}.</span>
										<span
											title={t("tools.find.relevance")}
											className="shrink-0 tabular-nums text-[var(--omp-accent)]"
										>
											{hit.contentScore.toFixed(2)}
										</span>
										<PathLink
											path={hitPath(hit.rel, details?.cwd)}
											className="truncate text-[var(--omp-status-path)]"
										>
											{label}
										</PathLink>
									</div>
									{Number.isFinite(hit.linesSeen) && (
										<div className="text-omp-xs text-[var(--omp-dim)]">
											{t(hit.truncated ? "tools.find.partialCoverage" : "tools.find.coverage", {
												count: hit.linesSeen,
											})}
										</div>
									)}
									{ranges.map((range, rangeIndex) => (
										<div key={rangeIndex} className="flex min-w-0 gap-2 pl-4">
											<PathLink
												path={hitPath(hit.rel, details?.cwd)}
												className="shrink-0 text-[var(--omp-status-path)]"
											>
												:{range.start}
												{range.end !== range.start ? `–${range.end}` : ""}
											</PathLink>
											<span
												title={t("tools.find.relevance")}
												className="shrink-0 tabular-nums text-[var(--omp-dim)]"
											>
												{range.p.toFixed(2)}
											</span>
											<span className="min-w-0 truncate whitespace-pre text-[var(--omp-tool-output)]">
												{range.snippet}
											</span>
										</div>
									))}
								</li>
							))}
						</ol>
					)}
					{clipped && <div className="text-omp-xs text-[var(--omp-dim)]">{t("tools.find.previewTruncated")}</div>}
				</>
			)}
			{(pending || failed || !structured) && text && (
				<pre
					className={cx(
						"whitespace-pre-wrap break-words rounded px-2 py-1 font-mono text-omp-sm",
						failed
							? "bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)]"
							: "bg-[var(--omp-code-bg)] text-[var(--omp-tool-output)]",
						PREVIEW_SCROLL_SM,
					)}
				>
					{text}
				</pre>
			)}
			{!pending && !failed && !structured && !text && (
				<div className="text-omp-sm text-[var(--omp-dim)]">{t("tools.find.noResult")}</div>
			)}
			{!pending && !failed && typeof stats?.errors === "number" && stats.errors > 0 && (
				<div className="text-omp-xs text-[var(--omp-warning)]">
					{t("tools.find.errors", { count: stats.errors })}
				</div>
			)}
			{!pending && !failed && failures.length > 0 && (
				<pre
					className={cx(
						"whitespace-pre-wrap break-words font-mono text-omp-xs text-[var(--omp-warning)]",
						PREVIEW_SCROLL_SM,
					)}
				>
					{previewText(failures.join("\n"))}
				</pre>
			)}
		</div>
	);
}
