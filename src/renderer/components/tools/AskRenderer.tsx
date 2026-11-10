import { Check, MessageCircleQuestion } from "lucide-react";
import { resultDetails, resultText, sanitizeToolText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { type AskFormField, answerNamesOption, parseAskForm } from "./ask-form";
import type { ToolRendererProps } from "./ToolCard";
import { asArray, asRecord, asString } from "./task-render-utils";

interface AskOption {
	label: string;
	description?: string;
}

function optionsFrom(value: unknown): AskOption[] {
	return asArray(value).flatMap(item => {
		if (typeof item === "string") return [{ label: item }];
		const option = asRecord(item);
		return typeof option?.label === "string"
			? [{ label: option.label, description: asString(option.description) }]
			: [];
	});
}

function AskQuestion({ text }: { text: string | undefined }) {
	const t = useT();
	return (
		<div className="flex items-start gap-1.5 text-omp-sm">
			<MessageCircleQuestion size={13} className="mt-0.5 shrink-0 text-(--omp-md-link)" />
			<span className="min-w-0 flex-1 leading-relaxed text-(--omp-text)">
				{text || t("tools.ask.questionFallback")}
			</span>
		</div>
	);
}

function AskOptionList({ options, isChosen }: { options: AskOption[]; isChosen: (label: string) => boolean }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-1 pl-5">
			{options.map((option, optionIndex) => {
				const chosen = isChosen(option.label);
				return (
					<div
						key={optionIndex}
						className={
							"flex items-start gap-2 rounded-md px-2 py-1 text-omp-sm " +
							(chosen ? "bg-(--omp-selected-bg) text-(--omp-text)" : "text-(--omp-muted)")
						}
					>
						{chosen ? (
							<Check
								aria-label={t("tools.ask.selected")}
								size={13}
								className="mt-1 shrink-0 text-(--omp-success)"
							/>
						) : (
							<span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-(--omp-border-muted)" />
						)}
						<div className="min-w-0">
							<div>{option.label}</div>
							{option.description && <div className="text-omp-xs text-(--omp-dim)">{option.description}</div>}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function AskFallback({ text, isError }: { text: string; isError: boolean | undefined }) {
	if (!text) return null;
	return (
		<div className={`whitespace-pre-wrap text-omp-sm ${isError ? "text-(--omp-error)" : "text-(--omp-muted)"}`}>
			{text}
		</div>
	);
}

function AskWaiting() {
	const t = useT();
	return (
		<div role="status" className="text-omp-xs text-(--omp-dim)">
			{t("tools.ask.waiting")}
		</div>
	);
}

interface AskFormRow {
	question: string;
	field: AskFormField | undefined;
	/** Submitted text; undefined until the form is answered. */
	answer: string | undefined;
}

/** Submitted answers when there are any, else the form's own questions. */
function formRows(details: Record<string, unknown> | undefined, fields: AskFormField[]): AskFormRow[] {
	const answers = asArray(details?.answers).flatMap(item => {
		const entry = asRecord(item);
		return typeof entry?.question === "string" && typeof entry.answer === "string"
			? [{ name: asString(entry.name) ?? "", question: entry.question, answer: entry.answer }]
			: [];
	});
	if (answers.length > 0) {
		return answers.map(({ name, question, answer }) => ({
			question,
			answer,
			field: fields.find(field => field.name === name),
		}));
	}
	return fields.map(field => ({ question: field.question, field, answer: undefined }));
}

/** Passwords never reach the transcript, matching the terminal's rendering of the same answers. */
function shownAnswer(row: AskFormRow): string {
	const answer = row.answer ?? "";
	return row.field?.password ? "•".repeat(Math.min(answer.length, 12)) : sanitizeToolText(answer);
}

/** An `ask` call that carried an HTML form: its questions, then what was submitted. */
function AskFormCall({ args, result, isPartial, isError }: ToolRendererProps) {
	const t = useT();
	const details = resultDetails(result) ?? asRecord(result);
	const html = asString(args.html) ?? "";
	const rows = formRows(details, html.trim() === "" ? [] : parseAskForm(html));
	const answered = rows.some(row => row.answer !== undefined);
	const fallback = !answered || isError ? resultText(result).trim() : "";

	return (
		<div className="flex flex-col gap-3">
			{rows.length === 0 && <AskQuestion text={undefined} />}
			{rows.map((row, index) => {
				const shown = shownAnswer(row);
				const { field, answer } = row;
				return (
					<section className="flex flex-col gap-1.5" key={index}>
						<AskQuestion text={sanitizeToolText(row.question)} />
						{field && field.options.length > 0 && (
							<AskOptionList
								options={field.options.map(label => ({ label: sanitizeToolText(label) }))}
								isChosen={label => answer !== undefined && answerNamesOption(field, label, answer)}
							/>
						)}
						{answer !== undefined && (
							<div className="pl-5 whitespace-pre-wrap text-omp-sm text-(--omp-text)">
								{shown ? t("tools.ask.answered", { answer: shown }) : t("tools.ask.noAnswer")}
							</div>
						)}
					</section>
				);
			})}
			{details?.timedOut === true && (
				<div className="text-omp-xs text-(--omp-warning)">{t("tools.ask.formTimedOut")}</div>
			)}
			<AskFallback text={fallback} isError={isError} />
			{isPartial && <AskWaiting />}
		</div>
	);
}

/** Sessions recorded before `ask` took HTML: original questions and authoritative selections. */
function AskQuestionsCall({ args, result, isPartial, isError }: ToolRendererProps) {
	const t = useT();
	const details = resultDetails(result) ?? asRecord(result);
	const answers = asArray(details?.results)
		.map(asRecord)
		.filter(item => item !== undefined);
	const original = asArray(args.questions)
		.map(asRecord)
		.filter(item => item !== undefined);
	const questions = original.length > 0 ? original : answers.length > 0 ? answers : [args];
	const hasStructuredAnswer =
		answers.length > 0 || Array.isArray(details?.selectedOptions) || typeof details?.customInput === "string";
	const fallback = !hasStructuredAnswer || isError ? resultText(result).trim() : "";

	return (
		<div className="flex flex-col gap-3">
			{questions.map((question, index) => {
				const answer =
					(typeof question.id === "string" ? answers.find(item => item.id === question.id) : answers[index]) ??
					(questions.length === 1 ? details : undefined);
				const text = asString(question.question) ?? asString(question.message) ?? asString(answer?.question);
				const originalOptions = optionsFrom(question.options);
				const options = originalOptions.length > 0 ? originalOptions : optionsFrom(answer?.options);
				const selected = new Set(
					asArray(answer?.selectedOptions).filter((item): item is string => typeof item === "string"),
				);
				return (
					<section className="flex flex-col gap-1.5" key={asString(question.id) ?? index}>
						<AskQuestion text={text} />
						{options.length > 0 && <AskOptionList options={options} isChosen={label => selected.has(label)} />}
						{selected.size > 0 && (
							<div className="pl-5 text-omp-sm text-(--omp-text)">
								{t("tools.ask.answered", { answer: [...selected].join(", ") })}
							</div>
						)}
						{typeof answer?.customInput === "string" && (
							<div className="pl-5 whitespace-pre-wrap text-omp-sm text-(--omp-text)">{answer.customInput}</div>
						)}
						{typeof answer?.note === "string" && (
							<div className="pl-5 whitespace-pre-wrap text-omp-xs text-(--omp-muted)">{answer.note}</div>
						)}
						{answer?.timedOut === true && (
							<div className="pl-5 text-omp-xs text-(--omp-warning)">{t("tools.ask.timedOut")}</div>
						)}
					</section>
				);
			})}
			{details?.chatRedirect === true && (
				<div className="text-omp-sm text-(--omp-muted)">{t("tools.ask.chatRedirect")}</div>
			)}
			<AskFallback text={fallback} isError={isError} />
			{isPartial && <AskWaiting />}
		</div>
	);
}

export function AskRenderer(props: ToolRendererProps) {
	const details = resultDetails(props.result) ?? asRecord(props.result);
	const isForm = typeof props.args.html === "string" || Array.isArray(details?.answers);
	return isForm ? <AskFormCall {...props} /> : <AskQuestionsCall {...props} />;
}
