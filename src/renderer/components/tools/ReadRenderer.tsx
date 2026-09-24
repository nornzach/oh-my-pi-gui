import { FileText } from "lucide-react";
import {
	basename,
	dirname,
	extractImageDataUrl,
	headLines,
	languageFromPath,
	resultDetails,
	resultText,
} from "../../lib/format";
import { useT } from "../../lib/i18n";
import { PREVIEW_HEIGHT_LG, PREVIEW_SCROLL_LG, READ_PREVIEW_LINES } from "../../lib/preview";
import { CodeBlock } from "../chat/CodeBlock";
import { ProcReadRenderer } from "./CoordinationRenderer";
import { PathLink } from "./PathLink";
import type { ToolRendererProps } from "./ToolCard";

/**
 * File read: path header + syntax-highlighted preview. Prefers the sidecar's
 * structured `details.displayContent` (prefix-free text + real start line) so
 * ranged/hashline reads show correct gutter numbers instead of selector
 * prefixes; falls back to the model-facing result text for non-text kinds.
 */
interface ReadToolDetails {
	resolvedPath?: string;
	url?: string;
	finalUrl?: string;
	displayContent?: { text: string; startLine: number; lineNumbers?: Array<number | null> };
	proc?: unknown;
}

/** Strip a trailing read selector (`file.ts:50-100`, `db.sqlite:users`) for
 * display and language detection; drive letters (`C:/x`) stay intact. */
function stripReadSelector(path: string): string {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
	const index = path.lastIndexOf(":");
	return index > 1 ? path.slice(0, index) : path;
}

export function ReadRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const path = typeof args.path === "string" ? args.path : "";
	const effective = isPartial ? partialResult : result;
	const details = (resultDetails(effective) ?? {}) as ReadToolDetails;
	if (/^proc:\/\//i.test(path) || details.proc !== undefined) {
		return (
			<ProcReadRenderer
				args={args}
				id={path.replace(/^proc:\/\//i, "")}
				isError={isError}
				isPartial={isPartial}
				partialResult={partialResult}
				procDetails={details.proc}
				result={result}
			/>
		);
	}
	const structuredPath = details.resolvedPath ?? details.finalUrl ?? details.url;
	const basePath = typeof structuredPath === "string" && structuredPath ? structuredPath : stripReadSelector(path);
	const display = details.displayContent;
	const image = extractImageDataUrl(effective);
	const rawText = display?.text ?? resultText(effective);
	const { head, omitted } = headLines(rawText, READ_PREVIEW_LINES);

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<FileText size={12} className="shrink-0 text-[var(--omp-dim)]" />
				<PathLink path={basePath} className="truncate">
					<span className="text-[var(--omp-text)]">{basename(basePath)}</span>
					<span className="text-[var(--omp-dim)]"> {dirname(basePath)}</span>
				</PathLink>
			</div>
			{image ? (
				<img
					src={image}
					alt={path || t("tools.image.alt")}
					className={`${PREVIEW_HEIGHT_LG} rounded-md border border-[var(--omp-border-muted)] object-contain`}
				/>
			) : isError ? (
				<div
					className={`${PREVIEW_SCROLL_LG} whitespace-pre-wrap break-words rounded bg-[var(--omp-tool-error-bg)] px-2 py-1.5 font-mono text-omp-sm text-[var(--omp-error)]`}
				>
					{head || t("tools.read.empty")}
				</div>
			) : head ? (
				<>
					<CodeBlock
						code={head}
						language={languageFromPath(basePath)}
						showLanguage={false}
						maxHeightClass={PREVIEW_HEIGHT_LG}
						startLine={display?.startLine}
						lineNumbers={display?.lineNumbers?.slice(0, head.split("\n").length)}
					/>
					{omitted > 0 && (
						<div className="text-center font-mono text-omp-xs text-[var(--omp-dim)]">
							{t("tools.read.more", { count: omitted, plural: omitted === 1 ? "" : "s" })}
						</div>
					)}
				</>
			) : (
				<div className="text-omp-sm italic text-[var(--omp-dim)]">
					{isPartial ? t("tools.read.reading") : t("tools.read.empty")}
				</div>
			)}
		</div>
	);
}
