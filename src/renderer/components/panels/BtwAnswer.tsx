import { Check, CornerDownLeft } from "lucide-react";
import { type BtwInjectState, splitBtwInject } from "../../../shared/rpc-types";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { useBtwStore } from "../../stores/btw";
import { toast } from "../../stores/toast";
import { Button } from "../common";

/**
 * A side answer, with the steering prompt it drafted for the main session
 * (`btw.inject`) set apart on a rail with its send button. `inject` is the
 * record's state and is passed only for its latest turn: older turns, and
 * answers asked while the setting was off, render as plain Markdown.
 */
export function BtwAnswer({ answer, recordId, inject }: { answer: string; recordId: string; inject?: BtwInjectState }) {
	const t = useT();
	const parts = inject ? splitBtwInject(answer) : undefined;
	if (!parts) return <MarkdownRenderer content={answer} />;

	const sent = inject === "sent";
	const send = async () => {
		try {
			const result = await useBtwStore.getState().inject(recordId);
			if (!result.sent) toast({ variant: "error", message: result.reason ?? t("btw.injectNotSent") });
		} catch (cause) {
			toast({ variant: "error", title: t("btw.injectNotSent"), message: String(cause) });
		}
	};

	return (
		<div className="w-full space-y-2">
			{parts.before.trim() ? <MarkdownRenderer content={parts.before} /> : null}
			<div
				data-btw-inject={inject}
				className={cx(
					"rounded-lg border-l-[3px] bg-(--omp-bg-elevated) px-3 py-2",
					sent ? "border-(--omp-success)" : "border-(--omp-ansi-magenta)",
				)}
			>
				<div className="mb-1 text-omp-xs font-medium text-(--omp-dim)">{t("btw.injectLabel")}</div>
				<div className="whitespace-pre-wrap break-words text-omp-md text-(--omp-text)">{parts.inject}</div>
				<div className="mt-2 flex items-center gap-2">
					{sent ? (
						<span className="flex items-center gap-1 text-omp-sm text-(--omp-success)">
							<Check aria-hidden size={14} /> {t("btw.injectSent")}
						</span>
					) : (
						<Button disabled={inject === "sending"} onClick={() => void send()} size="sm" variant="secondary">
							<CornerDownLeft aria-hidden size={14} />
							{inject === "sending" ? t("btw.injectSending") : t("btw.injectSend")}
						</Button>
					)}
				</div>
			</div>
			{parts.after.trim() ? <MarkdownRenderer content={parts.after} /> : null}
		</div>
	);
}
