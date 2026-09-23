import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Agent Hub window: TUI parity for the Agent Control Center (agent-dashboard.ts)
 * and the multi-agent hub table (agent-hub.ts).
 *
 * Definitions tab (control center): every project/user/bundled agent discovered
 * for the attached workspace, with enable/disable, per-agent model override,
 * and prewalk override persisted through set_setting RPC
 * (task.disabledAgents / task.agentModelOverrides / task.agentPrewalk — the
 * same settings the TUI dashboard writes).
 *
 * Hub tab (multi-agent table): live view of the session's subagents from the
 * subagents store (get_subagents hydration + lifecycle frames) with status,
 * elapsed time, model, and transcripts in a slide-over drawer. Per-agent
 * abort and revive ride the abort_subagent / revive_subagent RPCs (TUI hub
 * `x`/`r` parity); the session-scoped "abort turn" remains for stopping
 * everything.
 */

import { ArrowLeft, Check, MessageSquare, RefreshCw, Square, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { RpcAgentDefinitionInfo, SubagentSnapshot } from "../../../shared/rpc-types";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { abortActiveTurn } from "../../lib/messages";
import { useNowTick } from "../../lib/now-tick";
import { useSubagentsStore } from "../../stores/subagents";
import { toast } from "../../stores/toast";
import { Badge, Button, Input, Modal, Spinner, type TabItem, Tabs } from "../common";
import { type AgentSettingsRpc, type AgentSettingsState, useAgentSettings } from "./agent-hub-settings";
import { SubagentTranscript } from "./SubagentTranscript";
import {
	formatElapsed,
	isLiveSubagentStatus,
	statusMeta,
	subagentElapsedMs,
	subagentPrimaryLabel,
} from "./subagent-graph";

export interface AgentHubWindowProps {
	open: boolean;
	onClose: () => void;
	initialTab?: AgentHubTabId;
}

export type AgentHubTabId = "definitions" | "hub";

// ---------------------------------------------------------------------------
// Definitions: settings-backed agent control center
// ---------------------------------------------------------------------------

function Toggle({
	checked,
	onChange,
	label,
	disabled,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-2">
			<button
				aria-checked={checked}
				aria-label={label}
				className={`relative h-4.5 w-8 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
					checked ? "bg-(--omp-accent)" : "border border-(--omp-border-muted)"
				}`}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				role="switch"
				type="button"
			>
				<span
					className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all duration-150 ${
						checked ? "left-4" : "left-0.5"
					}`}
				/>
			</button>
			<span className="text-omp-sm text-(--omp-muted)">{label}</span>
		</label>
	);
}

interface DefinitionEntry extends Partial<RpcAgentDefinitionInfo> {
	name: string;
}

const PrewalkState = {
	default: "default",
	on: "on",
	off: "off",
} as const;
type PrewalkState = (typeof PrewalkState)[keyof typeof PrewalkState];

/** Current prewalk override state for an agent (TUI dashboard cycle: agent default → on → off). */
function prewalkStateOf(overrides: Record<string, string>, name: string): PrewalkState {
	const value = overrides[name]?.trim().toLowerCase();
	if (value === "on") return PrewalkState.on;
	if (value === "off") return PrewalkState.off;
	return PrewalkState.default;
}

const PREWALK_VARIANT: Record<PrewalkState, "default" | "info" | "muted"> = {
	default: "default",
	on: "info",
	off: "muted",
};

/** Known definition sources; anything else renders raw (e.g. future extension sources). */
const KNOWN_SOURCES: Record<string, true> = { project: true, user: true, bundled: true };

function sourceLabel(t: (key: string) => string, source: string): string {
	return KNOWN_SOURCES[source] ? t(`agentHub.source.${source}`) : source;
}

function formatAgentOutput(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function DefinitionDetails({
	entry,
	override,
	prewalk,
}: {
	entry: DefinitionEntry;
	override: string | undefined;
	prewalk: PrewalkState;
}) {
	const t = useT();
	const prewalkProjection = [
		t(`agentHub.defs.prewalk.${prewalk}`),
		entry.prewalkPattern,
		entry.prewalkResolved ? `→ ${entry.prewalkResolved}` : undefined,
	]
		.filter(Boolean)
		.join(" ");
	const details = [
		[t("agentHub.defs.detail.path"), entry.filePath],
		[t("agentHub.defs.detail.defaultPattern"), entry.defaultPatterns?.join(", ") || t("agentHub.defs.modelSession")],
		[t("agentHub.defs.detail.defaultResolved"), entry.defaultResolved],
		[
			t("agentHub.defs.detail.effectivePattern"),
			override || entry.effectivePatterns?.join(", ") || t("agentHub.defs.modelSession"),
		],
		[
			t("agentHub.defs.detail.effectiveResolved"),
			[entry.effectiveResolved, entry.effectiveThinkingLevel].filter(Boolean).join(" · ") || undefined,
		],
		[t("agentHub.defs.detail.prewalk"), prewalkProjection],
		[t("agentHub.defs.detail.thinking"), entry.thinkingLevel],
		[t("agentHub.defs.detail.tools"), entry.tools?.join(", ")],
		[
			t("agentHub.defs.detail.spawns"),
			entry.spawns === "*" ? "*" : Array.isArray(entry.spawns) ? entry.spawns.join(", ") : undefined,
		],
		[t("agentHub.defs.detail.skills"), entry.autoloadSkills?.join(", ")],
		[
			t("agentHub.defs.detail.blocking"),
			entry.blocking === undefined ? undefined : entry.blocking ? t("common.yes") : t("common.no"),
		],
		[
			t("agentHub.defs.detail.readSummarize"),
			entry.readSummarize === undefined ? undefined : entry.readSummarize ? t("common.yes") : t("common.no"),
		],
		[t("agentHub.defs.detail.output"), formatAgentOutput(entry.output)],
	].filter((row): row is [string, string] => typeof row[1] === "string" && row[1].length > 0);

	return (
		<details className="mt-2 border-t border-(--omp-border-muted) pt-1.5">
			<summary className="cursor-pointer text-omp-xs text-(--omp-muted)">{t("agentHub.defs.inspect")}</summary>
			<div className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-omp-xs">
				{details.map(([label, value]) => (
					<div className="contents" key={label}>
						<span className="text-(--omp-dim)">{label}</span>
						<span className="break-all font-mono text-(--omp-muted)">{value}</span>
					</div>
				))}
			</div>
		</details>
	);
}

const DefinitionRow = memo(function DefinitionRow({
	entry,
	state,
	busy,
	editing,
	onToggle,
	onBeginModelEdit,
	onCancelModelEdit,
	onSaveModel,
	onCyclePrewalk,
}: {
	entry: DefinitionEntry;
	state: AgentSettingsState;
	busy: boolean;
	editing: boolean;
	onToggle: (name: string, disabled: boolean) => void;
	onBeginModelEdit: (name: string) => void;
	onCancelModelEdit: () => void;
	onSaveModel: (name: string, raw: string) => void;
	onCyclePrewalk: (name: string) => void;
}) {
	const t = useT();
	const [draft, setDraft] = useState("");
	const disabled = state.disabledAgents.includes(entry.name);
	const override = state.modelOverrides[entry.name]?.trim() || undefined;
	const prewalk = prewalkStateOf(state.prewalkOverrides, entry.name);

	// Seed the draft when this row enters edit mode.
	useEffect(() => {
		if (editing) setDraft(override ?? "");
	}, [editing, override]);

	const submit = () => onSaveModel(entry.name, draft);

	return (
		<div className="rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2">
			<div className="flex items-center gap-2.5">
				<span
					className={cx(
						"min-w-0 flex-1 truncate font-mono text-omp-md font-medium",
						disabled ? "text-(--omp-dim) line-through" : "text-(--omp-text)",
					)}
				>
					{entry.name}
				</span>
				{entry.source && <Badge variant="muted">{sourceLabel(t, entry.source)}</Badge>}
				{disabled && <Badge variant="warning">{t("agentHub.defs.disabledBadge")}</Badge>}
				<Toggle
					checked={!disabled}
					disabled={busy}
					label={t("agentHub.defs.enabled")}
					onChange={enabled => onToggle(entry.name, !enabled)}
				/>
			</div>
			{entry.description && <p className="mt-1 text-omp-xs leading-relaxed text-(--omp-dim)">{entry.description}</p>}
			<div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
				<span className="flex items-center gap-1.5 text-omp-sm">
					<span className="text-(--omp-dim)">{t("agentHub.defs.modelLabel")}</span>
					{editing ? (
						<span className="flex items-center gap-1">
							<Input
								autoFocus
								className="h-6 w-52 text-omp-sm"
								mono
								onChange={event => setDraft(event.target.value)}
								onKeyDown={event => {
									// Enter submits; Escape is owned by the Modal (closes the window),
									// matching every other GUI dialog's edit-in-place behavior.
									if (isImeKeyEvent(event)) return;
									if (event.key === "Enter") submit();
								}}
								placeholder={t("agentHub.defs.modelPlaceholder")}
								value={draft}
							/>
							<Button disabled={busy} onClick={submit} size="sm" variant="secondary">
								{t("common.save")}
							</Button>
							<Button disabled={busy} onClick={onCancelModelEdit} size="sm" variant="ghost">
								{t("common.cancel")}
							</Button>
						</span>
					) : (
						<>
							<span className={override ? "font-mono text-(--omp-text)" : "text-(--omp-dim)"}>
								{override ?? t("agentHub.defs.modelSession")}
							</span>
							<Button disabled={busy} onClick={() => onBeginModelEdit(entry.name)} size="sm" variant="ghost">
								{t("agentHub.defs.modelEdit")}
							</Button>
						</>
					)}
				</span>
				<span className="flex items-center gap-1.5 text-omp-sm">
					<span className="text-(--omp-dim)">{t("agentHub.defs.prewalkLabel")}</span>
					<button
						className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
						disabled={busy}
						onClick={() => onCyclePrewalk(entry.name)}
						title={t("agentHub.defs.prewalkHint")}
						type="button"
					>
						<Badge variant={PREWALK_VARIANT[prewalk]}>{t(`agentHub.defs.prewalk.${prewalk}`)}</Badge>
					</button>
				</span>
			</div>
			<DefinitionDetails entry={entry} override={override} prewalk={prewalk} />
		</div>
	);
});

type DefinitionSourceFilter = "all" | RpcAgentDefinitionInfo["source"];
const DEFINITION_SOURCE_FILTERS: readonly DefinitionSourceFilter[] = ["all", "project", "user", "bundled"];

function DefinitionsTab({ rpc }: { rpc: AgentSettingsRpc }) {
	const tabRpc = useTabRpc();
	const t = useT();
	const subagents = useSubagentsStore(s => s.subagents);
	const [query, setQuery] = useState("");
	const [sourceFilter, setSourceFilter] = useState<DefinitionSourceFilter>("all");
	const [editingName, setEditingName] = useState<string | null>(null);

	// Start with every definition discovered for the workspace, then retain
	// settings-only and live-session names in case a definition was removed.
	const entries = useMemo(() => {
		const state = rpc.state;
		const byName = new Map<string, DefinitionEntry>();
		if (state) {
			for (const definition of state.definitions) byName.set(definition.name, definition);
			for (const name of state.disabledAgents) {
				if (!byName.has(name)) byName.set(name, { name });
			}
			for (const name of Object.keys(state.modelOverrides)) {
				if (!byName.has(name)) byName.set(name, { name });
			}
			for (const name of Object.keys(state.prewalkOverrides)) {
				if (!byName.has(name)) byName.set(name, { name });
			}
		}
		for (const sub of subagents.values()) {
			const existing = byName.get(sub.agent);
			if (existing) {
				if (!existing.source) existing.source = sub.agentSource;
			} else {
				byName.set(sub.agent, { name: sub.agent, source: sub.agentSource });
			}
		}
		return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
	}, [rpc.state, subagents]);
	const sourceCounts = useMemo(() => {
		const counts: Record<DefinitionSourceFilter, number> = { all: entries.length, project: 0, user: 0, bundled: 0 };
		for (const entry of entries) {
			if (entry.source && entry.source in counts) counts[entry.source as RpcAgentDefinitionInfo["source"]]++;
		}
		return counts;
	}, [entries]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return entries.filter(entry => {
			if (sourceFilter !== "all" && entry.source !== sourceFilter) return false;
			return !q || entry.name.toLowerCase().includes(q) || entry.description?.toLowerCase().includes(q);
		});
	}, [entries, query, sourceFilter]);

	const toggleAgent = useCallback(
		(name: string, disabled: boolean) => {
			const state = rpc.state;
			if (!state) return;
			const next = new Set(state.disabledAgents);
			if (disabled) next.add(name);
			else next.delete(name);
			const disabledAgents = [...next].sort((a, b) => a.localeCompare(b));
			void rpc.mutate({ ...state, disabledAgents }, () => tabRpc.setSetting("task.disabledAgents", disabledAgents));
		},
		[rpc, tabRpc.setSetting],
	);

	const saveModel = useCallback(
		(name: string, raw: string) => {
			const state = rpc.state;
			if (!state) return;
			const value = raw.trim();
			const modelOverrides = { ...state.modelOverrides };
			if (value) modelOverrides[name] = value;
			else delete modelOverrides[name];
			setEditingName(null);
			void rpc.mutate({ ...state, modelOverrides }, () =>
				tabRpc.setSetting("task.agentModelOverrides", modelOverrides),
			);
		},
		[rpc, tabRpc.setSetting],
	);

	const cyclePrewalk = useCallback(
		(name: string) => {
			const state = rpc.state;
			if (!state) return;
			const current = prewalkStateOf(state.prewalkOverrides, name);
			const next = current === PrewalkState.default ? "on" : current === PrewalkState.on ? "off" : undefined;
			const prewalkOverrides = { ...state.prewalkOverrides };
			if (next) prewalkOverrides[name] = next;
			else delete prewalkOverrides[name];
			void rpc.mutate({ ...state, prewalkOverrides }, () =>
				tabRpc.setSetting("task.agentPrewalk", prewalkOverrides),
			);
		},
		[rpc, tabRpc.setSetting],
	);

	const loadedState = rpc.state;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
			<div className="flex shrink-0 items-center gap-2">
				<Input
					className="h-7 flex-1 text-omp-sm"
					onChange={event => setQuery(event.target.value)}
					placeholder={t("agentHub.defs.searchPlaceholder")}
					value={query}
				/>
				<Button
					icon={<RefreshCw size={12} />}
					loading={rpc.loading}
					onClick={rpc.refresh}
					size="sm"
					variant="ghost"
				>
					{t("agentHub.refresh")}
				</Button>
			</div>
			<div className="flex shrink-0 flex-wrap gap-1">
				{DEFINITION_SOURCE_FILTERS.map(source => (
					<button
						className={cx(
							"rounded-md px-2 py-1 text-omp-xs",
							sourceFilter === source
								? "bg-(--omp-selected-bg) text-(--omp-text)"
								: "text-(--omp-dim) hover:text-(--omp-muted)",
						)}
						key={source}
						onClick={() => setSourceFilter(source)}
						type="button"
					>
						{source === "all" ? t("agentHub.source.all") : t(`agentHub.source.${source}`)} ({sourceCounts[source]}
						)
					</button>
				))}
			</div>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{!loadedState ? (
					rpc.loading ? (
						<div className="m-auto">
							<Spinner label={t("common.loading")} />
						</div>
					) : (
						<div className="m-auto flex max-w-md flex-col items-center gap-2 rounded-lg border border-(--omp-border-muted) px-4 py-6 text-center">
							<span className="text-omp-md font-medium text-(--omp-error)">{t("agentHub.loadFailed")}</span>
							<span className="text-omp-sm break-all text-(--omp-dim)">{rpc.error}</span>
							<Button icon={<RefreshCw size={12} />} onClick={rpc.refresh} size="sm" variant="secondary">
								{t("agentHub.retry")}
							</Button>
						</div>
					)
				) : (
					<div className="flex flex-col gap-2">
						{filtered.length === 0 ? (
							<div className="px-3 py-8 text-center text-omp-sm leading-relaxed text-(--omp-dim)">
								{t("agentHub.defs.empty")}
								<br />
								{t("agentHub.defs.emptyHint")}
							</div>
						) : (
							filtered.map(entry => (
								<DefinitionRow
									busy={rpc.busy}
									editing={editingName === entry.name}
									entry={entry}
									key={entry.name}
									onBeginModelEdit={setEditingName}
									onCancelModelEdit={() => setEditingName(null)}
									onCyclePrewalk={cyclePrewalk}
									onSaveModel={saveModel}
									onToggle={toggleAgent}
									state={loadedState}
								/>
							))
						)}
					</div>
				)}
			</div>
			<div className="shrink-0 border-t border-(--omp-border-muted) pt-2 text-omp-xs text-(--omp-dim)">
				{t("agentHub.defs.footerNote")}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Hub: live multi-agent table
// ---------------------------------------------------------------------------

/**
 * TUI hub ordering (running first); recency breaks ties. Keyed by the live
 * predicate rather than raw status strings: the wire status is free-form
 * (`running`/`pending`/`idle`/`parked`/`aborted` all occur), so a raw
 * `TABLE[status]` lookup returned undefined and produced a NaN comparator.
 */
function hubStatusOrder(status: string): number {
	if (isLiveSubagentStatus(status)) return 0;
	if (status === "failed") return 1;
	if (status === "cancelled" || status === "aborted") return 2;
	return 3;
}

const HubRow = memo(function HubRow({
	agent,
	now,
	actionState,
	onView,
	onAbort,
	onRevive,
	onAbortConfirm,
	onAbortCancel,
}: {
	agent: SubagentSnapshot;
	now: number;
	/** "confirming" = inline ✓/✕ abort confirm; "working" = RPC in flight. */
	actionState: "idle" | "confirming" | "working";
	onView: () => void;
	onAbort: () => void;
	onRevive: () => void;
	onAbortConfirm: () => void;
	onAbortCancel: () => void;
}) {
	const t = useT();
	const meta = statusMeta(agent.status);
	const live = isLiveSubagentStatus(agent.status);
	// Live rows advance the sidecar sample; terminal rows keep its final value.
	const elapsed = subagentElapsedMs(agent, now);
	const title = subagentPrimaryLabel(agent);
	const lastUpdate = agent.progress?.description;
	const model = agent.progress?.resolvedModel;
	const parked = agent.status === "parked";
	// A stale registration has no live turn, but cancel is the recovery action
	// upstream exposes specifically for clearing it from the registry.
	const actionableLive = (live || agent.status === "stale") && agent.kind !== "advisor";
	const revivable = parked && agent.kind !== "advisor";

	return (
		<div className="rounded-lg border border-(--omp-border-muted) bg-transparent">
			<div className="flex items-center">
				<button
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left"
					onClick={onView}
					type="button"
				>
					<Badge dot pulse={meta.live} variant={meta.variant}>
						{t(meta.labelKey)}
					</Badge>
					<span className="shrink-0 font-mono text-omp-xs text-(--omp-dim) tabular-nums">#{agent.index}</span>
					<span className="min-w-0 truncate text-omp-md font-medium text-(--omp-text)">{title}</span>
					<span className="ml-auto shrink-0 text-omp-xs text-(--omp-dim) tabular-nums">
						{elapsed !== null ? formatElapsed(elapsed) : "—"}
					</span>
				</button>
				{/* 查看消息 opens the transcript slide-over; abort/revive are the TUI
				    hub `x`/`r` parity actions via abort_subagent / revive_subagent.
				    Abort is inline-confirmed like session deletes. */}
				<button
					type="button"
					title={t("agentHub.hub.viewMessages")}
					onClick={onView}
					className="omp-pressable mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-accent)"
				>
					<MessageSquare size={11} />
				</button>
				{actionableLive && actionState !== "confirming" && (
					<button
						type="button"
						disabled={actionState === "working"}
						title={t("agentHub.hub.abortAgent")}
						onClick={onAbort}
						className="omp-pressable mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-error-dim) hover:text-(--omp-error) disabled:opacity-40"
					>
						<Square size={10} fill="currentColor" />
					</button>
				)}
				{actionableLive && actionState === "confirming" && (
					<span className="mr-2 flex shrink-0 items-center gap-0.5">
						<button
							type="button"
							title={t("agentHub.hub.confirmAbort")}
							onClick={onAbortConfirm}
							className="omp-pressable flex h-6 w-6 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent text-(--omp-error)"
						>
							<Check size={12} />
						</button>
						<button
							type="button"
							title={t("agentHub.hub.cancelAbort")}
							onClick={onAbortCancel}
							className="omp-pressable flex h-6 w-6 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg)"
						>
							<X size={12} />
						</button>
					</span>
				)}
				{revivable && (
					<button
						type="button"
						disabled={actionState === "working"}
						title={t("agentHub.hub.reviveAgent")}
						onClick={onRevive}
						className="omp-pressable mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-accent) disabled:opacity-40"
					>
						<RefreshCw size={11} />
					</button>
				)}
			</div>
			{/* Secondary line: agent type, provenance/kind badges, resolved model,
			    and the latest progress note. */}
			<div className="flex items-center gap-2 px-3 pb-2 text-omp-xs">
				<span className="shrink-0 font-medium text-(--omp-muted)">{agent.agent}</span>
				{agent.agentSource && <Badge variant="muted">{sourceLabel(t, agent.agentSource)}</Badge>}
				<Badge variant="muted">
					{agent.kind === "advisor" ? t("agentHub.hub.readOnly") : t("agentHub.hub.kind.sub")}
				</Badge>
				{model && (
					<span className="min-w-0 truncate font-mono text-(--omp-dim)" title={model}>
						{model}
					</span>
				)}
				{lastUpdate && (
					<span className="ml-auto min-w-0 flex-1 truncate text-right text-(--omp-dim)">{lastUpdate}</span>
				)}
			</div>
		</div>
	);
});

/**
 * 查看消息 slide-over: covers the hub tab body with the agent's transcript
 * (get_subagent_messages byte pagination inside SubagentTranscript). Escape
 * closes the drawer, not the whole hub modal — window-capture runs before the
 * Modal's document-capture handler (PluginDetailDrawer pattern).
 */
function AgentTranscriptDrawer({ agent, onClose }: { agent: SubagentSnapshot; onClose: () => void }) {
	const t = useT();
	const meta = statusMeta(agent.status);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onClose]);

	return (
		<div className="omp-slide-in-right absolute inset-0 z-10 flex flex-col bg-(--omp-modal-bg)">
			<div className="flex shrink-0 items-center gap-2 border-b border-(--omp-border-muted) px-3 py-2">
				<button
					aria-label={t("agentHub.hub.backToHub")}
					className="omp-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-text)"
					onClick={onClose}
					type="button"
				>
					<ArrowLeft size={13} />
				</button>
				<Badge dot pulse={meta.live} variant={meta.variant}>
					{t(meta.labelKey)}
				</Badge>
				<span className="min-w-0 truncate text-omp-md font-medium text-(--omp-text)">
					{subagentPrimaryLabel(agent)}
				</span>
				<span className="shrink-0 text-omp-xs text-(--omp-dim)">{agent.agent}</span>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<SubagentTranscript agent={agent} />
			</div>
		</div>
	);
}

function HubTab() {
	const tabRpc = useTabRpc();
	const t = useT();
	const subagents = useSubagentsStore(s => s.subagents);
	const loadError = useSubagentsStore(s => s.error);
	const [viewingId, setViewingId] = useState<string | null>(null);
	const [aborting, setAborting] = useState(false);

	// Close the slide-over if its agent leaves the roster (released mid-view).
	useEffect(() => {
		if (viewingId !== null && !subagents.has(viewingId)) setViewingId(null);
	}, [viewingId, subagents]);

	const viewing = viewingId !== null ? (subagents.get(viewingId) ?? null) : null;

	const sorted = useMemo(
		() =>
			[...subagents.values()].sort(
				(a, b) => hubStatusOrder(a.status) - hubStatusOrder(b.status) || b.index - a.index,
			),
		[subagents],
	);

	// Live count drives the 1s elapsed tick and the Abort button. Counted with
	// the shared live predicate: tallying into a fixed status-keyed record left
	// wire statuses like "running"/"pending"/"idle"/"parked" uncounted (NaN),
	// which froze every elapsed timer and disabled Abort mid-run.
	const liveCount = useMemo(() => {
		let count = 0;
		for (const agent of subagents.values()) if (isLiveSubagentStatus(agent.status)) count += 1;
		return count;
	}, [subagents]);

	// Per-status badge tallies over the statuses actually present on the wire —
	// a Map, not a fixed-key record, so unknown statuses are shown instead of
	// silently producing NaN.
	const counts = useMemo(() => {
		const result = new Map<string, number>();
		for (const agent of subagents.values()) result.set(agent.status, (result.get(agent.status) ?? 0) + 1);
		return result;
	}, [subagents]);

	const hasRunning = liveCount > 0;
	const now = useNowTick(hasRunning);

	// Session-scoped abort: stops the active turn (subagents included).
	const abortTurn = useCallback(async () => {
		setAborting(true);
		try {
			const res = await abortActiveTurn();
			if (!res.success) {
				toast({ variant: "error", title: t("agentHub.hub.abortFailed"), message: res.error });
			}
		} catch (cause) {
			toast({ variant: "error", title: t("agentHub.hub.abortFailed"), message: String(cause) });
		} finally {
			setAborting(false);
		}
	}, [t]);

	// Per-agent lifecycle actions (TUI hub `x`/`r` parity). Refetch the list
	// after each mutation — the release/revival may not emit a lifecycle frame.
	// The store refresh MERGES, so finished agents survive the fetch.
	const [rowAction, setRowAction] = useState<{ id: string; state: "confirming" | "working" } | null>(null);

	const refreshSubagents = useCallback(() => useSubagentsStore.getState().refresh(), []);

	const subagentReason = useCallback(
		(reason: string | undefined): string => {
			switch (reason) {
				case "advisor_readonly":
					return t("agentHub.hub.reason.advisorReadonly");
				case "main_agent":
					return t("agentHub.hub.reason.mainAgent");
				case "not_found":
					return t("agentHub.hub.reason.notFound");
				case "not_parked":
					return t("agentHub.hub.reason.notParked");
				default:
					return t("agentHub.hub.reason.abortFailed");
			}
		},
		[t],
	);

	const abortAgent = useCallback(
		async (id: string) => {
			setRowAction({ id, state: "working" });
			try {
				const res = await tabRpc.abortSubagent(id);
				if (!res.success) {
					toast({ variant: "error", title: t("agentHub.hub.abortAgentFailed"), message: res.error });
					return;
				}
				const data = res.data as { ok?: boolean; reason?: string } | undefined;
				if (!data?.ok) {
					toast({
						variant: "error",
						title: t("agentHub.hub.abortAgentFailed"),
						message: subagentReason(data?.reason),
					});
					return;
				}
				await refreshSubagents();
			} catch (cause) {
				toast({ variant: "error", title: t("agentHub.hub.abortAgentFailed"), message: String(cause) });
			} finally {
				setRowAction(null);
			}
		},
		[t, subagentReason, refreshSubagents, tabRpc.abortSubagent],
	);

	const reviveAgent = useCallback(
		async (id: string) => {
			setRowAction({ id, state: "working" });
			try {
				const res = await tabRpc.reviveSubagent(id);
				if (!res.success) {
					toast({ variant: "error", title: t("agentHub.hub.reviveFailed"), message: res.error });
					return;
				}
				const data = res.data as { ok?: boolean; reason?: string } | undefined;
				if (!data?.ok) {
					toast({
						variant: "error",
						title: t("agentHub.hub.reviveFailed"),
						message: subagentReason(data?.reason),
					});
					return;
				}
				await refreshSubagents();
			} catch (cause) {
				toast({ variant: "error", title: t("agentHub.hub.reviveFailed"), message: String(cause) });
			} finally {
				setRowAction(null);
			}
		},
		[t, subagentReason, refreshSubagents, tabRpc.reviveSubagent],
	);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4">
			<div className="flex shrink-0 flex-wrap items-center gap-2">
				{[...counts].map(([status, count]) => (
					<Badge dot key={status} pulse={statusMeta(status).live} variant={statusMeta(status).variant}>
						{t(statusMeta(status).labelKey)} {count}
					</Badge>
				))}
				<span className="ml-auto">
					<Button
						disabled={!hasRunning}
						icon={<Square size={11} />}
						loading={aborting}
						onClick={() => void abortTurn()}
						size="sm"
						variant="danger"
					>
						{t("agentHub.hub.abortTurn")}
					</Button>
				</span>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
				{sorted.length === 0 ? (
					<div className="m-auto flex flex-col items-center gap-2 px-3 py-8 text-center text-omp-sm leading-relaxed text-(--omp-dim)">
						{/* The roster never loaded is a different claim from none spawned. */}
						{loadError ? (
							<>
								<p role="alert" className="text-(--omp-error)">
									{t("subagent.loadFailed")}
									<br />
									{loadError}
								</p>
								<Button
									icon={<RefreshCw size={12} />}
									onClick={() => void refreshSubagents()}
									size="sm"
									variant="secondary"
								>
									{t("common.retry")}
								</Button>
							</>
						) : (
							<>
								{t("subagent.empty")}
								<br />
								{t("subagent.emptyHint")}
							</>
						)}
					</div>
				) : (
					sorted.map(agent => (
						<HubRow
							agent={agent}
							key={agent.id}
							now={now}
							onView={() => setViewingId(agent.id)}
							actionState={rowAction?.id === agent.id ? rowAction.state : "idle"}
							onAbort={() => setRowAction({ id: agent.id, state: "confirming" })}
							onAbortConfirm={() => void abortAgent(agent.id)}
							onAbortCancel={() => setRowAction(null)}
							onRevive={() => void reviveAgent(agent.id)}
						/>
					))
				)}
			</div>
			<div className="shrink-0 border-t border-(--omp-border-muted) pt-2 text-omp-xs leading-relaxed text-(--omp-dim)">
				{t("agentHub.hub.gapNote")}
			</div>
			{viewing && <AgentTranscriptDrawer agent={viewing} onClose={() => setViewingId(null)} />}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export function AgentHubWindow({ open, onClose, initialTab = "definitions" }: AgentHubWindowProps) {
	const t = useT();
	const [tab, setTab] = useState<AgentHubTabId>(initialTab);
	const settings = useAgentSettings(open, tab === "definitions");
	const runningCount = useSubagentsStore(s => {
		let count = 0;
		for (const agent of s.subagents.values()) if (isLiveSubagentStatus(agent.status)) count += 1;
		return count;
	});

	// Reopening starts on the requested tab.
	useEffect(() => {
		if (open) setTab(initialTab);
	}, [open, initialTab]);

	const tabs: TabItem[] = useMemo(
		() => [
			{ id: "definitions", label: t("agentHub.tabs.definitions") },
			{ id: "hub", label: t("agentHub.tabs.hub"), badge: runningCount > 0 ? runningCount : undefined },
		],
		[t, runningCount],
	);

	const handleTabChange = useCallback((id: string) => {
		setTab(id as AgentHubTabId);
	}, []);

	return (
		<Modal onClose={onClose} open={open} size="lg" title={t("agentHub.title")} bodyClassName="p-0">
			<div className="flex h-[70vh] min-h-0 flex-col">
				<Tabs
					activeId={tab}
					ariaLabel={t("agentHub.title")}
					className="shrink-0 px-4"
					onChange={handleTabChange}
					tabs={tabs}
				/>
				{tab === "definitions" && <DefinitionsTab rpc={settings} />}
				{tab === "hub" && <HubTab />}
			</div>
		</Modal>
	);
}
