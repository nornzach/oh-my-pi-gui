/**
 * The agent's ask form rendered at the end of the transcript (#74), so the
 * conversation that prompted it stays on screen while answering. Opt-in via
 * Settings → GUI; a form parked in a background tab still pops as a modal.
 */
import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../../lib/i18n";
import { onEscape } from "../../lib/keymap";
import { answerExtensionRequest, TimeoutFooter, useCountdown, useInlineAskRequest } from "../dialogs/ExtensionDialog";
import { AskFormBody } from "../dialogs/FormDialog";
import { useReadOnlyTranscript } from "./transcript-mode";

export function InlineAskCard() {
	const t = useT();
	const readOnly = useReadOnlyTranscript();
	const request = useInlineAskRequest();
	const remaining = useCountdown(request ?? null);
	const cardRef = useRef<HTMLElement | null>(null);
	const requestId = request?.id;
	useEffect(() => {
		if (!requestId) return;
		const onKeyDown = (event: KeyboardEvent) => {
			// Only while the user is inside the form: Escape then cancels it, as in
			// the modal. Elsewhere it keeps its app-wide meaning (abort the turn).
			if (!cardRef.current?.contains(document.activeElement)) return;
			onEscape(event, () => answerExtensionRequest(requestId, { cancelled: true }));
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [requestId]);
	if (readOnly !== null || !request) return null;
	return (
		<section
			aria-label={t("extDialog.ask.title")}
			className="shrink-0 overflow-clip rounded-xl border border-(--omp-border-accent)"
			data-inline-ask
			ref={cardRef}
		>
			<div className="sticky top-0 z-20 flex min-h-10 items-center gap-2 bg-(--omp-bg-secondary) px-3 py-1.5">
				<MessageCircleQuestion aria-hidden className="shrink-0 text-(--omp-accent)" size={15} />
				<span className="text-omp-md font-semibold text-(--omp-text)">{t("extDialog.ask.title")}</span>
			</div>
			<div className="bg-(--omp-bg-primary) px-3 py-3">
				<AskFormBody
					draftKey={request.id}
					footer={<TimeoutFooter remaining={remaining} />}
					key={request.id}
					onCancel={() => answerExtensionRequest(request.id, { cancelled: true })}
					onSubmit={formData => answerExtensionRequest(request.id, { formData })}
					sections={request.sections}
				/>
			</div>
		</section>
	);
}
