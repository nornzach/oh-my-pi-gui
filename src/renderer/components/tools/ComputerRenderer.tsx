import { Monitor } from "lucide-react";
import { extractImageDataUrl, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { ZoomableImage } from "../common/ImageViewer";
import type { ToolRendererProps } from "./ToolCard";

/** Computer use: action description + screenshot. */
export function ComputerRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const action = typeof args.action === "string" ? args.action : "";
	const coordinate = Array.isArray(args.coordinate) ? (args.coordinate as number[]).join(", ") : "";
	const text = typeof args.text === "string" ? args.text : "";
	const effective = isPartial ? partialResult : result;
	const screenshot = extractImageDataUrl(effective);
	const output = resultText(effective);

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<Monitor size={12} className="shrink-0 text-[var(--omp-status-path)]" />
				{action && <span className="font-semibold text-[var(--omp-text)]">{action}</span>}
				{coordinate && <span className="text-[var(--omp-dim)]">({coordinate})</span>}
				{text && <span className="min-w-0 flex-1 truncate text-[var(--omp-muted)]">“{text}”</span>}
			</div>
			{screenshot && (
				<ZoomableImage
					src={screenshot}
					alt={t("tools.computer.captureAlt")}
					className="max-h-64 rounded-md border border-[var(--omp-border-muted)] object-contain"
				/>
			)}
			{output && !screenshot && (
				<pre
					className={
						"max-h-40 overflow-auto whitespace-pre-wrap rounded px-2 py-1.5 font-mono text-omp-sm leading-[1.45] " +
						(isError
							? "bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)]"
							: "bg-[var(--omp-code-bg)] text-[var(--omp-tool-output)]")
					}
				>
					{output}
				</pre>
			)}
			{isPartial && !screenshot && !output && (
				<div className="text-omp-sm italic text-[var(--omp-accent)]">{t("tools.computer.acting")}</div>
			)}
		</div>
	);
}
