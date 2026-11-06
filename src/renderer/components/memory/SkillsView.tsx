/**
 * Skills tab: skills omp taught itself. They work the moment omp writes them;
 * here the person catches up — sees what is new or what changed since they
 * last looked, and keeps, edits, switches off, or removes each one.
 */
import { Check, ChevronRight, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RpcSkillDetail, RpcSkillInfo } from "../../../shared/rpc-types";
import { refreshLearnedSkills } from "../../hooks/use-learned-skills";
import { DiffView } from "../../lib/diff";
import { describeError } from "../../lib/errors";
import { cx, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { MarkdownRenderer } from "../../lib/markdown";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import {
	type ReviewedSkill,
	type SkillReviewState,
	skillReviewDiff,
	skillReviewState,
	useSkillReviewStore,
} from "../../stores/skill-review";
import { toast } from "../../stores/toast";
import { Badge, Button, Input, Spinner, TextArea } from "../common";
import { Toggle } from "../settings/editors/Toggle";
import { useArmed } from "./MemoryEntries";

const AUTOLEARN = "autolearn.enabled";
const STATE_ORDER: Record<SkillReviewState, number> = { new: 0, changed: 1, reviewed: 2 };

function iso(ms: number | undefined): string | undefined {
	return ms === undefined ? undefined : new Date(ms).toISOString();
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
	return (
		<button
			aria-checked={checked}
			aria-label={label}
			className={cx(
				"relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border transition-colors duration-(--omp-motion-fast)",
				checked ? "border-(--omp-accent) bg-(--omp-accent)" : "border-(--omp-border-strong) bg-transparent",
			)}
			onClick={event => {
				event.stopPropagation();
				onChange(!checked);
			}}
			role="switch"
			title={label}
			type="button"
		>
			<span
				className={cx(
					"absolute size-3 rounded-full transition-transform duration-(--omp-motion-fast)",
					checked ? "translate-x-[0.9rem] bg-(--omp-bg-elevated)" : "translate-x-0.5 bg-(--omp-muted)",
				)}
			/>
		</button>
	);
}

function SkillCard({
	skill,
	state,
	reviewed,
	expanded,
	onToggleExpanded,
	onChanged,
}: {
	skill: RpcSkillInfo;
	state: SkillReviewState;
	reviewed: ReviewedSkill | undefined;
	expanded: boolean;
	onToggleExpanded: () => void;
	onChanged: () => Promise<void>;
}) {
	const t = useT();
	const rpc = useTabRpc();
	const markReviewed = useSkillReviewStore(store => store.markReviewed);
	const forget = useSkillReviewStore(store => store.forget);
	const { armed, arm } = useArmed();
	const [loaded, setLoaded] = useState<RpcSkillDetail | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [editing, setEditing] = useState<{ description: string; body: string } | null>(null);
	const [busy, setBusy] = useState<"save" | "remove" | "review" | "toggle" | null>(null);
	// Only the read of the skill as it is now counts: once omp rewrites it, an
	// older read would review — or diff — words the person never saw.
	const detail = loaded && loaded.modifiedAt === skill.modifiedAt ? loaded : null;

	// Read the skill when the card opens, and again after omp rewrites it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: modifiedAt is the rewrite signal
	useEffect(() => {
		if (!expanded) return;
		let cancelled = false;
		setLoadError(null);
		void rpc
			.getSkillDetail(skill.name)
			.then(response => {
				if (cancelled) return;
				if (!response.success) throw new Error(response.error);
				setLoaded(response.data as RpcSkillDetail);
			})
			.catch(cause => {
				if (!cancelled) setLoadError(describeError(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [expanded, rpc, skill.name, skill.modifiedAt]);

	const diff = detail && reviewed && state === "changed" ? skillReviewDiff(reviewed, detail) : null;

	// Rewritten with the same words (a touch, a re-save): nothing to review.
	useEffect(() => {
		if (detail && reviewed && state === "changed" && diff === null) void markReviewed(detail);
	}, [detail, diff, markReviewed, reviewed, state]);

	const review = async () => {
		if (!detail) return;
		setBusy("review");
		await markReviewed(detail);
		setBusy(null);
		onToggleExpanded();
	};

	const setActive = async (enabled: boolean) => {
		setBusy("toggle");
		try {
			const response = await rpc.setSkillEnabled(skill.name, enabled);
			if (!response.success) throw new Error(response.error);
			await onChanged();
		} catch (cause) {
			toast({ variant: "error", message: describeError(cause) });
		} finally {
			setBusy(null);
		}
	};

	const save = async () => {
		if (!editing) return;
		setBusy("save");
		try {
			const response = await rpc.manageSkill({
				action: "update",
				name: skill.name,
				description: editing.description.trim(),
				body: editing.body,
			});
			if (!response.success) throw new Error(response.error);
			const fresh = await rpc.getSkillDetail(skill.name);
			if (fresh.success) {
				const next = fresh.data as RpcSkillDetail;
				setLoaded(next);
				// The person's own words are reviewed by definition.
				await markReviewed(next);
			}
			setEditing(null);
			await onChanged();
			toast({ variant: "success", message: t("memory.skills.saved") });
		} catch (cause) {
			toast({ variant: "error", message: describeError(cause) });
		} finally {
			setBusy(null);
		}
	};

	const remove = async () => {
		if (!arm("remove")) return;
		setBusy("remove");
		try {
			const response = await rpc.manageSkill({ action: "delete", name: skill.name });
			if (!response.success) throw new Error(response.error);
			await forget(skill.name);
			await onChanged();
			toast({ variant: "success", message: t("memory.skills.removed", { name: skill.name }) });
		} catch (cause) {
			toast({ variant: "error", message: describeError(cause) });
			setBusy(null);
		}
	};

	return (
		<li className={cx("omp-card overflow-hidden", !skill.enabled && "opacity-70")}>
			<div className="flex items-center gap-3 px-3.5 py-3">
				<button
					aria-expanded={expanded}
					className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
					onClick={onToggleExpanded}
					type="button"
				>
					<ChevronRight
						aria-hidden="true"
						className={cx(
							"mt-0.5 shrink-0 text-(--omp-dim) transition-transform duration-(--omp-motion-fast)",
							expanded && "rotate-90",
						)}
						size={14}
					/>
					<span className="min-w-0 flex-1">
						<span className="flex items-center gap-2">
							<span className="truncate font-mono text-omp-md text-(--omp-text)">{skill.name}</span>
							{state === "new" && <Badge variant="info">{t("memory.skills.new")}</Badge>}
							{state === "changed" && <Badge variant="warning">{t("memory.skills.changed")}</Badge>}
							{!skill.enabled && <Badge variant="muted">{t("memory.skills.off")}</Badge>}
						</span>
						<span className="mt-0.5 line-clamp-2 block text-omp-sm leading-snug text-(--omp-muted)">
							{skill.description}
						</span>
					</span>
				</button>
				{skill.modifiedAt !== undefined && (
					<span className="hidden shrink-0 text-omp-xs text-(--omp-dim) sm:block">
						{formatTimeAgo(iso(skill.modifiedAt))}
					</span>
				)}
				<Switch
					checked={skill.enabled}
					label={skill.enabled ? t("memory.skills.turnOff") : t("memory.skills.turnOn")}
					onChange={on => void setActive(on)}
				/>
			</div>

			{expanded && (
				<div className="border-t border-(--omp-border-muted) px-4 py-3.5">
					{loadError ? (
						<p className="text-omp-sm text-(--omp-warning)">{loadError}</p>
					) : !detail ? (
						<div className="flex justify-center py-4">
							<Spinner size="md" />
						</div>
					) : editing ? (
						<div className="flex flex-col gap-3" data-owns-escape="">
							<Input
								aria-label={t("memory.skills.description")}
								label={t("memory.skills.description")}
								onChange={event => setEditing({ ...editing, description: event.target.value })}
								onKeyDown={event => {
									if (!isImeKeyEvent(event) && event.key === "Escape") setEditing(null);
								}}
								value={editing.description}
							/>
							<TextArea
								aria-label={t("memory.skills.instructions")}
								autoGrow
								className="max-h-[40vh] min-h-40 overflow-y-auto text-omp-sm"
								label={t("memory.skills.instructions")}
								mono
								onChange={event => setEditing({ ...editing, body: event.target.value })}
								onKeyDown={event => {
									if (isImeKeyEvent(event)) return;
									if (event.key === "Escape") setEditing(null);
									if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
								}}
								value={editing.body}
							/>
							<div className="flex items-center gap-2">
								<Button
									disabled={!editing.description.trim() || !editing.body.trim()}
									icon={<Check size={12} />}
									loading={busy === "save"}
									onClick={() => void save()}
									size="sm"
									variant="primary"
								>
									{t("common.save")}
								</Button>
								<Button icon={<X size={12} />} onClick={() => setEditing(null)} size="sm" variant="ghost">
									{t("common.cancel")}
								</Button>
								<span className="ml-auto text-omp-xs text-(--omp-dim)">{t("memory.skills.editHint")}</span>
							</div>
						</div>
					) : (
						<div className="flex flex-col gap-3">
							{diff ? (
								<div className="flex flex-col gap-1.5">
									<p className="text-omp-xs text-(--omp-dim)">
										{t("memory.skills.diffCaption", {
											when: formatTimeAgo(iso(reviewed?.reviewedAt)),
										})}
									</p>
									<DiffView
										className="max-h-[42vh] overflow-y-auto rounded-lg"
										diff={diff}
										filePath="SKILL.md"
									/>
								</div>
							) : (
								<div className="max-h-[42vh] overflow-y-auto text-omp-sm">
									<MarkdownRenderer content={detail.body} />
								</div>
							)}
							<div className="flex items-center gap-2 border-t border-(--omp-border-muted) pt-3">
								{state !== "reviewed" && (
									<Button
										icon={<Check size={12} />}
										loading={busy === "review"}
										onClick={() => void review()}
										size="sm"
										variant="primary"
									>
										{t("memory.skills.looksGood")}
									</Button>
								)}
								<Button
									icon={<Pencil size={12} />}
									onClick={() => setEditing({ description: detail.description, body: detail.body })}
									size="sm"
									variant="secondary"
								>
									{t("common.edit")}
								</Button>
								<span className="flex-1" />
								<Button
									icon={armed ? undefined : <Trash2 size={12} />}
									loading={busy === "remove"}
									onClick={() => void remove()}
									size="sm"
									variant={armed ? "danger" : "ghost"}
								>
									{armed ? t("memory.skills.confirmRemove") : t("memory.skills.remove")}
								</Button>
							</div>
						</div>
					)}
				</div>
			)}
		</li>
	);
}

export function SkillsView({ open }: { open: boolean }) {
	const t = useT();
	const rpc = useTabRpc();
	const connected = useSessionStore(state => state.status === "ready");
	const learned = useSkillReviewStore(state => state.learned);
	const reviewed = useSkillReviewStore(state => state.reviewed);
	const hydrated = useSkillReviewStore(state => state.hydrated);
	const [autolearn, setAutolearn] = useState<boolean | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);

	const refresh = useCallback(() => refreshLearnedSkills(rpc), [rpc]);

	useEffect(() => {
		if (!open || !connected) return;
		void useSkillReviewStore.getState().hydrate();
		void refresh();
		void rpc
			.getSettings([AUTOLEARN])
			.then(response => {
				if (!response.success) return;
				const values = (response.data as { values?: Record<string, unknown> } | undefined)?.values;
				setAutolearn(values?.[AUTOLEARN] === true);
			})
			.catch(() => {});
	}, [connected, open, refresh, rpc]);

	const setAutolearnOn = async (on: boolean) => {
		setAutolearn(on);
		try {
			const response = await rpc.setSetting(AUTOLEARN, on);
			if (!response.success) throw new Error(response.error);
			setAutolearn((response.data as { value?: unknown } | undefined)?.value === true);
		} catch (cause) {
			setAutolearn(!on);
			toast({ variant: "error", message: describeError(cause) });
		}
	};

	const cards = useMemo(() => {
		if (!learned) return [];
		return learned
			.map(skill => ({ skill, state: skillReviewState(skill, reviewed[skill.name]) }))
			.sort(
				(a, b) =>
					STATE_ORDER[a.state] - STATE_ORDER[b.state] || (b.skill.modifiedAt ?? 0) - (a.skill.modifiedAt ?? 0),
			);
	}, [learned, reviewed]);
	const pending = cards.filter(card => card.state !== "reviewed").length;

	const reviewAll = async () => {
		for (const { skill, state } of cards) {
			if (state === "reviewed") continue;
			try {
				const response = await rpc.getSkillDetail(skill.name);
				if (response.success) await useSkillReviewStore.getState().markReviewed(response.data as RpcSkillDetail);
			} catch {
				// A skill that cannot be read stays unreviewed.
			}
		}
	};

	if (!connected) {
		return (
			<div className="flex h-full items-center justify-center gap-2 text-omp-sm text-(--omp-dim)">
				<Spinner size="sm" />
				{t("memory.connecting")}
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-5">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h2 className="text-omp-lg font-semibold text-(--omp-text)">{t("memory.skills.title")}</h2>
					<p className="mt-1 text-omp-sm leading-relaxed text-(--omp-muted)">{t("memory.skills.caption")}</p>
				</div>
				{pending > 1 && (
					<Button className="shrink-0" onClick={() => void reviewAll()} size="sm" variant="ghost">
						{t("memory.skills.reviewAll", { count: pending })}
					</Button>
				)}
			</div>

			<div className="omp-card">
				<Toggle
					checked={autolearn === true}
					description={t("memory.skills.autolearnHint")}
					disabled={autolearn === null}
					label={t("memory.skills.autolearn")}
					onChange={on => void setAutolearnOn(on)}
				/>
			</div>

			{!hydrated || learned === null ? (
				<div className="flex justify-center py-8">
					<Spinner size="md" />
				</div>
			) : cards.length === 0 ? (
				<div className="flex flex-col items-center gap-2 py-10 text-center">
					<Sparkles className="text-(--omp-dim)" size={20} />
					<p className="text-omp-md text-(--omp-text)">{t("memory.skills.emptyTitle")}</p>
					<p className="max-w-sm text-omp-sm text-(--omp-muted)">
						{autolearn ? t("memory.skills.emptyOn") : t("memory.skills.emptyOff")}
					</p>
				</div>
			) : (
				<ul className="flex flex-col gap-2">
					{cards.map(({ skill, state }) => (
						<SkillCard
							expanded={expanded === skill.name}
							key={skill.name}
							onChanged={refresh}
							onToggleExpanded={() => setExpanded(current => (current === skill.name ? null : skill.name))}
							reviewed={reviewed[skill.name]}
							skill={skill}
							state={state}
						/>
					))}
				</ul>
			)}
		</div>
	);
}
