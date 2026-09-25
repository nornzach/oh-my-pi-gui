/**
 * Modes window: Vibe / Goal / Loop session modes, backed by the mode RPCs
 * (get/set_vibe_mode, get/set_goal, get/set_loop_mode) plus live sidecar
 * events (`goal_updated` → silent re-fetch, `loop_mode_update` → applied in
 * place).
 *
 * Each tab lazy-loads on first view, then silently revalidates whenever it is
 * re-activated. Mutations keep the confirmed value while pending. A successful response
 * supplies the effective value; failures remain visible and preserve the last
 * confirmed state.
 *
 * Parent wiring (parent-owned files): mount once beside the other windows and
 * drive it from a ui-store flag + command-registry entry; deep-link a tab via:
 *   <ModesPanel open={modesOpen} onClose={closeModes} initialTab="goal" />
 */

import { RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	AgentSessionEvent,
	RpcGoalState,
	RpcLoopModeState,
	RpcResponse,
	RpcVibeModeState,
} from "../../../shared/rpc-types";
import { formatDuration, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { loopLimitText, normalizeLoopUpdate, parseLoopLimit } from "../../lib/loop-mode";
import { acceptsActiveTabEvents } from "../../lib/tab-routing";
import { type TabRpc, useTabRpc } from "../../lib/tab-rpc";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { toast } from "../../stores/toast";
import {
	Badge,
	type BadgeVariant,
	Button,
	Input,
	Modal,
	ProgressBar,
	Spinner,
	type TabItem,
	Tabs,
	TextArea,
} from "../common";

export interface ModesPanelProps {
	open: boolean;
	onClose: () => void;
	/** Deep-link a specific tab on open (defaults to "vibe"). */
	initialTab?: ModesTabId;
}

export type ModesTabId = "vibe" | "goal" | "loop";

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface ModeRpc<T> {
	state: T | null;
	error: string | null;
	loading: boolean;
	/** A mutation is in flight (inputs disable while it settles). */
	busy: boolean;
	/** The attached sidecar can accept reads and mutations. */
	ready: boolean;
	/** Loud re-fetch: spinner while loading, inline error on failure. */
	refresh: () => void;
	/** Silent re-fetch: updates state on success, leaves the UI alone on failure. */
	sync: () => void;
	/** Apply an event payload directly. */
	apply: (next: T) => void;
	/** Apply only confirmed state from the originating session. */
	mutate: (action: (client: TabRpc) => Promise<RpcResponse>) => Promise<void>;
}

const fetchVibeMode = (client: TabRpc): Promise<RpcResponse> => client.getVibeMode();
const pickVibeMode = (data: unknown): RpcVibeModeState => (data as RpcVibeModeState | undefined) ?? { enabled: false };
const fetchGoal = (client: TabRpc): Promise<RpcResponse> => client.getGoal();
const pickGoal = (data: unknown): RpcGoalState =>
	(data as RpcGoalState | undefined) ?? { enabled: false, status: "none" };
const fetchLoopMode = (client: TabRpc): Promise<RpcResponse> => client.getLoopMode();
const pickLoopMode = (data: unknown): RpcLoopModeState =>
	(data as RpcLoopModeState | undefined) ?? { enabled: false, state: "off" };

/**
 * Lazy per-tab mode loader: fires on the tab's first activation, then silently
 * revalidates on re-activation. Errors surface inline with a Retry button.
 */
function useModeRpc<T>(
	open: boolean,
	active: boolean,
	fetcher: (client: TabRpc) => Promise<RpcResponse>,
	pick: (data: unknown) => T,
	onConfirmed?: (state: T) => void,
): ModeRpc<T> {
	const t = useT();
	const client = useTabRpc();
	const sidecarReady = useSessionStore(s => s.status) === "ready";
	const generation = useRef(0);
	const sessionId = useSessionStore(s => s.sessionId);
	const [state, setState] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const attemptedRef = useRef(false);

	/** One confirmed state value for loading, events and mutations. */
	const setBoth = useCallback(
		(next: T | null) => {
			setState(next);
			if (next !== null) onConfirmed?.(next);
		},
		[onConfirmed],
	);

	const load = useCallback(
		async (silent: boolean) => {
			const version = ++generation.current;
			if (!sidecarReady) {
				setError(t("modesPanel.notConnected"));
				setLoading(false);
				return;
			}
			if (!silent) {
				setLoading(true);
				setError(null);
			}
			try {
				const res = await fetcher(client);
				if (version !== generation.current) return;
				if (res.success) {
					setBoth(pick(res.data));
					if (!silent) setError(null);
				} else {
					setError(res.error);
				}
			} catch (cause) {
				if (version === generation.current) setError(String(cause));
			} finally {
				if (version === generation.current) setLoading(false);
			}
		},
		[sidecarReady, client, fetcher, pick, t, setBoth],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on runtime or session replacement even before a request starts.
	useEffect(() => {
		generation.current++;
		attemptedRef.current = false;
		setState(null);
		setError(null);
		setBusy(false);
		return () => {
			generation.current++;
		};
	}, [client, sessionId]);

	// First activation loads loudly; later re-activations silently revalidate.
	// biome-ignore lint/correctness/useExhaustiveDependencies: an in-place session replacement needs a fresh read.
	useEffect(() => {
		if (!open || !active) return;
		if (attemptedRef.current) {
			void load(true);
		} else {
			attemptedRef.current = true;
			void load(false);
		}
	}, [open, active, load, sessionId]);

	const refresh = useCallback(() => void load(false), [load]);
	const sync = useCallback(() => void load(true), [load]);
	const apply = useCallback(
		(next: T) => {
			generation.current++;
			setBusy(false);
			setLoading(false);
			setBoth(next);
		},
		[setBoth],
	);

	const mutate = useCallback(
		async (action: (client: TabRpc) => Promise<RpcResponse>) => {
			if (!sidecarReady) {
				setError(t("modesPanel.notConnected"));
				return;
			}
			const version = ++generation.current;
			setBusy(true);
			setError(null);
			try {
				const res = await action(client);
				if (!res.success) throw new Error(res.error);
				const settled = res.data == null ? await fetcher(client) : res;
				if (version !== generation.current) return;
				if (!settled.success) throw new Error(settled.error);
				setBoth(pick(settled.data));
			} catch (cause) {
				if (version !== generation.current) return;
				setError(String(cause));
				toast({ variant: "error", title: t("modesPanel.actionFailed"), message: String(cause) });
			} finally {
				if (version === generation.current) setBusy(false);
			}
		},
		[client, fetcher, pick, sidecarReady, t, setBoth],
	);

	useEffect(
		() => () => {
			generation.current++;
		},
		[],
	);

	return { state, error, loading, busy, ready: sidecarReady, refresh, sync, apply, mutate };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Loop run-state → badge color (running pulses, off dims). */
export const LOOP_STATE_VARIANT: Record<RpcLoopModeState["state"], BadgeVariant> = {
	off: "muted",
	waiting: "info",
	running: "success",
	paused: "warning",
};

const GOAL_STATUS_KEY: Record<string, string> = {
	active: "modesPanel.goal.statusValue.active",
	paused: "modesPanel.goal.statusValue.paused",
	"budget-limited": "modesPanel.goal.statusValue.budgetLimited",
	complete: "modesPanel.goal.statusValue.complete",
	dropped: "modesPanel.goal.statusValue.dropped",
};

/** Goal status → badge color (unknown statuses fall back to muted + raw text). */
export function goalStatusVariant(status: string | undefined): BadgeVariant {
	switch (status) {
		case "active":
			return "success";
		case "paused":
			return "warning";
		case "budget-limited":
			return "error";
		case "complete":
			return "info";
		default:
			return "muted";
	}
}

function goalStatusLabel(t: (key: string) => string, status: string | undefined): string {
	if (!status) return "—";
	const key = GOAL_STATUS_KEY[status];
	return key ? t(key) : status;
}

// ---------------------------------------------------------------------------
// Shared frame: refresh toolbar + loading/error states
// ---------------------------------------------------------------------------

interface ModeFrameProps {
	loading: boolean;
	loaded: boolean;
	error: string | null;
	ready: boolean;
	onRefresh: () => void;
	children: ReactNode;
}

function ModeFrame({ loading, loaded, error, ready, onRefresh, children }: ModeFrameProps) {
	const t = useT();

	let body: ReactNode = null;
	if (!loaded) {
		if (loading) {
			body = (
				<div className="m-auto">
					<Spinner label={t("common.loading")} />
				</div>
			);
		} else if (error) {
			body = (
				<div className="m-auto flex max-w-md flex-col items-center gap-2 rounded-lg border border-(--omp-border-muted) px-4 py-6 text-center">
					<span className="text-omp-md font-medium text-(--omp-error)">{t("modesPanel.loadFailed")}</span>
					<span className="text-omp-sm break-all text-(--omp-dim)">{error}</span>
					<Button
						disabled={!ready}
						icon={<RefreshCw size={12} />}
						onClick={onRefresh}
						size="sm"
						title={!ready ? t("modesPanel.notConnected") : undefined}
						variant="secondary"
					>
						{t("modesPanel.retry")}
					</Button>
				</div>
			);
		}
	} else {
		body = children;
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
			<div className="flex shrink-0 items-center justify-end">
				<Button
					disabled={!ready}
					icon={<RefreshCw size={12} />}
					loading={loading}
					onClick={onRefresh}
					size="sm"
					title={!ready ? t("modesPanel.notConnected") : t("modesPanel.refresh")}
					variant="ghost"
				>
					{t("modesPanel.refresh")}
				</Button>
			</div>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</div>
		</div>
	);
}

/** Labeled switch row (same pattern as the settings window's Toggle). */
function Toggle({
	checked,
	onChange,
	label,
	description,
	disabled,
	title,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
	description?: string;
	disabled?: boolean;
	title?: string;
}) {
	return (
		<label className="flex cursor-pointer items-start justify-between gap-4 rounded-md px-2 py-2 transition-colors hover:bg-(--omp-bg-tertiary)">
			<span className="min-w-0">
				<span className="block text-xs font-medium text-(--omp-text)">{label}</span>
				{description && (
					<span className="mt-0.5 block text-omp-sm leading-snug text-(--omp-muted)">{description}</span>
				)}
			</span>
			<button
				aria-checked={checked}
				className={`relative mt-0.5 h-4.5 w-8 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
					checked ? "bg-(--omp-accent)" : "border border-(--omp-border-muted)"
				}`}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				role="switch"
				title={title}
				type="button"
			>
				<span
					className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all duration-150 ${
						checked ? "left-4" : "left-0.5"
					}`}
				/>
			</button>
		</label>
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<span className="block text-omp-xs font-semibold tracking-wider text-(--omp-muted) uppercase">{children}</span>
	);
}

// ---------------------------------------------------------------------------
// Vibe tab
// ---------------------------------------------------------------------------

function VibeTab({ rpc }: { rpc: ModeRpc<RpcVibeModeState> }) {
	const t = useT();
	const state = rpc.state;
	return (
		<ModeFrame
			error={rpc.error}
			loaded={state !== null}
			loading={rpc.loading}
			onRefresh={rpc.refresh}
			ready={rpc.ready}
		>
			{state && (
				<div className="flex flex-col gap-4">
					<p className="text-omp-sm leading-relaxed text-(--omp-muted)">{t("modesPanel.vibe.desc")}</p>
					<div className="rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-1.5">
						<Toggle
							checked={state.enabled}
							description={t("modesPanel.vibe.toggleDesc")}
							disabled={rpc.busy || !rpc.ready}
							label={t("modesPanel.vibe.toggleLabel")}
							onChange={next => void rpc.mutate(client => client.setVibeMode(next))}
							title={!rpc.ready ? t("modesPanel.notConnected") : undefined}
						/>
					</div>
					{!state.enabled && typeof state.killedWorkers === "number" && state.killedWorkers > 0 && (
						<div className="rounded-md border border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] bg-transparent px-3 py-2 text-omp-sm text-(--omp-warning)">
							{t("modesPanel.vibe.killedWorkers", { count: state.killedWorkers })}
						</div>
					)}
				</div>
			)}
		</ModeFrame>
	);
}

// ---------------------------------------------------------------------------
// Goal tab
// ---------------------------------------------------------------------------

function GoalEnabledView({ rpc, state }: { rpc: ModeRpc<RpcGoalState>; state: RpcGoalState }) {
	const t = useT();
	const [objectiveDraft, setObjectiveDraft] = useState(state.objective ?? "");

	// A fresh objective from the sidecar (event re-fetch) replaces the draft.
	const loadedObjective = state.objective ?? "";
	useEffect(() => {
		setObjectiveDraft(loadedObjective);
	}, [loadedObjective]);

	const trimmedObjective = objectiveDraft.trim();
	const objectiveDirty = trimmedObjective !== "" && trimmedObjective !== loadedObjective;

	const tokensUsed = state.tokensUsed ?? 0;
	const timeUsedSeconds = state.timeUsedSeconds ?? 0;
	const tokenBudget = typeof state.tokenBudget === "number" && state.tokenBudget > 0 ? state.tokenBudget : null;

	const saveObjective = () => {
		if (!objectiveDirty) return;
		void rpc.mutate(client => client.setGoal({ objective: trimmedObjective }));
	};

	const runAction = (action: "pause" | "resume" | "drop") => {
		void rpc.mutate(client => client.setGoal({ action }));
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<SectionLabel>{t("modesPanel.goal.statusLabel")}</SectionLabel>
				<Badge dot pulse={state.status === "active"} variant={goalStatusVariant(state.status)}>
					{goalStatusLabel(t, state.status)}
				</Badge>
				{state.mode && <Badge variant="muted">{state.mode}</Badge>}
			</div>

			<div className="flex flex-col gap-1.5">
				<TextArea
					autoGrow
					label={t("modesPanel.goal.objectiveLabel")}
					onChange={event => setObjectiveDraft(event.target.value)}
					placeholder={t("modesPanel.goal.objectivePlaceholder")}
					rows={3}
					value={objectiveDraft}
				/>
				<div className="flex justify-end">
					<Button
						disabled={!objectiveDirty || rpc.busy || !rpc.ready}
						onClick={saveObjective}
						size="sm"
						title={!rpc.ready ? t("modesPanel.notConnected") : undefined}
						variant="secondary"
					>
						{t("modesPanel.goal.saveObjective")}
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-2 rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2.5">
				{tokenBudget !== null ? (
					<ProgressBar
						label={t("modesPanel.goal.budget")}
						value={tokensUsed / tokenBudget}
						valueText={`${formatTokens(tokensUsed)} / ${formatTokens(tokenBudget)}`}
					/>
				) : (
					<span className="text-omp-sm text-(--omp-dim)">{t("modesPanel.goal.noBudget")}</span>
				)}
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-omp-sm text-(--omp-muted)">
					<span>
						{t("modesPanel.goal.tokensUsed")}:{" "}
						<span className="tabular-nums text-(--omp-text)">{formatTokens(tokensUsed)}</span>
					</span>
					<span>
						{t("modesPanel.goal.timeUsed")}:{" "}
						<span className="tabular-nums text-(--omp-text)">{formatDuration(timeUsedSeconds * 1000)}</span>
					</span>
				</div>
			</div>

			<div className="flex items-center gap-2">
				{state.status === "paused" ? (
					<Button
						disabled={rpc.busy || !rpc.ready}
						onClick={() => runAction("resume")}
						size="sm"
						title={!rpc.ready ? t("modesPanel.notConnected") : undefined}
						variant="primary"
					>
						{t("modesPanel.goal.resume")}
					</Button>
				) : (
					<Button
						disabled={rpc.busy || !rpc.ready || state.status !== "active"}
						onClick={() => runAction("pause")}
						size="sm"
						title={!rpc.ready ? t("modesPanel.notConnected") : undefined}
						variant="secondary"
					>
						{t("modesPanel.goal.pause")}
					</Button>
				)}
				<Button
					disabled={rpc.busy || !rpc.ready}
					onClick={() => runAction("drop")}
					size="sm"
					title={!rpc.ready ? t("modesPanel.notConnected") : undefined}
					variant="danger"
				>
					{t("modesPanel.goal.drop")}
				</Button>
			</div>
		</div>
	);
}

function GoalStartForm({ rpc }: { rpc: ModeRpc<RpcGoalState> }) {
	const t = useT();
	const [objective, setObjective] = useState("");
	const [budget, setBudget] = useState("");

	const trimmed = objective.trim();
	const parsedBudget = Number(budget);
	const tokenBudget =
		budget.trim() !== "" && Number.isFinite(parsedBudget) && parsedBudget > 0 ? Math.floor(parsedBudget) : null;

	const start = () => {
		if (!trimmed) return;
		void rpc.mutate(client =>
			client.setGoal(tokenBudget === null ? { objective: trimmed } : { objective: trimmed, tokenBudget }),
		);
	};

	return (
		<div className="flex flex-col gap-3">
			<SectionLabel>{t("modesPanel.goal.startFormTitle")}</SectionLabel>
			<TextArea
				autoGrow
				label={t("modesPanel.goal.objectiveLabel")}
				onChange={event => setObjective(event.target.value)}
				placeholder={t("modesPanel.goal.objectivePlaceholder")}
				rows={3}
				value={objective}
			/>
			<Input
				hint={t("modesPanel.goal.budgetHint")}
				label={t("modesPanel.goal.budgetLabel")}
				min={0}
				onChange={event => setBudget(event.target.value)}
				placeholder={t("modesPanel.goal.budgetPlaceholder")}
				step={1000}
				type="number"
				value={budget}
			/>
			<div>
				<Button
					disabled={!trimmed || rpc.busy || !rpc.ready}
					loading={rpc.busy}
					onClick={start}
					size="sm"
					title={!rpc.ready ? t("modesPanel.notConnected") : undefined}
					variant="primary"
				>
					{t("modesPanel.goal.start")}
				</Button>
			</div>
		</div>
	);
}

function GoalTab({ rpc }: { rpc: ModeRpc<RpcGoalState> }) {
	const t = useT();
	const state = rpc.state;
	return (
		<ModeFrame
			error={rpc.error}
			loaded={state !== null}
			loading={rpc.loading}
			onRefresh={rpc.refresh}
			ready={rpc.ready}
		>
			{state && (
				<div className="flex flex-col gap-4">
					<p className="text-omp-sm leading-relaxed text-(--omp-muted)">{t("modesPanel.goal.desc")}</p>
					{state.enabled ? <GoalEnabledView rpc={rpc} state={state} /> : <GoalStartForm rpc={rpc} />}
				</div>
			)}
		</ModeFrame>
	);
}

// ---------------------------------------------------------------------------
// Loop tab
// ---------------------------------------------------------------------------

function LoopTab({ rpc }: { rpc: ModeRpc<RpcLoopModeState> }) {
	const t = useT();
	const state = rpc.state;
	const [argsDraft, setArgsDraft] = useState("");

	const toggle = (next: boolean) => {
		if (!state) return;
		const args = argsDraft.trim();
		void rpc.mutate(client => client.setLoopMode(next, args === "" ? undefined : args));
	};

	const limit = state ? parseLoopLimit(state.limit) : null;

	return (
		<ModeFrame
			error={rpc.error}
			loaded={state !== null}
			loading={rpc.loading}
			onRefresh={rpc.refresh}
			ready={rpc.ready}
		>
			{state && (
				<div className="flex flex-col gap-4">
					<p className="text-omp-sm leading-relaxed text-(--omp-muted)">{t("modesPanel.loop.desc")}</p>
					<div className="rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-1.5">
						<Toggle
							checked={state.enabled}
							description={t("modesPanel.loop.toggleDesc")}
							disabled={rpc.busy || !rpc.ready}
							label={t("modesPanel.loop.toggleLabel")}
							onChange={toggle}
							title={!rpc.ready ? t("modesPanel.notConnected") : undefined}
						/>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<SectionLabel>{t("modesPanel.loop.statusLabel")}</SectionLabel>
						<Badge dot pulse={state.state === "running"} variant={LOOP_STATE_VARIANT[state.state]}>
							{t(`modesPanel.loop.state.${state.state}`)}
						</Badge>
					</div>

					<div className="flex flex-col gap-1.5">
						<SectionLabel>{t("modesPanel.loop.promptLabel")}</SectionLabel>
						{state.prompt ? (
							<p className="rounded-md border border-(--omp-border-muted) bg-transparent px-3 py-2 font-mono text-omp-sm break-words whitespace-pre-wrap text-(--omp-text)">
								{state.prompt}
							</p>
						) : (
							<p className="text-omp-sm text-(--omp-dim)">{t("modesPanel.loop.noPrompt")}</p>
						)}
					</div>

					<div className="flex flex-wrap items-center gap-2 text-omp-sm text-(--omp-muted)">
						<SectionLabel>{t("modesPanel.loop.limitLabel")}</SectionLabel>
						<span className="tabular-nums text-(--omp-text)">
							{limit ? loopLimitText(t, limit) : t("modesPanel.loop.noLimit")}
						</span>
					</div>

					<Input
						hint={t("modesPanel.loop.argsHint")}
						label={t("modesPanel.loop.argsLabel")}
						onChange={event => setArgsDraft(event.target.value)}
						placeholder={t("modesPanel.loop.argsPlaceholder")}
						value={argsDraft}
					/>
				</div>
			)}
		</ModeFrame>
	);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export function ModesPanel({ open, onClose, initialTab = "vibe" }: ModesPanelProps) {
	const t = useT();
	const [tab, setTab] = useState<ModesTabId>(initialTab);
	const tabId = useRuntimeTabId();

	const confirmVibe = useCallback(
		(state: RpcVibeModeState) => {
			const session = sessionRuntimeStore<SessionStore>(tabId, "session") ?? useSessionStore;
			session.setState({ vibeModeEnabled: state.enabled });
		},
		[tabId],
	);
	const vibe = useModeRpc(open, tab === "vibe", fetchVibeMode, pickVibeMode, confirmVibe);
	const goal = useModeRpc(open, tab === "goal", fetchGoal, pickGoal);
	const loop = useModeRpc(open, tab === "loop", fetchLoopMode, pickLoopMode);

	// Reopening starts on the requested tab.
	useEffect(() => {
		if (open) setTab(initialTab);
	}, [open, initialTab]);

	// Live updates while open: goal changes re-fetch silently (the event payload
	// shape is loose), loop frames apply in place.
	const syncGoal = goal.sync;
	const applyLoop = loop.apply;
	useEffect(() => {
		if (!open) return;
		return window.omp.events.onBatch((events: AgentSessionEvent[]) => {
			if (!acceptsActiveTabEvents()) return;
			for (const event of events) {
				if (event.type === "goal_updated") {
					syncGoal();
				} else if (event.type === "loop_mode_update") {
					const next = normalizeLoopUpdate(event);
					if (next) applyLoop(next);
				}
			}
		});
	}, [open, syncGoal, applyLoop]);

	const tabs: TabItem[] = useMemo(
		() => [
			{
				id: "vibe",
				label: t("modesPanel.tabs.vibe"),
				badge: vibe.state?.enabled ? t("modesPanel.on") : undefined,
			},
			{
				id: "goal",
				label: t("modesPanel.tabs.goal"),
				badge: goal.state?.enabled ? goalStatusLabel(t, goal.state.status) : undefined,
			},
			{
				id: "loop",
				label: t("modesPanel.tabs.loop"),
				badge:
					loop.state && loop.state.state !== "off" ? t(`modesPanel.loop.state.${loop.state.state}`) : undefined,
			},
		],
		[t, vibe.state, goal.state, loop.state],
	);

	const handleTabChange = useCallback((id: string) => {
		setTab(id as ModesTabId);
	}, []);

	return (
		<Modal onClose={onClose} open={open} size="lg" title={t("modesPanel.title")} bodyClassName="p-0">
			<div className="flex h-[70vh] min-h-0 flex-col">
				<Tabs
					activeId={tab}
					ariaLabel={t("modesPanel.title")}
					className="shrink-0 px-4"
					onChange={handleTabChange}
					tabs={tabs}
				/>
				{tab === "vibe" && <VibeTab rpc={vibe} />}
				{tab === "goal" && <GoalTab rpc={goal} />}
				{tab === "loop" && <LoopTab rpc={loop} />}
				<div className="shrink-0 border-t border-(--omp-border-muted) px-4 py-2 text-omp-xs text-(--omp-dim)">
					{t("modesPanel.footerNote")}
				</div>
			</div>
		</Modal>
	);
}
