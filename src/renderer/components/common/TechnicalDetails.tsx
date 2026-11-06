/**
 * A failure exactly as it came, for a bug report or for whoever can read it.
 * Folded away under the readable sentence, and left out when that sentence is
 * already the whole text.
 */
import { useT } from "../../lib/i18n";
import { PREVIEW_SCROLL_SM } from "../../lib/preview";

export function TechnicalDetails({
	raw,
	shown,
	className,
}: {
	raw: string | undefined;
	shown: string;
	className?: string;
}) {
	const t = useT();
	const text = raw?.trim();
	if (!text || text === shown) return null;
	return (
		<details className={className}>
			<summary className="cursor-pointer text-omp-xs text-(--omp-dim) hover:text-(--omp-muted)">
				{t("errors.technicalDetails")}
			</summary>
			<pre
				className={`${PREVIEW_SCROLL_SM} mt-1 select-text whitespace-pre-wrap break-words rounded-lg border border-(--omp-border-muted) bg-(--omp-code-bg) p-2 font-mono text-omp-xs leading-relaxed text-(--omp-muted)`}
			>
				{text}
			</pre>
		</details>
	);
}
