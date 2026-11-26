import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText, cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { toast } from "../../stores/toast";

export function CopyButton({ text, className }: { text: string; className?: string }) {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const label = t(copied ? "mcp.card.copied" : "mcp.card.copy");
	return (
		<button
			className={cx(
				"inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-omp-xs transition-colors",
				copied ? "text-(--omp-success)" : "text-(--omp-dim) hover:text-(--omp-text)",
				className,
			)}
			onClick={async () => {
				if (!(await copyText(text))) {
					toast({ variant: "error", message: t("copySelector.failed") });
					return;
				}
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1400);
			}}
			title={label}
			type="button"
		>
			{copied ? <Check size={11} /> : <Copy size={11} />}
			{label}
		</button>
	);
}
