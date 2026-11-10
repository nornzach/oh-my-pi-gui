/**
 * The agent's `ask` form as one dialog. The sidecar parses the model's HTML and
 * sends structured sections, so nothing model-written is injected as markup.
 * Text rules (type, pattern, min/max) use the browser's own form validation.
 */

import { Check } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type {
	ExtensionFormBlock,
	ExtensionFormChoiceField,
	ExtensionFormField,
	ExtensionFormSection,
	ExtensionFormSpan,
	ExtensionFormTextField,
} from "../../../shared/rpc-types";
import { cx, sanitizeToolText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { Button, Input, Modal, TextArea } from "../common";

/** One selectable row; `multi` draws a checkbox, otherwise a radio. */
export function ChoiceRow({
	checked,
	multi,
	disabled,
	onClick,
	children,
}: {
	checked: boolean;
	multi: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			aria-pressed={checked}
			className={cx(
				"flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-(--omp-border-accent)",
				checked
					? "border-(--omp-border-accent) bg-(--omp-selected-bg)"
					: "border-(--omp-border-muted) hover:border-(--omp-border-accent) hover:bg-(--omp-selected-bg)",
				disabled && "cursor-not-allowed opacity-50",
			)}
			disabled={disabled}
			onClick={onClick}
			type="button"
		>
			<span
				className={cx(
					"mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors",
					multi ? "rounded-[3px]" : "rounded-full",
					checked ? "border-(--omp-accent) text-(--omp-accent)" : "border-(--omp-border-strong) text-transparent",
				)}
			>
				{multi ? <Check size={10} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
			</span>
			<span className="min-w-0 flex-1">{children}</span>
		</button>
	);
}

interface ChoiceDraft {
	checked: ReadonlySet<number>;
	other: string;
}
type FieldDraft = string | ChoiceDraft;

function plainText(spans: ExtensionFormSpan[]): string {
	return sanitizeToolText(spans.map(span => span.text).join(""));
}

function Spans({ spans }: { spans: ExtensionFormSpan[] }) {
	return (
		<>
			{spans.map((span, index) => {
				const text = sanitizeToolText(span.text);
				if (span.style === "code") {
					return (
						<code className="rounded bg-(--omp-code-bg) px-1 font-mono" key={index}>
							{text}
						</code>
					);
				}
				if (span.style === "strong") return <strong key={index}>{text}</strong>;
				if (span.style === "em") return <em key={index}>{text}</em>;
				return <span key={index}>{text}</span>;
			})}
		</>
	);
}

function initialDraft(field: ExtensionFormField): FieldDraft {
	if (field.kind === "text") return field.value;
	return {
		checked: new Set(field.options.flatMap((option, index) => (option.checked && !option.disabled ? [index] : []))),
		other: "",
	};
}

function isBlank(field: ExtensionFormField, draft: FieldDraft | undefined): boolean {
	if (typeof draft === "string") return draft.trim() === "";
	return field.kind === "choice" && (draft === undefined || (draft.checked.size === 0 && draft.other.trim() === ""));
}

function choiceFormValue(field: ExtensionFormChoiceField, draft: ChoiceDraft): string | string[] | undefined {
	const values = field.options.flatMap((option, index) => (draft.checked.has(index) ? [option.value] : []));
	const other = field.other ? draft.other.trim() : "";
	if (field.multi) return other ? [...values, other] : values;
	return other || values[0];
}

function formDataOf(fields: ExtensionFormField[], drafts: FieldDraft[]): Record<string, string | string[]> {
	const data: Record<string, string | string[]> = {};
	fields.forEach((field, index) => {
		const draft = drafts[index];
		const value =
			typeof draft === "string"
				? draft
				: draft && field.kind === "choice"
					? choiceFormValue(field, draft)
					: undefined;
		if (value !== undefined) data[field.name] = value;
	});
	return data;
}

function TextFieldInput({
	field,
	value,
	error,
	onChange,
}: {
	field: ExtensionFormTextField;
	value: string;
	error: string | undefined;
	onChange: (value: string) => void;
}) {
	const shared = {
		autoComplete: "off",
		error,
		label: plainText(field.label),
		maxLength: field.maxLength,
		minLength: field.minLength,
		placeholder: field.placeholder,
		required: field.required,
		value,
	};
	if (field.multiline) {
		return <TextArea {...shared} onChange={event => onChange(event.target.value)} rows={field.rows} />;
	}
	return (
		<Input
			{...shared}
			max={field.max}
			min={field.min}
			onChange={event => onChange(event.target.value)}
			pattern={field.pattern}
			step={field.type === "number" || field.type === "range" ? "any" : undefined}
			type={field.type === "range" ? "number" : field.type}
		/>
	);
}

function ChoiceFieldInput({
	field,
	draft,
	error,
	onChange,
}: {
	field: ExtensionFormChoiceField;
	draft: ChoiceDraft;
	error: string | undefined;
	onChange: (draft: ChoiceDraft) => void;
}) {
	const t = useT();
	const toggle = (index: number) => {
		if (!field.multi) {
			onChange({ checked: new Set([index]), other: "" });
			return;
		}
		const checked = new Set(draft.checked);
		if (checked.has(index)) checked.delete(index);
		else checked.add(index);
		onChange({ ...draft, checked });
	};
	return (
		<div className="space-y-1">
			{field.label.length > 0 && (
				<p className="text-xs font-medium break-words whitespace-pre-wrap text-(--omp-text)">
					<Spans spans={field.label} />
				</p>
			)}
			{field.options.map((option, index) => (
				<ChoiceRow
					checked={draft.checked.has(index)}
					disabled={option.disabled}
					key={index}
					multi={field.multi}
					onClick={() => toggle(index)}
				>
					<span className="block text-xs break-words whitespace-pre-wrap text-(--omp-text)">
						<Spans spans={option.label} />
					</span>
				</ChoiceRow>
			))}
			{field.other && (
				<Input
					autoComplete="off"
					onChange={event => {
						const other = event.target.value;
						// Single choice: typing an answer replaces the picked option.
						onChange({ other, checked: !field.multi && other.trim() !== "" ? new Set() : draft.checked });
					}}
					placeholder={t("extDialog.ask.customPlaceholder")}
					value={draft.other}
				/>
			)}
			{error && <p className="text-omp-xs text-(--omp-error)">{error}</p>}
		</div>
	);
}

function ContextBlock({ block }: { block: Exclude<ExtensionFormBlock, { kind: "field" }> }) {
	switch (block.kind) {
		case "text":
			return (
				<p
					className={cx(
						"text-xs leading-relaxed break-words whitespace-pre-wrap text-(--omp-text)",
						block.heading && "font-medium",
					)}
				>
					<Spans spans={block.spans} />
				</p>
			);
		case "list": {
			const List = block.ordered ? "ol" : "ul";
			return (
				<List
					className={cx(
						"space-y-0.5 pl-5 text-xs text-(--omp-text)",
						block.ordered ? "list-decimal" : "list-disc",
					)}
				>
					{block.items.map((item, index) => (
						<li key={index}>
							<Spans spans={item} />
						</li>
					))}
				</List>
			);
		}
		case "pre":
			return (
				<pre className="overflow-x-auto rounded-md bg-(--omp-code-bg) px-2.5 py-2 font-mono text-omp-xs text-(--omp-text)">
					{sanitizeToolText(block.text)}
				</pre>
			);
		case "table":
			return (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-omp-xs text-(--omp-text)">
						<tbody>
							{block.rows.map((row, rowIndex) => {
								const Cell = rowIndex < block.headerRows ? "th" : "td";
								return (
									<tr className="border-b border-(--omp-border-muted)" key={rowIndex}>
										{row.map((cell, cellIndex) => (
											<Cell className="px-1.5 py-1 align-top" key={cellIndex}>
												<Spans spans={cell} />
											</Cell>
										))}
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			);
	}
}

export function FormDialog({
	sections,
	footer,
	onSubmit,
	onCancel,
}: {
	sections: ExtensionFormSection[];
	/** Countdown shown beside the buttons. */
	footer: ReactNode;
	onSubmit: (formData: Record<string, string | string[]>) => void;
	onCancel: () => void;
}) {
	const t = useT();
	const fields = useMemo(
		() =>
			sections.flatMap(section =>
				section.blocks.flatMap(block => (block.kind === "field" && block.field.name ? [block.field] : [])),
			),
		[sections],
	);
	const [drafts, setDrafts] = useState<FieldDraft[]>(() => fields.map(initialDraft));
	const [missing, setMissing] = useState<ReadonlySet<number>>(new Set());

	const update = (index: number, draft: FieldDraft) => {
		setDrafts(previous => previous.map((item, position) => (position === index ? draft : item)));
		setMissing(previous => {
			const next = new Set(previous);
			next.delete(index);
			return next;
		});
	};

	const submit = () => {
		const blank = fields.flatMap((field, index) => (field.required && isBlank(field, drafts[index]) ? [index] : []));
		if (blank.length > 0) {
			setMissing(new Set(blank));
			return;
		}
		onSubmit(formDataOf(fields, drafts));
	};

	const renderField = (field: ExtensionFormField) => {
		const index = fields.indexOf(field);
		const draft = drafts[index];
		if (index < 0 || draft === undefined) return null;
		const error = missing.has(index) ? t("extDialog.form.required") : undefined;
		if (field.kind === "text") {
			return (
				<TextFieldInput
					error={error}
					field={field}
					onChange={value => update(index, value)}
					value={typeof draft === "string" ? draft : ""}
				/>
			);
		}
		return (
			<ChoiceFieldInput
				draft={typeof draft === "string" ? { checked: new Set(), other: "" } : draft}
				error={error}
				field={field}
				onChange={value => update(index, value)}
			/>
		);
	};

	return (
		<Modal onClose={onCancel} open size="lg" title={t("extDialog.ask.title")}>
			<form
				className="space-y-5"
				onSubmit={event => {
					event.preventDefault();
					submit();
				}}
			>
				{sections.map((section, sectionIndex) => (
					<div className="space-y-3" key={sectionIndex}>
						{section.title.length > 0 && (
							<h3 className="text-xs font-semibold break-words whitespace-pre-wrap text-(--omp-text)">
								<Spans spans={section.title} />
							</h3>
						)}
						{section.blocks.map((block, blockIndex) => (
							<div key={blockIndex}>
								{block.kind === "field" ? renderField(block.field) : <ContextBlock block={block} />}
							</div>
						))}
					</div>
				))}
				<div className="flex items-center justify-between gap-2 border-t border-(--omp-border-muted) pt-3">
					<div className="flex items-center gap-2">{footer}</div>
					<div className="flex gap-2">
						<Button onClick={onCancel} size="sm" type="button" variant="ghost">
							{t("common.cancel")}
						</Button>
						<Button size="sm" type="submit" variant="primary">
							{t("extDialog.submit")}
						</Button>
					</div>
				</div>
			</form>
		</Modal>
	);
}
