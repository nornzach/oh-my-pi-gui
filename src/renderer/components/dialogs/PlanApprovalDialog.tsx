/**
 * Structured plan-approval dialog. The agent submits a plan by writing to
 * `xd://propose` while plan mode is active; the sidecar emits a
 * `plan_proposal` frame, silently stops the proposal turn, and waits for the
 * host's `plan_approval` answer. This dialog renders the proposal as
 * scrollable markdown with one approve button per advertised option:
 *
 * - execute      → planApproval(true, "execute")       (fresh session)
 * - compact      → planApproval(true, "compact")       (distill transcript first)
 * - keep_context → planApproval(true, "keep_context")  (intact transcript)
 * - refine       → planApproval(false, undefined, feedback) (re-plan with feedback)
 * - dismiss/Esc  → planApproval(false)                 (plain reject)
 *
 * Mirrors the TUI plan-review overlay ("Approve and execute" / "Approve and
 * compact context" / "keep context" / "Refine plan"). Zero props and
 * self-subscribing — mount once in App.
 */

import { ClipboardList, History, ListCollapse, Play, Save, Send } from "lucide-react";
import type { ReactNode } from "react";
import { usePlanApproval } from "../../hooks/use-plan-approval";
import { basename } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import {
	type PlanApprovalOption,
	type PlanApprovalSubmitState,
	usePlanApprovalStore,
} from "../../stores/plan-approval";
import { useSessionStore } from "../../stores/session";
import { settleTabPlanApproval, useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { Button, Modal, TextArea } from "../common";

type SubmitKind = PlanApprovalSubmitState["kind"];

/** Wire result of the `plan_approval` command (RpcPlanApprovalResult). */
interface PlanApprovalResult {
	approved: boolean;
	dispatched: boolean;
	reason?: string;
	savedPath?: string;
	freshSessionStarted?: boolean;
}

const APPROVE_CHOICES: Record<PlanApprovalOption, { labelKey: string; hintKey: string; icon: ReactNode }> = {
	execute: {
		labelKey: "planApproval.approve.execute.label",
		hintKey: "planApproval.approve.execute.hint",
		icon: <Play size={12} />,
	},
	compact: {
		labelKey: "planApproval.approve.compact.label",
		hintKey: "planApproval.approve.compact.hint",
		icon: <ListCollapse size={12} />,
	},
	keep_context: {
		labelKey: "planApproval.approve.keepContext.label",
		hintKey: "planApproval.approve.keepContext.hint",
		icon: <History size={12} />,
	},
	save: {
		labelKey: "planApproval.approve.save.label",
		hintKey: "planApproval.approve.save.hint",
		icon: <Save size={12} />,
	},
};

/** Approve buttons from the advertised options; falls back to execute when none are recognizable. */
function approveOptionsOf(options: string[]): PlanApprovalOption[] {
	const known = options.filter(
		(option): option is PlanApprovalOption =>
			option === "execute" || option === "compact" || option === "keep_context" || option === "save",
	);
	return known.length > 0 ? known : ["execute"];
}

export function PlanApprovalDialog() {
	// Self-contained: mounting this component also subscribes to plan_proposal events.
	usePlanApproval();
	const t = useT();
	const pending = usePlanApprovalStore(state => state.pending);
	const feedback = usePlanApprovalStore(state => state.feedback);
	const setFeedback = usePlanApprovalStore(state => state.setFeedback);
	const notice = usePlanApprovalStore(state => state.notice);
	const submitting = usePlanApprovalStore(state => state.submitting);
	const setSubmitting = usePlanApprovalStore(state => state.setSubmitting);

	if (!pending) return null;

	const respond = async (kind: SubmitKind, option?: PlanApprovalOption) => {
		if (submitting !== null) return;
		const target = pending;
		const originTabId = useTabsStore.getState().activeTabId;
		const originSessionId = useSessionStore.getState().sessionId;
		const trimmed = feedback.trim();
		const savePath =
			kind === "approve" && option === "save"
				? await window.omp.system.showSaveDialog(
						`${useSessionStore.getState().cwd}/${target.suggestedFileName ?? basename(target.planFilePath)}`,
						[{ name: "Markdown", extensions: ["md"] }],
					)
				: undefined;
		if (option === "save" && !savePath) return;
		setSubmitting(kind === "approve" ? { kind, option } : { kind });
		try {
			const response =
				kind === "approve"
					? option === "save"
						? await window.omp.rpc.planApproval(true, option, undefined, savePath ?? undefined)
						: await window.omp.rpc.planApproval(true, option)
					: kind === "refine"
						? await window.omp.rpc.planApproval(false, undefined, trimmed)
						: await window.omp.rpc.planApproval(false);
			if (!response.success) {
				settleTabPlanApproval(originTabId, originSessionId, target, { submitting: null });
				toast({ variant: "error", title: t("planApproval.failed"), message: response.error });
				return;
			}
			const result = response.data as PlanApprovalResult | null | undefined;
			if (option === "save" && result?.savedPath) {
				settleTabPlanApproval(originTabId, originSessionId, target, { clear: true, exitPlanMode: true });
				toast({
					variant: result.freshSessionStarted === false ? "warning" : "success",
					message:
						result.freshSessionStarted === false
							? t("planApproval.savedWithoutFresh", {
									path: result.savedPath,
									reason: result.reason ?? t("common.unknownError"),
								})
							: t("planApproval.saved", { path: result.savedPath }),
				});
				return;
			}
			if (result && !result.dispatched) {
				if (kind === "approve") {
					// Approval stands but nothing was dispatched (e.g. compaction
					// failed) — surface the reason and stay open so the host can
					// pick another option.
					settleTabPlanApproval(originTabId, originSessionId, target, {
						exitPlanMode: true,
						notice: result.reason ?? t("planApproval.notDispatched"),
						submitting: null,
					});
					return;
				}
				// Plain reject / empty refine: resolved with nothing dispatched.
				settleTabPlanApproval(originTabId, originSessionId, target, { clear: true });
				return;
			}
			settleTabPlanApproval(originTabId, originSessionId, target, {
				clear: true,
				exitPlanMode: kind === "approve",
			});
			toast({
				variant: "success",
				message:
					kind === "approve"
						? t("planApproval.approved")
						: kind === "refine"
							? t("planApproval.refined")
							: t("planApproval.dismissed"),
			});
		} catch (cause) {
			settleTabPlanApproval(originTabId, originSessionId, target, { submitting: null });
			toast({ variant: "error", title: t("planApproval.failed"), message: String(cause) });
		}
	};

	// Esc, backdrop click, and the X button all answer planApproval(false).
	const requestDismiss = () => {
		if (submitting !== null) return;
		void respond("dismiss");
	};

	const approveOptions = approveOptionsOf(pending.options);
	const showRefine = pending.options.length === 0 || pending.options.includes("refine");
	const busy = submitting !== null;

	return (
		<Modal
			onClose={requestDismiss}
			open
			size="lg"
			title={
				<span className="flex items-center gap-2">
					<ClipboardList className="shrink-0 text-(--omp-accent)" size={14} />
					{pending.title ?? t("planApproval.reviewFallback")}
				</span>
			}
		>
			<div className="flex flex-col gap-3 p-4">
				<div className="flex items-center gap-2 text-omp-xs text-(--omp-dim)">
					<span className="shrink-0">{t("planApproval.planFile")}</span>
					<span className="truncate font-mono" title={pending.planFilePath}>
						{basename(pending.planFilePath)}
					</span>
				</div>
				<div className="max-h-[52vh] overflow-y-auto rounded-md border border-(--omp-border-muted) px-4 py-3">
					{pending.planContent.trim().length > 0 ? (
						<MarkdownRenderer content={pending.planContent} />
					) : (
						<p className="text-xs text-(--omp-dim)">{t("planApproval.emptyPlan")}</p>
					)}
				</div>
				{notice !== null && (
					<div className="rounded-md border border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] bg-transparent px-3 py-2 text-omp-sm text-(--omp-warning)">
						{notice}
					</div>
				)}
				{showRefine && (
					<TextArea
						autoGrow
						disabled={busy}
						hint={t("planApproval.refineHint")}
						label={t("planApproval.refineLabel")}
						maxLength={8000}
						onChange={event => setFeedback(event.target.value)}
						placeholder={t("planApproval.refinePlaceholder")}
						rows={2}
						value={feedback}
					/>
				)}
				<div className="flex flex-wrap items-center justify-end gap-2">
					<Button onClick={requestDismiss} size="sm" variant="ghost">
						{t("planApproval.dismiss")}
					</Button>
					{showRefine && (
						<Button
							disabled={busy || feedback.trim().length === 0}
							icon={<Send size={12} />}
							loading={submitting?.kind === "refine"}
							onClick={() => void respond("refine")}
							size="sm"
							title={t("planApproval.refineTitle")}
							variant="secondary"
						>
							{t("planApproval.refine")}
						</Button>
					)}
					{approveOptions.map((option, index) => {
						const choice = APPROVE_CHOICES[option];
						return (
							<Button
								disabled={busy}
								icon={choice.icon}
								key={option}
								loading={submitting?.kind === "approve" && submitting.option === option}
								onClick={() => void respond("approve", option)}
								size="sm"
								title={t(choice.hintKey)}
								variant={index === 0 ? "primary" : "secondary"}
							>
								{t(choice.labelKey)}
							</Button>
						);
					})}
				</div>
			</div>
		</Modal>
	);
}
