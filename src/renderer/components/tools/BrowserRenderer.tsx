import { Globe } from "lucide-react";
import { extractImageDataUrl, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { ZoomableImage } from "../common/ImageViewer";
import type { ToolRendererProps } from "./ToolCard";

/** Browser automation: action description + screenshot thumbnail when present. */
export function BrowserRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const action = typeof args.action === "string" ? args.action : "";
	const url = typeof args.url === "string" ? args.url : "";
	const effective = isPartial ? partialResult : result;
	const screenshot = extractImageDataUrl(effective);
	const text = resultText(effective);

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<Globe size={12} className="shrink-0 text-[var(--omp-md-link)]" />
				{action && <span className="font-semibold text-[var(--omp-text)]">{action}</span>}
				{url && <span className="min-w-0 flex-1 truncate text-[var(--omp-md-link)]">{url}</span>}
			</div>
			{screenshot && (
				<ZoomableImage
					src={screenshot}
					alt={t("tools.browser.screenshotAlt")}
					className="max-h-56 rounded-md border border-[var(--omp-border-muted)] object-contain"
				/>
			)}
			{text && !screenshot && (
				<pre
					className={
						"max-h-40 overflow-auto whitespace-pre-wrap rounded px-2 py-1.5 font-mono text-omp-sm leading-[1.45] " +
						(isError
							? "bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)]"
							: "bg-[var(--omp-code-bg)] text-[var(--omp-tool-output)]")
					}
				>
					{text}
				</pre>
			)}
			{isPartial && !text && !screenshot && (
				<div className="text-omp-sm italic text-[var(--omp-accent)]">{t("tools.browser.navigating")}</div>
			)}
		</div>
	);
}
