/**
 * The task form shared by the editor and the agent's confirm card: what to
 * do, where, when, with how much access. Validation is the scheduler's own
 * (`scheduler.validate`), debounced, so the form can never accept a draft
 * main would refuse.
 */

import { ChevronRight, Eye, FolderOpen, GitBranch, ShieldAlert } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type {
	DraftProblem,
	TaskDraft,
	TaskNotify,
	TaskSchedule,
	TaskToolPolicy,
} from "../../../shared/scheduler-types";
import { cx, formatClock } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { Button, Input, TextArea } from "../common";
import { ModelValueSelect } from "../settings/ModelValueSelect";
import { scheduleLabel, upcoming, weekdayName } from "./task-format";

const VALIDATE_DEBOUNCE_MS = 200;

/** Ask main what is wrong with a draft, debounced; [] while the first answer is pending. */
export function useDraftProblems(draft: TaskDraft, editingId?: string): DraftProblem[] {
	const [problems, setProblems] = useState<DraftProblem[]>([]);
	useEffect(() => {
		let live = true;
		const timer = setTimeout(() => {
			window.omp.scheduler.validate(draft, editingId).then(
				result => live && setProblems(result),
				() => {},
			);
		}, VALIDATE_DEBOUNCE_MS);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [draft, editingId]);
	return problems;
}

type CronPreset =
	| { kind: "hourly"; minute: number }
	| { kind: "daily"; time: string }
	| { kind: "weekdays"; time: string }
	| { kind: "weekly"; time: string; weekday: number }
	| { kind: "custom"; expr: string };

const pad = (value: number) => String(value).padStart(2, "0");
const timeOf = (minute: string, hour: string) => `${pad(Number(hour))}:${pad(Number(minute))}`;

function presetFromCron(expr: string): CronPreset {
	const fields = expr.trim().split(/\s+/);
	if (
		fields.length === 5 &&
		fields.slice(0, 2).every(field => /^\d+$/.test(field)) &&
		fields[2] === "*" &&
		fields[3] === "*"
	) {
		const [minute, hour, , , weekday] = fields;
		if (weekday === "*") return { kind: "daily", time: timeOf(minute, hour) };
		if (weekday === "1-5") return { kind: "weekdays", time: timeOf(minute, hour) };
		if (/^[0-6]$/.test(weekday)) return { kind: "weekly", time: timeOf(minute, hour), weekday: Number(weekday) };
	}
	if (fields.length === 5 && /^\d+$/.test(fields[0]) && fields.slice(1).every(field => field === "*")) {
		return { kind: "hourly", minute: Number(fields[0]) };
	}
	return { kind: "custom", expr };
}

function cronFromPreset(preset: CronPreset): string {
	const [hour, minute] = "time" in preset ? preset.time.split(":").map(Number) : [0, 0];
	switch (preset.kind) {
		case "hourly":
			return `${preset.minute} * * * *`;
		case "daily":
			return `${minute} ${hour} * * *`;
		case "weekdays":
			return `${minute} ${hour} * * 1-5`;
		case "weekly":
			return `${minute} ${hour} * * ${preset.weekday}`;
		case "custom":
			return preset.expr;
	}
}

type IntervalUnit = "minutes" | "hours" | "days";
const UNIT_MS: Record<IntervalUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

function intervalParts(everyMs: number): { count: number; unit: IntervalUnit } {
	if (everyMs % UNIT_MS.days === 0) return { count: everyMs / UNIT_MS.days, unit: "days" };
	if (everyMs % UNIT_MS.hours === 0) return { count: everyMs / UNIT_MS.hours, unit: "hours" };
	return { count: Math.max(1, Math.round(everyMs / UNIT_MS.minutes)), unit: "minutes" };
}

/** Date (`YYYY-MM-DD`) and time (`HH:MM`) of a moment in the machine's zone. */
function localParts(ms: number): { date: string; time: string } {
	const at = new Date(ms);
	return {
		date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
		time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
	};
}

/** Sized and styled like the shared `Input`, so a row of controls lines up. */
const SELECT_CLASS =
	"rounded-lg border border-(--omp-input-border) bg-(--omp-input-bg) px-3 py-[9px] text-omp-lg leading-[1.45] text-(--omp-text) shadow-(--omp-shadow-sm) transition-[border-color,box-shadow] duration-150 hover:border-(--omp-border-strong) focus:border-(--omp-input-focus-border) focus:shadow-[0_0_0_3px_var(--omp-input-glow)] focus:outline-none";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTE_STEPS = Array.from({ length: 12 }, (_, step) => step * 5);

/**
 * Hour and minute as two selects. A native time input formats in the OS
 * locale (上午 09:00 under an English UI); these follow the app's language.
 */
function TimeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	const t = useT();
	const [hour, minute] = value.split(":").map(Number);
	const minutes = MINUTE_STEPS.includes(minute) ? MINUTE_STEPS : [...MINUTE_STEPS, minute].sort((a, b) => a - b);
	return (
		<span aria-label={t("tasks.form.time")} className="inline-flex items-center gap-1" role="group">
			<select
				aria-label={t("tasks.form.hour")}
				className={cx(SELECT_CLASS, "tabular-nums")}
				onChange={event => onChange(timeOf(String(minute), event.target.value))}
				value={hour}
			>
				{HOURS.map(option => (
					<option key={option} value={option}>
						{pad(option)}
					</option>
				))}
			</select>
			<span className="text-omp-lg text-(--omp-muted)">:</span>
			<select
				aria-label={t("tasks.form.minute")}
				className={cx(SELECT_CLASS, "tabular-nums")}
				onChange={event => onChange(timeOf(event.target.value, String(hour)))}
				value={minute}
			>
				{minutes.map(option => (
					<option key={option} value={option}>
						{pad(option)}
					</option>
				))}
			</select>
		</span>
	);
}

/** A one-off moment: the date input plus the same hour and minute selects. */
function OnceField({ at, onChange }: { at: number; onChange: (at: number) => void }) {
	const t = useT();
	const { date, time } = localParts(at);
	const set = (nextDate: string, nextTime: string) => {
		const value = new Date(`${nextDate}T${nextTime}`).getTime();
		if (Number.isFinite(value)) onChange(value);
	};
	return (
		<>
			<input
				aria-label={t("tasks.form.date")}
				className={cx(SELECT_CLASS, "tabular-nums")}
				onChange={event => event.target.value && set(event.target.value, time)}
				type="date"
				value={date}
			/>
			<TimeSelect onChange={value => set(date, value)} value={time} />
		</>
	);
}

function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
}: {
	value: T;
	options: { id: T; label: string }[];
	onChange: (value: T) => void;
	label: string;
}) {
	return (
		<div
			aria-label={label}
			className="inline-flex rounded-lg border border-(--omp-border-muted) p-0.5"
			role="radiogroup"
		>
			{options.map(option => (
				<button
					aria-checked={option.id === value}
					className={cx(
						"rounded-md px-3 py-1 text-omp-md font-medium transition-[background-color,color,box-shadow] duration-150",
						option.id === value
							? "bg-(--omp-selected-bg) text-(--omp-text) shadow-(--omp-shadow-sm)"
							: "text-(--omp-muted) hover:text-(--omp-text)",
					)}
					key={option.id}
					onClick={() => onChange(option.id)}
					role="radio"
					type="button"
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function FieldLabel({ children, error }: { children: ReactNode; error?: string }) {
	return (
		<div className="mb-1.5 flex items-baseline justify-between gap-3">
			<span className="text-omp-md font-medium text-(--omp-text-secondary)">{children}</span>
			{error && <span className="omp-fade-in text-omp-sm text-(--omp-error)">{error}</span>}
		</div>
	);
}

function ScheduleField({
	schedule,
	onChange,
	error,
}: {
	schedule: TaskSchedule;
	onChange: (schedule: TaskSchedule) => void;
	error?: string;
}) {
	const t = useT();
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const preset = schedule.kind === "cron" ? presetFromCron(schedule.expr) : null;
	const interval = schedule.kind === "interval" ? intervalParts(schedule.everyMs) : null;
	const next = useMemo(() => (error ? [] : upcoming(schedule, 3)), [schedule, error]);
	const setPreset = (value: CronPreset) => onChange({ kind: "cron", expr: cronFromPreset(value), tz: zone });
	const presetTime = preset && "time" in preset ? preset.time : "09:00";

	return (
		<div>
			<FieldLabel error={error}>{t("tasks.form.schedule")}</FieldLabel>
			<Segmented
				label={t("tasks.form.schedule")}
				onChange={kind => {
					if (kind === schedule.kind) return;
					if (kind === "cron") setPreset({ kind: "weekdays", time: "09:00" });
					else if (kind === "interval")
						onChange({ kind: "interval", everyMs: UNIT_MS.hours, anchor: Date.now() + UNIT_MS.hours });
					else
						onChange({
							kind: "once",
							at: Math.ceil((Date.now() + UNIT_MS.hours) / UNIT_MS.hours) * UNIT_MS.hours,
						});
				}}
				options={[
					{ id: "cron", label: t("tasks.form.kind.cron") },
					{ id: "interval", label: t("tasks.form.kind.interval") },
					{ id: "once", label: t("tasks.form.kind.once") },
				]}
				value={schedule.kind}
			/>
			<div className="mt-3 flex flex-wrap items-center gap-2" key={schedule.kind}>
				{preset && (
					<>
						<select
							aria-label={t("tasks.form.repeat")}
							className={SELECT_CLASS}
							onChange={event => {
								const kind = event.target.value as CronPreset["kind"];
								if (kind === "hourly") setPreset({ kind, minute: 0 });
								else if (kind === "weekly") setPreset({ kind, time: presetTime, weekday: 1 });
								else if (kind === "custom")
									setPreset({ kind, expr: schedule.kind === "cron" ? schedule.expr : "0 9 * * *" });
								else setPreset({ kind, time: presetTime });
							}}
							value={preset.kind}
						>
							{(["hourly", "daily", "weekdays", "weekly", "custom"] as const).map(kind => (
								<option key={kind} value={kind}>
									{t(`tasks.form.preset.${kind}`)}
								</option>
							))}
						</select>
						{preset.kind === "hourly" && (
							<label className="flex items-center gap-2 text-omp-md text-(--omp-muted)">
								{t("tasks.form.atMinute")}
								<input
									className={cx(SELECT_CLASS, "w-20 tabular-nums")}
									max={59}
									min={0}
									onChange={event =>
										setPreset({
											kind: "hourly",
											minute: Math.min(59, Math.max(0, Number(event.target.value) || 0)),
										})
									}
									type="number"
									value={preset.minute}
								/>
							</label>
						)}
						{preset.kind === "weekly" && (
							<select
								aria-label={t("tasks.form.weekday")}
								className={SELECT_CLASS}
								onChange={event =>
									setPreset({ kind: "weekly", time: preset.time, weekday: Number(event.target.value) })
								}
								value={preset.weekday}
							>
								{[1, 2, 3, 4, 5, 6, 0].map(day => (
									<option key={day} value={day}>
										{weekdayName(day)}
									</option>
								))}
							</select>
						)}
						{"time" in preset && (
							<TimeSelect onChange={time => setPreset({ ...preset, time })} value={preset.time} />
						)}
						{preset.kind === "custom" && (
							<input
								aria-label={t("tasks.form.cron")}
								className={cx(SELECT_CLASS, "w-48 font-mono")}
								onChange={event => setPreset({ kind: "custom", expr: event.target.value })}
								placeholder="0 9 * * 1-5"
								spellCheck={false}
								value={preset.expr}
							/>
						)}
					</>
				)}
				{interval && schedule.kind === "interval" && (
					<>
						<span className="text-omp-md text-(--omp-muted)">{t("tasks.form.every")}</span>
						<input
							aria-label={t("tasks.form.every")}
							className={cx(SELECT_CLASS, "w-20 tabular-nums")}
							min={1}
							onChange={event => {
								const count = Math.max(1, Math.round(Number(event.target.value) || 1));
								onChange({
									...schedule,
									everyMs: count * UNIT_MS[interval.unit],
									anchor: Date.now() + count * UNIT_MS[interval.unit],
								});
							}}
							type="number"
							value={interval.count}
						/>
						<select
							aria-label={t("tasks.form.unit")}
							className={SELECT_CLASS}
							onChange={event => {
								const unit = event.target.value as IntervalUnit;
								onChange({
									...schedule,
									everyMs: interval.count * UNIT_MS[unit],
									anchor: Date.now() + interval.count * UNIT_MS[unit],
								});
							}}
							value={interval.unit}
						>
							{(["minutes", "hours", "days"] as const).map(unit => (
								<option key={unit} value={unit}>
									{t(`tasks.form.unit.${unit}`)}
								</option>
							))}
						</select>
					</>
				)}
				{schedule.kind === "once" && <OnceField at={schedule.at} onChange={at => onChange({ kind: "once", at })} />}
			</div>
			<p className="mt-2 text-omp-sm text-(--omp-dim)">
				{next.length > 0 ? (
					<>
						<span className="text-(--omp-muted)">{scheduleLabel(t, schedule)}</span>
						{" · "}
						{t("tasks.form.nextRuns", { times: next.map(at => formatClock(at)).join(", ") })}
						{schedule.kind === "cron" && <span className="ml-1.5 text-(--omp-dim)">({schedule.tz})</span>}
					</>
				) : (
					t("tasks.form.noUpcoming")
				)}
			</p>
		</div>
	);
}

const ACCESS: { id: TaskToolPolicy; icon: typeof Eye }[] = [
	{ id: "read_only", icon: Eye },
	{ id: "workspace", icon: GitBranch },
	{ id: "full", icon: ShieldAlert },
];

function AccessField({ value, onChange }: { value: TaskToolPolicy; onChange: (value: TaskToolPolicy) => void }) {
	const t = useT();
	return (
		<div>
			<FieldLabel>{t("tasks.form.access")}</FieldLabel>
			<div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("tasks.form.access")}>
				{ACCESS.map(({ id, icon: Icon }) => {
					const active = id === value;
					return (
						<button
							aria-checked={active}
							className={cx(
								"omp-pressable flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] duration-150",
								active
									? "border-(--omp-accent) bg-(--omp-selected-bg) shadow-[0_0_0_3px_var(--omp-input-glow)]"
									: "border-(--omp-border-muted) hover:border-(--omp-border-strong)",
							)}
							key={id}
							onClick={() => onChange(id)}
							role="radio"
							type="button"
						>
							<span className="flex items-center gap-1.5 text-omp-md font-medium text-(--omp-text)">
								<Icon size={14} className={id === "full" ? "text-(--omp-warning)" : "text-(--omp-muted)"} />
								{t(`tasks.access.${id}`)}
							</span>
							<span className="text-omp-sm leading-snug text-(--omp-dim)">{t(`tasks.access.${id}.detail`)}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function TaskForm({
	draft,
	onChange,
	problems,
}: {
	draft: TaskDraft;
	onChange: (draft: TaskDraft) => void;
	problems: DraftProblem[];
}) {
	const t = useT();
	const [advanced, setAdvanced] = useState(
		draft.verify !== null || draft.notify !== "on_change" || draft.timeoutMs !== 30 * 60_000,
	);
	const has = (problem: DraftProblem) => problems.includes(problem);
	const problemText = (...ids: DraftProblem[]) => {
		const found = ids.find(has);
		return found ? t(`tasks.problem.${found}`) : undefined;
	};
	const patch = (changes: Partial<TaskDraft>) => onChange({ ...draft, ...changes });

	return (
		<div className="flex flex-col gap-5">
			<Input
				autoFocus={draft.title === ""}
				error={problemText("title_missing")}
				label={t("tasks.form.title")}
				maxLength={80}
				onChange={event => patch({ title: event.target.value })}
				placeholder={t("tasks.form.titlePlaceholder")}
				value={draft.title}
			/>
			<TextArea
				error={problemText("prompt_missing")}
				hint={t("tasks.form.promptHint")}
				label={t("tasks.form.prompt")}
				onChange={event => patch({ prompt: event.target.value })}
				placeholder={t("tasks.form.promptPlaceholder")}
				rows={5}
				value={draft.prompt}
			/>
			<div>
				<FieldLabel error={problemText("cwd_missing")}>{t("tasks.form.folder")}</FieldLabel>
				<div className="flex gap-2">
					<div className="min-w-0 flex-1">
						<Input
							mono
							onChange={event => patch({ cwd: event.target.value })}
							spellCheck={false}
							value={draft.cwd}
						/>
					</div>
					<Button
						className="h-auto shrink-0"
						icon={<FolderOpen size={13} />}
						onClick={async () => {
							const picked = await window.omp.system.showOpenDialog(undefined, { directory: true });
							if (picked?.[0]) patch({ cwd: picked[0] });
						}}
					>
						{t("tasks.form.browse")}
					</Button>
				</div>
			</div>
			<ScheduleField
				error={problemText("schedule_invalid", "schedule_in_past", "too_frequent")}
				onChange={schedule => patch({ schedule })}
				schedule={draft.schedule}
			/>
			<AccessField onChange={tools => patch({ tools })} value={draft.tools} />
			<div>
				<FieldLabel>{t("tasks.form.model")}</FieldLabel>
				<div className="flex flex-wrap items-center gap-2">
					<div className="min-w-64 flex-1">
						<ModelValueSelect
							kind="model"
							size="field"
							onCommit={value => patch({ model: value.trim() === "" ? null : value.trim() })}
							placeholder={t("tasks.form.modelDefault")}
							value={draft.model ?? ""}
						/>
					</div>
					{draft.model && (
						<Button onClick={() => patch({ model: null })} size="sm" variant="ghost">
							{t("tasks.form.modelClear")}
						</Button>
					)}
				</div>
			</div>
			<div>
				<button
					aria-expanded={advanced}
					className="flex items-center gap-1 text-omp-md font-medium text-(--omp-muted) hover:text-(--omp-text)"
					onClick={() => setAdvanced(open => !open)}
					type="button"
				>
					<ChevronRight
						size={14}
						className={cx("omp-disclosure-chevron transition-transform duration-150", advanced && "rotate-90")}
					/>
					{t("tasks.form.advanced")}
				</button>
				{advanced && (
					<div className="omp-fade-up mt-3 grid gap-4 sm:grid-cols-2">
						<Input
							error={problemText("timeout_invalid")}
							label={t("tasks.form.timeout")}
							max={360}
							min={1}
							onChange={event => patch({ timeoutMs: Math.round(Number(event.target.value) || 0) * 60_000 })}
							type="number"
							value={Math.round(draft.timeoutMs / 60_000)}
						/>
						<label className="block">
							<span className="mb-1.5 block text-omp-md font-medium text-(--omp-text-secondary)">
								{t("tasks.form.notify")}
							</span>
							<select
								className={cx(SELECT_CLASS, "w-full")}
								onChange={event => patch({ notify: event.target.value as TaskNotify })}
								value={draft.notify}
							>
								{(["on_change", "always", "on_failure"] as const).map(mode => (
									<option key={mode} value={mode}>
										{t(`tasks.notify.${mode}`)}
									</option>
								))}
							</select>
						</label>
						<div className="sm:col-span-2">
							<Input
								error={problemText("verify_invalid")}
								hint={t(
									draft.tools === "read_only" ? "tasks.form.verifyHintReadOnly" : "tasks.form.verifyHint",
								)}
								label={t("tasks.form.verify")}
								mono
								onChange={event => {
									const command = event.target.value;
									patch({
										verify:
											command === "" ? null : { command, timeoutMs: draft.verify?.timeoutMs ?? 10 * 60_000 },
									});
								}}
								placeholder="bun test"
								spellCheck={false}
								value={draft.verify?.command ?? ""}
							/>
						</div>
						<label className="flex items-center gap-2 text-omp-md text-(--omp-text) sm:col-span-2">
							<input
								checked={draft.startPaused}
								className="size-4 accent-(--omp-accent)"
								onChange={event => patch({ startPaused: event.target.checked })}
								type="checkbox"
							/>
							{t("tasks.form.startPaused")}
						</label>
					</div>
				)}
			</div>
			{has("too_many_enabled") && (
				<p className="omp-fade-in rounded-lg border border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] px-3 py-2 text-omp-md text-(--omp-warning)">
					{t("tasks.problem.too_many_enabled")}
				</p>
			)}
		</div>
	);
}
