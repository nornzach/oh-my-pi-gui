import { ChevronDown, ChevronRight, FilePlus2 } from "lucide-react";
import { useState } from "react";
import { DiffView } from "../../lib/diff";
import { basename, cx, dirname, headLines, languageFromPath, resultDetails, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { PREVIEW_SCROLL_LG } from "../../lib/preview";
import { CodeBlock } from "../chat/CodeBlock";
import { ProtocolWriteRenderer } from "./CoordinationRenderer";
import { PathLink } from "./PathLink";
import type { ToolRendererProps } from "./ToolCard";

/** Added/removed line counts of a unified diff. Header lines (`+++ b/x`)
 * exist only before their file's first hunk — after that, `--- disabled` and
 * `+++i` are removed/added source lines, not headers to skip. */
function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	let sawHunk = false;
	for (const line of diff.split("\n")) {
		if (/^@@/.test(line)) {
			sawHunk = true;
			continue;
		}
		if (!sawHunk && /^(---|\+\+\+) \S/.test(line)) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

/**
 * File write: path header + collapsible preview. When the write overwrote an
 * existing file and the sidecar captured the pre-write content, the detail
 * view is the old→new diff (same format the edit tool emits); creates and
 * diff-less overwrites fall back to the written-content preview.
 */
/** Preview ceiling for diff-less write content (lines entered into the DOM). */
const WRITE_PREVIEW_LINES = 500;
export function WriteRenderer({ args, result, isError, isPartial, partialResult, interrupted }: ToolRendererProps) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : "";
	const content = typeof args.content === "string" ? args.content : "";
	if (/^(?:agent|proc):\/\//i.test(path)) {
		return (
			<ProtocolWriteRenderer
				args={args}
				content={content}
				interrupted={interrupted}
				isError={isError}
				isPartial={isPartial}
				partialResult={partialResult}
				result={result}
				target={path}
			/>
		);
	}
	const lineCount = content ? content.split("\n").length : 0;
	// Preview ceiling: the full written file must not enter the DOM — the
	// height class only clips after layout. Copy stays available via the file.
	const { head: previewContent, omitted: previewOmitted } = headLines(content, WRITE_PREVIEW_LINES);

	const details = resultDetails(result);
	const diff = typeof details?.diff === "string" && details.diff ? details.diff : null;
	const overwritten = details?.overwritten === true;
	const openPath = typeof details?.resolvedPath === "string" ? details.resolvedPath : path;
	const stats = diff ? diffStats(diff) : null;
	// Failed writes must surface the reason (permission/conflict), not a
	// success-style preview of the requested content.
	const errorText = isError ? headLines(resultText(result), WRITE_PREVIEW_LINES) : null;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<button
					type="button"
					onClick={() => setOpen(v => !v)}
					aria-expanded={open}
					className="flex shrink-0 items-center gap-1.5 transition-colors hover:text-[var(--omp-text)]"
				>
					{open ? (
						<ChevronDown size={12} className="shrink-0 text-[var(--omp-dim)]" />
					) : (
						<ChevronRight size={12} className="shrink-0 text-[var(--omp-dim)]" />
					)}
					<FilePlus2 size={12} className="shrink-0 text-[var(--omp-dim)]" />
				</button>
				<PathLink path={openPath} className="truncate">
					<span className="text-[var(--omp-text)]">{basename(path)}</span>
					<span className="text-[var(--omp-dim)]"> {dirname(path)}</span>
				</PathLink>
				<span className="ml-auto flex shrink-0 items-center gap-1.5 text-omp-xs text-[var(--omp-dim)]">
					{stats && (
						<span className="tabular-nums">
							<span className="text-[var(--omp-diff-added)]">+{stats.added}</span>{" "}
							<span className="text-[var(--omp-diff-removed)]">−{stats.removed}</span>
						</span>
					)}
					{overwritten && !diff && (
						<span className="text-[var(--omp-warning)]">{t("tools.write.overwritten")}</span>
					)}
					<span>{t("tools.write.lines", { count: lineCount, plural: lineCount === 1 ? "" : "s" })}</span>
				</span>
			</div>
			{open && isError && errorText?.head && (
				<div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--omp-error)]/35 bg-[var(--omp-error-dim)] px-3 py-2 font-mono text-omp-sm break-words whitespace-pre-wrap text-[var(--omp-error)]">
					{errorText.head}
				</div>
			)}
			{!isError && open && diff && (
				<DiffView diff={diff} filePath={path} className={cx("rounded", PREVIEW_SCROLL_LG)} />
			)}
			{!isError && open && !diff && content && (
				<CodeBlock
					code={previewContent}
					language={languageFromPath(path)}
					showLanguage={false}
					showCopy={false}
					maxHeightClass="max-h-72"
				/>
			)}
			{!isError && open && !diff && previewOmitted > 0 && (
				<div className="text-omp-xs text-[var(--omp-dim)]">
					{t("tools.read.more", { count: previewOmitted, plural: previewOmitted === 1 ? "" : "s" })}
				</div>
			)}
		</div>
	);
}
