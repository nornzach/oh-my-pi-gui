/**
 * Plan dock card: plan-mode status + review rendered as a live card in the
 * center dock above the composer (previously the workspace drawer's plan
 * tab). Visible only while plan mode is enabled — the composer mode chips
 * carry the on/off affordance otherwise.
 *
 * The plan document is read from disk through the `fs:read-plan` main-process
 * IPC — kept OFF the RPC bus so the streaming poll never injects the plan
 * into the model context or appends bashExecution entries to the transcript.
 * Resolution mirrors the agent: `local://` lands in `<session file minus
 * .jsonl>/local/<name>`, absolute paths pass through, anything else resolves
 * against the session cwd; when the configured path is absent the main
 * process falls back to the newest `*plan.md` in the local root.
 *
 * Structured plan approval (the TUI's `xd://propose` popup with its three
 * execute options) is NOT installed by the RPC host — approve / request
 * changes here send prompt/steer messages instead, and the footer says so.
 */

import { CheckCircle2, Circle, ClipboardList, FileWarning, MessageSquare, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanModeState } from "../../../../shared/rpc-types";
import { useTabGuard } from "../../../hooks/use-tab-guard";
import { describeError } from "../../../lib/errors";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { type TabRpc, useTabRpc } from "../../../lib/tab-rpc";
import { type SessionStore, useSessionStore } from "../../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../../stores/session-runtime-context";
import { toast } from "../../../stores/toast";
import { Badge, Button, Spinner, Tabs, TextArea } from "../../common";
import { DockCard } from "./DockCard";

const POLL_STREAMING_MS = 3000;

interface ResolvedPlanPath {
	fsPath: string;
	/** Session-local root (`<artifacts>/local`) when the plan lives under `local://`. */
	localRoot: string | null;
}

/**
 * Mirror of the agent-side `readPlanFile` resolution: `local://` URLs land in
 * `<sessionFile minus .jsonl>/local/`, absolute paths pass through, anything
 * else resolves against the session cwd. Returns null when a `local://` path
 * cannot be resolved because the session has no file on disk yet.
 */
function resolvePlanFsPath(planFilePath: string, sessionFile: string | null, cwd: string): ResolvedPlanPath | null {
	if (planFilePath.startsWith("local:")) {
		if (!sessionFile?.endsWith(".jsonl")) return null;
		const name = planFilePath.replace(/^local:\/+/, "");
		if (!name) return null;
		const localRoot = `${sessionFile.slice(0, -".jsonl".length)}/local`;
		return { fsPath: `${localRoot}/${name}`, localRoot };
	}
	if (planFilePath.startsWith("/")) return { fsPath: planFilePath, localRoot: null };
	if (!cwd) return null;
	return { fsPath: `${cwd.replace(/\/+$/, "")}/${planFilePath}`, localRoot: null };
}

interface PlanStep {
	index: number;
	text: string;
	done: boolean;
	/** True when the source line was a `- [ ]` / `- [x]` checklist item. */
	checkbox: boolean;
}

interface PlanSection {
	heading: string | null;
	steps: PlanStep[];
}

/** Extract ordered steps (checkboxes, numbered and bulleted items) grouped under their headings. */
function parsePlanSections(markdown: string): PlanSection[] {
	const sections: PlanSection[] = [];
	let current: PlanSection = { heading: null, steps: [] };
	let ordinal = 0;
	const pushCurrent = () => {
		if (current.steps.length > 0) sections.push(current);
	};
	for (const line of markdown.split("\n")) {
		const heading = /^#{1,6}\s+(.+)$/.exec(line);
		if (heading) {
			pushCurrent();
			current = { heading: heading[1].trim(), steps: [] };
			continue;
		}
		const checkbox = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
		const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
		const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
		const text = (checkbox?.[2] ?? numbered?.[1] ?? bullet?.[1])?.trim();
		if (text) {
			ordinal += 1;
			current.steps.push({
				index: ordinal,
				text,
				done: checkbox ? checkbox[1].toLowerCase() === "x" : false,
				checkbox: checkbox != null,
			});
		}
	}
	pushCurrent();
	return sections;
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Deliver review feedback to the agent: steer mid-turn, prompt when idle. */
async function sendPlanMessage(
	message: string,
	t: (key: string) => string,
	rpc: TabRpc,
	streaming: boolean,
): Promise<boolean> {
	const response = streaming ? await rpc.steer(message) : await rpc.prompt(message);
	if (!response.success) {
		toast({ variant: "error", title: t("planPanel.feedbackFailed"), message: response.error });
		return false;
	}
	return true;
}

interface StepFeedbackState {
	step: PlanStep;
	draft: string;
	sending: boolean;
}

export function PlanDockCard() {
	const t = useT();
	const rpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const sessionStore = sessionRuntimeStore<SessionStore>(tabId, "session");
	const { capture, isActive } = useTabGuard();
	const planModeEnabled = useSessionStore(s => s.planModeEnabled);
	const isStreaming = useSessionStore(s => s.isStreaming);
	const [planFilePath, setPlanFilePath] = useState<string | null>(null);
	const [planFile, setPlanFile] = useState<string | null>(null);
	const [localRoot, setLocalRoot] = useState<string | null>(null);
	const [content, setContent] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [toggling, setToggling] = useState(false);
	const [tab, setTab] = useState<"steps" | "raw">("steps");
	const [approving, setApproving] = useState(false);
	const [planFeedback, setPlanFeedback] = useState("");
	const [sendingPlan, setSendingPlan] = useState(false);
	const [stepFeedback, setStepFeedback] = useState<StepFeedbackState | null>(null);

	const load = useCallback(
		async (options?: { quiet?: boolean }) => {
			const origin = capture();
			if (!origin) return;
			const quiet = options?.quiet === true;
			if (!quiet) setLoading(true);
			if (!quiet) setError(null);
			try {
				const modeResponse = await rpc.getPlanMode();
				if (!isActive(origin)) return;
				if (!modeResponse.success) {
					if (!quiet) setError(modeResponse.error);
					return;
				}
				const mode = modeResponse.data as PlanModeState | undefined;
				const path = mode?.planFilePath ?? null;
				setPlanFilePath(path);
				if (!mode?.enabled || !path) {
					setPlanFile(null);
					setLocalRoot(null);
					setContent(null);
					return;
				}
				const { sessionFile, cwd } = sessionStore?.getState() ?? { sessionFile: null, cwd: "" };
				const resolved = resolvePlanFsPath(path, sessionFile, cwd);
				if (!resolved) {
					setPlanFile(null);
					setLocalRoot(null);
					setContent(null);
					if (!quiet) setError(t("planPanel.noFsPath"));
					return;
				}
				const response = await window.omp.fs.readPlan({
					fsPath: resolved.fsPath,
					localRoot: resolved.localRoot,
					tabId: tabId ?? undefined,
				});
				if (!isActive(origin)) return;
				setLocalRoot(resolved.localRoot);
				if (!response.ok) {
					if (!quiet) setError(describeError(response.error));
					return;
				}
				if (response.path == null || response.content == null) {
					setPlanFile(null);
					setContent(null);
					return;
				}
				setPlanFile(response.path);
				setContent(response.content);
			} catch (cause) {
				if (isActive(origin) && !quiet) setError(describeError(cause));
			} finally {
				if (isActive(origin)) {
					setLoading(false);
					setLoaded(true);
				}
			}
		},
		[capture, isActive, rpc, t, sessionStore, tabId],
	);

	// Initial load + reset when plan mode flips.
	useEffect(() => {
		if (planModeEnabled) {
			void load();
		} else {
			setPlanFilePath(null);
			setPlanFile(null);
			setLocalRoot(null);
			setContent(null);
			setError(null);
			setLoaded(false);
			setStepFeedback(null);
		}
	}, [planModeEnabled, load]);

	// The agent writes the plan during its turn — refresh when a turn ends…
	const wasStreaming = useRef(isStreaming);
	useEffect(() => {
		const finished = wasStreaming.current && !isStreaming;
		wasStreaming.current = isStreaming;
		if (finished && planModeEnabled) void load({ quiet: true });
	}, [isStreaming, planModeEnabled, load]);

	// …and poll quietly while the planning turn streams so edits surface live.
	useEffect(() => {
		if (!isStreaming || !planModeEnabled) return;
		const timer = setInterval(() => void load({ quiet: true }), POLL_STREAMING_MS);
		return () => clearInterval(timer);
	}, [isStreaming, planModeEnabled, load]);

	const togglePlanMode = useCallback(async () => {
		const next = !(sessionStore?.getState().planModeEnabled ?? false);
		const origin = capture();
		if (!origin) return;
		setToggling(true);
		try {
			const response = await rpc.setPlanMode(next);
			if (!isActive(origin)) return; // switched tabs/sessions mid-request: never write A's result into B
			if (!response.success) {
				toast({ variant: "error", title: t("planPanel.toggleFailed"), message: response.error });
				return;
			}
			const mode = response.data as PlanModeState | undefined;
			const enabled = mode?.enabled ?? next;
			sessionStore?.setState({ planModeEnabled: enabled });
			if (enabled) void load();
		} finally {
			setToggling(false);
		}
	}, [isActive, capture, load, rpc, t, sessionStore]);

	/** `local://<name>` when the file lives in the session-local root (how the agent refers to it). */
	const displayPath = useMemo(() => {
		if (planFile && localRoot && planFile.startsWith(`${localRoot}/`)) {
			return `local://${planFile.slice(localRoot.length + 1)}`;
		}
		return planFile ?? planFilePath;
	}, [planFile, localRoot, planFilePath]);

	const approve = useCallback(async () => {
		setApproving(true);
		try {
			const target = displayPath ?? t("planPanel.fallbackTarget");
			const ok = await sendPlanMessage(t("planPanel.approveMessage", { target }), t, rpc, isStreaming);
			if (ok) toast({ variant: "success", message: t("planPanel.approvalSent") });
		} finally {
			setApproving(false);
		}
	}, [displayPath, rpc, t, isStreaming]);

	const requestChanges = useCallback(async () => {
		const text = planFeedback.trim();
		if (!text) return;
		setSendingPlan(true);
		try {
			const target = displayPath ?? t("planPanel.fallbackTarget");
			const ok = await sendPlanMessage(
				t("planPanel.reviseMessage", { target, feedback: text }),
				t,
				rpc,
				isStreaming,
			);
			if (ok) setPlanFeedback("");
		} finally {
			setSendingPlan(false);
		}
	}, [planFeedback, displayPath, rpc, t, isStreaming]);

	const submitStepFeedback = useCallback(async () => {
		if (!stepFeedback) return;
		const text = stepFeedback.draft.trim();
		if (!text) return;
		setStepFeedback({ ...stepFeedback, sending: true });
		const target = displayPath ?? "the plan";
		const ok = await sendPlanMessage(
			`Feedback on plan step ${stepFeedback.step.index} — “${truncate(stepFeedback.step.text, 80)}” (${target}):\n${text}`,
			t,
			rpc,
			isStreaming,
		);
		if (ok) setStepFeedback(null);
		else setStepFeedback({ ...stepFeedback, sending: false });
	}, [stepFeedback, displayPath, rpc, t, isStreaming]);

	const sections = useMemo(() => parsePlanSections(content ?? ""), [content]);
	const stepCount = useMemo(() => sections.reduce((n, section) => n + section.steps.length, 0), [sections]);
	const doneCount = useMemo(
		() => sections.reduce((n, section) => n + section.steps.filter(step => step.done).length, 0),
		[sections],
	);
	const hasChecklist = useMemo(() => sections.some(s => s.steps.some(step => step.checkbox)), [sections]);

	const reviewable = planModeEnabled && content != null && content.trim().length > 0;

	if (!planModeEnabled) return null;

	return (
		<DockCard
			actions={
				<span className="flex shrink-0 items-center gap-1.5">
					<button
						aria-label={t("planPanel.refresh")}
						className={cx(
							"omp-pressable text-(--omp-dim) transition-colors hover:text-(--omp-text)",
							loading && "animate-spin",
						)}
						disabled={loading}
						onClick={() => void load()}
						title={t("planPanel.refreshHint")}
						type="button"
					>
						<RefreshCw size={12} />
					</button>
					<button
						aria-checked={planModeEnabled}
						aria-label={t("planPanel.toggle")}
						className={cx(
							"relative h-4 w-7 shrink-0 rounded-full border transition-colors duration-150",
							planModeEnabled
								? "border-transparent bg-(--omp-accent)"
								: "border-(--omp-border-muted) bg-(--omp-bg-primary)", // surface-ok: toggle switch track (unchecked state)
							toggling && "opacity-50",
						)}
						disabled={toggling}
						onClick={() => void togglePlanMode()}
						role="switch"
						title={t("planPanel.exit")}
						type="button"
					>
						<span
							className={cx(
								"absolute top-1/2 left-0.5 size-3 -translate-y-1/2 rounded-full transition-transform duration-150",
								planModeEnabled ? "translate-x-3 bg-white" : "translate-x-0 bg-(--omp-muted)",
							)}
						/>
					</button>
				</span>
			}
			badge={
				<span className="flex shrink-0 items-center gap-1.5">
					{stepCount > 0 && (
						<span className="text-omp-xs tabular-nums text-[var(--omp-dim)]">
							{hasChecklist ? `${doneCount}/${stepCount}` : stepCount}
						</span>
					)}
					<Badge dot pulse={isStreaming} variant="success">
						{t("planPanel.badge.on")}
					</Badge>
				</span>
			}
			icon={ClipboardList}
			id="plan"
			title={t("dock.plan")}
		>
			{loading && !loaded ? (
				<div className="flex items-center justify-center py-6">
					<Spinner />
				</div>
			) : error ? (
				<div className="flex flex-col items-center justify-center gap-2 px-6 py-4 text-center">
					<FileWarning className="text-(--omp-warning)" size={20} />
					<div className="text-omp-sm leading-snug text-(--omp-muted)">{error}</div>
					<Button onClick={() => void load()} size="sm">
						{t("planPanel.retry")}
					</Button>
				</div>
			) : content == null ? (
				<div className="flex flex-col items-center justify-center gap-2 px-6 py-4 text-center">
					<ClipboardList className="text-(--omp-dim)" size={20} />
					<div className="text-omp-xs text-(--omp-muted)">{t("planPanel.emptyTitle")}</div>
					<div className="text-omp-sm leading-snug text-(--omp-dim)">
						{t("planPanel.emptyDescPre")}
						<span className="font-mono">local://&lt;slug&gt;-plan.md</span>
						{t("planPanel.emptyDescPost")}
					</div>
					{displayPath && (
						<div className="max-w-full truncate font-mono text-omp-xs text-(--omp-dim)" title={displayPath}>
							{displayPath}
						</div>
					)}
				</div>
			) : (
				<>
					<Tabs
						activeId={tab}
						ariaLabel={t("planPanel.tabsAria")}
						className="mx-2 mt-2"
						compact
						onChange={id => setTab(id as "steps" | "raw")}
						tabs={[
							{ id: "steps", label: t("planPanel.tabs.steps"), badge: stepCount > 0 ? stepCount : undefined },
							{ id: "raw", label: t("planPanel.tabs.raw") },
						]}
					/>
					<div className="px-2 py-1.5">
						{tab === "raw" ? (
							<pre className="font-mono text-omp-sm leading-relaxed whitespace-pre-wrap text-(--omp-text)">
								{content}
							</pre>
						) : sections.length === 0 ? (
							<div className="px-2 py-4 text-center text-omp-sm text-(--omp-dim)">
								{content.trim().length === 0 ? t("planPanel.emptySoFar") : t("planPanel.noSteps")}
							</div>
						) : (
							<>
								{hasChecklist && (
									<div className="px-1 pb-1 text-omp-xs tabular-nums text-(--omp-dim)">
										{t("planPanel.checked", { done: doneCount, total: stepCount })}
									</div>
								)}
								{sections.map((section, sectionIndex) => (
									<section className="mb-1.5" key={sectionIndex}>
										{section.heading && (
											<div className="truncate px-1 py-1 text-omp-sm font-semibold text-(--omp-accent)">
												{section.heading}
											</div>
										)}
										<div className="ml-1 border-l border-(--omp-border-muted) pl-2">
											{section.steps.map(step => (
												<div key={step.index}>
													<div className="group flex items-start gap-1.5 rounded-sm py-1 pr-1 hover:bg-(--omp-bg-tertiary)">
														{step.checkbox ? (
															step.done ? (
																<CheckCircle2
																	className="mt-px shrink-0 text-(--omp-success)"
																	size={13}
																/>
															) : (
																<Circle className="mt-px shrink-0 text-(--omp-dim)" size={13} />
															)
														) : (
															<span className="w-4 shrink-0 pt-px text-right text-omp-xs tabular-nums text-(--omp-dim)">
																{step.index}
															</span>
														)}
														<span
															className={cx(
																"min-w-0 flex-1 text-omp-xs leading-snug",
																step.done ? "text-(--omp-muted) line-through" : "text-(--omp-text)",
															)}
														>
															{step.text}
														</span>
														<button
															aria-label={t("planPanel.stepFeedbackAria", { index: step.index })}
															className="mt-px shrink-0 text-(--omp-dim) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--omp-text)"
															onClick={() => setStepFeedback({ step, draft: "", sending: false })}
															title={t("planPanel.stepFeedbackHint")}
															type="button"
														>
															<MessageSquare size={11} />
														</button>
													</div>
													{stepFeedback?.step.index === step.index && (
														<div className="mb-1 rounded border border-(--omp-border-muted) bg-transparent p-1.5">
															<TextArea
																autoFocus
																onChange={event =>
																	setStepFeedback({ ...stepFeedback, draft: event.target.value })
																}
																placeholder={t("planPanel.stepFeedbackPlaceholder", {
																	index: step.index,
																})}
																rows={2}
																value={stepFeedback.draft}
															/>
															<div className="mt-1 flex gap-1">
																<Button
																	disabled={!stepFeedback.draft.trim()}
																	icon={<Send size={11} />}
																	loading={stepFeedback.sending}
																	onClick={() => void submitStepFeedback()}
																	size="sm"
																	variant="primary"
																>
																	{t("planPanel.send")}
																</Button>
																<Button onClick={() => setStepFeedback(null)} size="sm" variant="ghost">
																	{t("common.cancel")}
																</Button>
															</div>
														</div>
													)}
												</div>
											))}
										</div>
									</section>
								))}
							</>
						)}
					</div>

					{/* Review footer: approve / request changes, all as chat messages. */}
					<div className="shrink-0 border-t border-(--omp-border-muted) p-2">
						<TextArea
							disabled={!reviewable}
							onChange={event => setPlanFeedback(event.target.value)}
							placeholder={t("planPanel.feedbackPlaceholder")}
							rows={2}
							value={planFeedback}
						/>
						<div className="mt-1.5 flex items-center gap-1.5">
							<Button
								disabled={!reviewable}
								icon={<CheckCircle2 size={12} />}
								loading={approving}
								onClick={() => void approve()}
								size="sm"
								variant="primary"
							>
								{t("planPanel.approve")}
							</Button>
							<Button
								disabled={!reviewable || !planFeedback.trim()}
								loading={sendingPlan}
								onClick={() => void requestChanges()}
								size="sm"
							>
								{t("planPanel.requestChanges")}
							</Button>
						</div>
						<div className="mt-1.5 text-omp-xs leading-snug text-(--omp-dim)">{t("planPanel.footerNote")}</div>
					</div>
				</>
			)}
		</DockCard>
	);
}
