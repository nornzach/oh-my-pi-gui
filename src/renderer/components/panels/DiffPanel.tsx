/**
 * Diff panel: latest edit-tool diffs from the tools store, with a file
 * selector when several edits exist, and unified/split view toggle.
 * Unified rendering delegates to lib/diff DiffView; split mode is built
 * on parseDiff directly.
 *
 * The Timeline view is a chronological feed of every edit/write/apply_patch
 * operation this session (same tools-store source), grouped by file with
 * per-file cumulative and session-total +/- summaries plus an activity
 * strip; the feed is virtualized to handle many edits.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ChevronDown,
	ChevronRight,
	ChevronsDownUp,
	ChevronsUpDown,
	Columns2,
	FilePen,
	GitCompareArrows,
	History,
	type LucideIcon,
	Package,
	Rows3,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DiffView, parseDiff } from "../../lib/diff";
import { cx, formatClock, formatTimeAgo, resultDetails, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { PREVIEW_TEXT_CHARS } from "../../lib/preview";
import { useSessionStore } from "../../stores/session";
import { type ToolEntry, useToolsStore } from "../../stores/tools";
import { type DiffScope, useUiStore } from "../../stores/ui";
import { ContextMenu, type ContextMenuAnchor } from "../common/ContextMenu";
import { RepositoryChanges } from "./RepositoryChanges";
import {
	DiffBody,
	DiffFileCard,
	DiffStat,
	FileLabel,
	PanelEmpty,
	PanelToolbar,
	ToolbarIconButton,
} from "./workspace-ui";

const DIFF_TOOLS = new Set(["edit", "apply_patch", "ast_edit", "write"]);

export interface DiffCandidate {
	id: string;
	toolName: string;
	file: string;
	diff: string;
	timestamp: number;
	adds: number;
	removes: number;
	isError: boolean;
	isContent: boolean;
	isVirtual: boolean;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Best-effort file name from tool args, result details, or hashline input header. */
function deriveFile(args: Record<string, unknown>, diff: string, details: Record<string, unknown> | undefined): string {
	const path =
		asString(args.path) ??
		asString(args.file_path) ??
		asString(args.file) ??
		asString(details?.path) ??
		asString(details?.resolvedPath);
	if (path) return path;
	const header = diff.match(/^\[([^\]#]+)#/);
	return header?.[1] ?? "edit";
}

/** Keep multi-file results distinct; failed or pending writes are never counted as applied changes. */
export function buildEditCandidates(activeTools: ReadonlyMap<string, ToolEntry>): DiffCandidate[] {
	const out: DiffCandidate[] = [];
	for (const [id, entry] of activeTools) {
		if (!DIFF_TOOLS.has(entry.toolName) || (entry.status !== "done" && entry.status !== "error")) continue;
		const details = resultDetails(entry.result);
		const files = Array.isArray(details?.perFileResults) ? details.perFileResults : [details ?? {}];
		for (const [index, raw] of files.entries()) {
			if (!raw || typeof raw !== "object") continue;
			const fileResult = raw as Record<string, unknown>;
			const isError =
				fileResult.error != null || fileResult.isError === true || (entry.isError && files.length === 1);
			const actualDiff = asString(fileResult.diff);
			const isContent = isError || !actualDiff;
			const diff = isError
				? (asString(fileResult.error) ?? resultText(entry.result))
				: (actualDiff ?? (entry.toolName === "write" ? asString(entry.args.content) : null));
			if (diff === null) continue;
			const file = asString(fileResult.path) ?? deriveFile(entry.args, diff, details);
			const rows = isContent ? [] : parseDiff(diff);
			out.push({
				id: `${id}:${index}`,
				toolName: entry.toolName,
				file,
				diff,
				timestamp: entry.endTime ?? entry.startTime,
				adds: rows.filter(row => row.type === "add").length,
				removes: rows.filter(row => row.type === "remove").length,
				isError,
				isContent,
				isVirtual: /^[a-z][a-z0-9+.-]*:\/\//i.test(file) && !file.startsWith("file://"),
			});
		}
	}
	return out.sort((a, b) => b.timestamp - a.timestamp);
}

function EditPreview({ entry }: { entry: DiffCandidate }) {
	const t = useT();
	return entry.isContent ? (
		<div className="px-3 py-2">
			<p className={cx("mb-1.5 text-omp-xs", entry.isError ? "text-(--omp-error)" : "text-(--omp-dim)")}>
				{t(entry.isError ? "diffPanel.failedEdit" : "diffPanel.writtenContent")}
			</p>
			<pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-omp-xs leading-[1.45] text-(--omp-text-secondary)">
				{entry.diff.slice(0, PREVIEW_TEXT_CHARS)}
			</pre>
			{entry.diff.length > PREVIEW_TEXT_CHARS && (
				<p className="mt-1.5 text-omp-xs text-(--omp-warning)">{t("diffPanel.previewLimited")}</p>
			)}
		</div>
	) : (
		<DiffView diff={entry.diff} filePath={entry.file} className="py-1" />
	);
}

/** What an edit did: its line delta, "written" for content snapshots, or the failure. */
function EditOutcome({ entry }: { entry: DiffCandidate }) {
	const t = useT();
	if (entry.isError) return <span className="shrink-0 text-omp-xs text-(--omp-error)">{t("diffPanel.error")}</span>;
	if (entry.isContent) return <span className="shrink-0 text-omp-xs text-(--omp-dim)">{t("diffPanel.written")}</span>;
	return <DiffStat adds={entry.adds} removes={entry.removes} />;
}

// ─── Timeline view ──────────────────────────────────────────────────────────

interface FileGroup {
	file: string;
	edits: DiffCandidate[];
	adds: number;
	removes: number;
	latest: number;
}

/** Group edits (already newest-first) by file; groups sorted by latest activity. */
function buildFileGroups(candidates: DiffCandidate[]): FileGroup[] {
	const byFile = new Map<string, FileGroup>();
	for (const candidate of candidates) {
		let group = byFile.get(candidate.file);
		if (!group) {
			group = { file: candidate.file, edits: [], adds: 0, removes: 0, latest: 0 };
			byFile.set(candidate.file, group);
		}
		group.edits.push(candidate);
		group.adds += candidate.adds;
		group.removes += candidate.removes;
		group.latest = Math.max(group.latest, candidate.timestamp);
	}
	return [...byFile.values()].sort((a, b) => b.latest - a.latest);
}

type TimelineRow = { kind: "file"; group: FileGroup } | { kind: "edit"; entry: DiffCandidate };

const ACTIVITY_BINS = 36;

/** Compact sparkline/heat strip of edit activity across the session time span. */
function EditActivityStrip({ edits }: { edits: DiffCandidate[] }) {
	const t = useT();
	const activity = useMemo(() => {
		const bins = Array.from({ length: ACTIVITY_BINS }, () => ({ adds: 0, removes: 0, edits: 0 }));
		// `edits` arrives newest-first.
		const start = edits[edits.length - 1]?.timestamp ?? 0;
		const end = edits[0]?.timestamp ?? start;
		const span = Math.max(1, end - start);
		let peak = 1;
		for (const edit of edits) {
			const index = Math.min(ACTIVITY_BINS - 1, Math.floor(((edit.timestamp - start) / span) * ACTIVITY_BINS));
			const bin = bins[index];
			if (!bin) continue;
			bin.adds += edit.adds;
			bin.removes += edit.removes;
			bin.edits += 1;
			peak = Math.max(peak, bin.adds + bin.removes);
		}
		return { bins, peak, start, span };
	}, [edits]);

	return (
		<div aria-hidden className="flex h-7 items-stretch gap-px">
			{activity.bins.map((bin, index) => {
				const total = bin.adds + bin.removes;
				const binStart = activity.start + (activity.span * index) / ACTIVITY_BINS;
				const binEnd = activity.start + (activity.span * (index + 1)) / ACTIVITY_BINS;
				return (
					<div
						className="flex min-w-0 flex-1 flex-col justify-end"
						key={index}
						title={
							total === 0
								? undefined
								: t("diffPanel.activity", {
										edits: bin.edits,
										plural: bin.edits === 1 ? "" : "s",
										adds: bin.adds,
										removes: bin.removes,
										start: formatClock(binStart),
										end: formatClock(binEnd),
									})
						}
					>
						{total > 0 && (
							<div
								className="flex w-full flex-col overflow-hidden rounded-[2px]"
								style={{ height: `${Math.max(15, (total / activity.peak) * 100)}%` }}
							>
								<div
									className="bg-(--omp-diff-removed)"
									style={{ height: `${(bin.removes / total) * 100}%` }}
								/>
								<div className="bg-(--omp-diff-added)" style={{ height: `${(bin.adds / total) * 100}%` }} />
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function FileGroupHeader({
	group,
	collapsed,
	onToggle,
}: {
	group: FileGroup;
	collapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			aria-expanded={!collapsed}
			className="omp-diff-card-header flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-omp-sm"
			onClick={onToggle}
			type="button"
		>
			<ChevronRight
				aria-hidden="true"
				className={cx("omp-disclosure-chevron shrink-0 text-(--omp-dim)", !collapsed && "rotate-90")}
				size={13}
			/>
			<span className="min-w-0 flex-1">
				<FileLabel path={group.file} />
			</span>
			{group.adds + group.removes > 0 && <DiffStat adds={group.adds} removes={group.removes} />}
			<span className="w-7 shrink-0 text-right font-mono text-omp-xs tabular-nums text-(--omp-dim)">
				×{group.edits.length}
			</span>
		</button>
	);
}

function EditTimelineRow({
	entry,
	expanded,
	onToggle,
}: {
	entry: DiffCandidate;
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="omp-timeline-edit pb-0.5">
			<button
				aria-expanded={expanded}
				className="flex h-7 w-full items-center gap-2 rounded-md pr-3 pl-8 text-left text-omp-xs hover:bg-(--omp-sidebar-item-hover)"
				onClick={onToggle}
				type="button"
			>
				<span aria-hidden="true" className={cx("omp-timeline-dot", entry.isError && "omp-timeline-dot--error")} />
				<span className="shrink-0 text-(--omp-muted)">{entry.toolName}</span>
				<EditOutcome entry={entry} />
				<span className="ml-auto shrink-0 text-(--omp-dim)" title={formatClock(entry.timestamp)}>
					{formatTimeAgo(new Date(entry.timestamp).toISOString(), { compact: true })}
				</span>
			</button>
			{expanded && (
				<div className="omp-diff-card-body mt-0.5 mr-3 ml-8 overflow-hidden rounded-md border border-(--omp-border-muted)">
					<EditPreview entry={entry} />
				</div>
			)}
		</div>
	);
}

function DiffTimeline({ candidates }: { candidates: DiffCandidate[] }) {
	const t = useT();
	const groups = useMemo(() => buildFileGroups(candidates), [candidates]);
	const totals = useMemo(() => {
		let adds = 0;
		let removes = 0;
		for (const candidate of candidates) {
			adds += candidate.adds;
			removes += candidate.removes;
		}
		return { adds, removes };
	}, [candidates]);

	const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(new Set());
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const rows = useMemo<TimelineRow[]>(() => {
		const out: TimelineRow[] = [];
		for (const group of groups) {
			out.push({ kind: "file", group });
			if (collapsedFiles.has(group.file)) continue;
			for (const entry of group.edits) out.push({ kind: "edit", entry });
		}
		return out;
	}, [groups, collapsedFiles]);

	const parentRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => parentRef.current,
		estimateSize: index => {
			const row = rows[index];
			if (!row) return 28;
			if (row.kind === "file") return 32;
			return row.entry.id === expandedId ? 280 : 30;
		},
		overscan: 10,
		measureElement: element => element.getBoundingClientRect().height,
	});

	// Expanding/collapsing a diff changes row heights without changing the count.
	useEffect(() => {
		// The virtualizer reads expandedId indirectly through estimateSize.
		void expandedId;
		virtualizer.measure();
	}, [virtualizer, expandedId]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="space-y-2 px-3 pt-2.5 pb-2">
				<div className="flex items-center gap-2 text-omp-sm text-(--omp-muted)">
					<span className="min-w-0 flex-1 truncate">
						{t("diffPanel.summary", {
							edits: candidates.length,
							editPlural: candidates.length === 1 ? "" : "s",
							files: groups.length,
							filePlural: groups.length === 1 ? "" : "s",
						})}
					</span>
					{totals.adds + totals.removes > 0 && <DiffStat adds={totals.adds} removes={totals.removes} />}
				</div>
				{totals.adds + totals.removes > 0 && <EditActivityStrip edits={candidates} />}
			</div>

			<div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
				<div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
					{virtualizer.getVirtualItems().map(item => {
						const row = rows[item.index];
						if (!row) return null;
						return (
							<div
								data-index={item.index}
								key={row.kind === "file" ? `file:${row.group.file}` : row.entry.id}
								ref={virtualizer.measureElement}
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									transform: `translateY(${item.start}px)`,
								}}
							>
								{row.kind === "file" ? (
									<FileGroupHeader
										collapsed={collapsedFiles.has(row.group.file)}
										group={row.group}
										onToggle={() =>
											setCollapsedFiles(previous => {
												const next = new Set(previous);
												if (next.has(row.group.file)) next.delete(row.group.file);
												else next.add(row.group.file);
												return next;
											})
										}
									/>
								) : (
									<EditTimelineRow
										entry={row.entry}
										expanded={expandedId === row.entry.id}
										onToggle={() =>
											setExpandedId(previous => (previous === row.entry.id ? null : row.entry.id))
										}
									/>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

// ─── Session edits view ─────────────────────────────────────────────────────

/** The newest edit of every file, newest file first. */
function latestPerFile(candidates: DiffCandidate[]): DiffCandidate[] {
	const seen = new Set<string>();
	const out: DiffCandidate[] = [];
	for (const candidate of candidates) {
		if (seen.has(candidate.file)) continue;
		seen.add(candidate.file);
		out.push(candidate);
	}
	return out;
}

function SessionEdits({ candidates, split }: { candidates: DiffCandidate[]; split: boolean }) {
	const t = useT();
	const latest = useMemo(() => latestPerFile(candidates), [candidates]);
	// The newest file opens by default; anything the user toggles is theirs.
	const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
	const isOpen = (entry: DiffCandidate, index: number) => toggled.get(entry.id) ?? index === 0;
	const allOpen = latest.every(isOpen);
	const totals = useMemo(
		() =>
			latest.reduce((sum, entry) => ({ adds: sum.adds + entry.adds, removes: sum.removes + entry.removes }), {
				adds: 0,
				removes: 0,
			}),
		[latest],
	);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-9 shrink-0 items-center gap-2 pr-2 pl-3">
				<span className="min-w-0 flex-1 truncate text-omp-sm text-(--omp-muted)">
					{t("diffPanel.filesEdited", { count: latest.length, plural: latest.length === 1 ? "" : "s" })}
				</span>
				{totals.adds + totals.removes > 0 && <DiffStat adds={totals.adds} removes={totals.removes} />}
				{latest.length > 1 && (
					<ToolbarIconButton
						label={t(allOpen ? "diffPanel.collapseAll" : "diffPanel.expandAll")}
						onClick={() => setToggled(new Map(latest.map(entry => [entry.id, !allOpen])))}
					>
						{allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
					</ToolbarIconButton>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
				{latest.map((entry, index) => (
					<DiffFileCard
						key={entry.id}
						expanded={isOpen(entry, index)}
						onToggle={() => setToggled(previous => new Map(previous).set(entry.id, !isOpen(entry, index)))}
						label={<FileLabel path={entry.file} />}
						trailing={
							<>
								<EditOutcome entry={entry} />
								<span
									className="w-9 shrink-0 text-right text-omp-xs text-(--omp-dim)"
									title={formatClock(entry.timestamp)}
								>
									{formatTimeAgo(new Date(entry.timestamp).toISOString(), { compact: true })}
								</span>
							</>
						}
					>
						{split && !entry.isContent ? (
							<DiffBody diff={entry.diff} filePath={entry.file} split />
						) : (
							<EditPreview entry={entry} />
						)}
					</DiffFileCard>
				))}
			</div>
		</div>
	);
}

// ─── Panel ──────────────────────────────────────────────────────────────────

const MODES: { id: DiffScope; icon: LucideIcon }[] = [
	{ id: "repository", icon: GitCompareArrows },
	{ id: "current", icon: FilePen },
	{ id: "timeline", icon: History },
	{ id: "artifacts", icon: Package },
];

export function DiffPanel() {
	const t = useT();
	const activeTools = useToolsStore(state => state.activeTools);
	const [split, setSplit] = useState(false);
	// Store-owned so the transcript's "Review" link can open a specific scope.
	const mode = useUiStore(state => state.diffScope);
	const setMode = useUiStore(state => state.setDiffScope);
	const [scopeMenu, setScopeMenu] = useState<ContextMenuAnchor | null>(null);
	const sessionId = useSessionStore(state => state.sessionId);
	const allCandidates = useMemo(() => buildEditCandidates(activeTools), [activeTools]);
	const candidates = useMemo(
		() => allCandidates.filter(entry => (mode === "artifacts" ? entry.isVirtual : !entry.isVirtual)),
		[allCandidates, mode],
	);
	const current = MODES.find(entry => entry.id === mode) ?? MODES[0]!;
	const ScopeIcon = current.icon;
	const showLayout = mode === "repository" || (mode === "current" && candidates.some(entry => !entry.isContent));

	return (
		<div className="flex h-full flex-col">
			<span className="sr-only">{t("diffPanel.title")}</span>
			<PanelToolbar className="border-b border-(--omp-border-muted)">
				<button
					type="button"
					aria-label={t("diffPanel.scope.aria")}
					aria-haspopup="menu"
					aria-expanded={scopeMenu !== null}
					onClick={event => {
						const rect = event.currentTarget.getBoundingClientRect();
						setScopeMenu({
							x: Number.isFinite(rect.left) ? rect.left : 8,
							y: (Number.isFinite(rect.bottom) ? rect.bottom : 40) + 4,
						});
					}}
					className="omp-pressable -ml-1.5 flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-omp-md font-medium text-(--omp-text) hover:bg-(--omp-selected-bg)"
				>
					<ScopeIcon aria-hidden="true" size={14} className="shrink-0 text-(--omp-muted)" />
					<span className="truncate">{t(`diffPanel.mode.${mode}`)}</span>
					<ChevronDown aria-hidden="true" size={13} className="shrink-0 text-(--omp-dim)" />
				</button>
				<span className="flex-1" />
				{showLayout && (
					<div className="omp-segmented" role="group" aria-label={t("diffPanel.layout")}>
						<button
							aria-label={t("diffPanel.unified")}
							title={t("diffPanel.unified")}
							aria-pressed={!split}
							className="flex h-6 w-7 items-center justify-center"
							onClick={() => setSplit(false)}
							type="button"
						>
							<Rows3 size={13} />
						</button>
						<button
							aria-label={t("diffPanel.split")}
							title={t("diffPanel.split")}
							aria-pressed={split}
							className="flex h-6 w-7 items-center justify-center"
							onClick={() => setSplit(true)}
							type="button"
						>
							<Columns2 size={13} />
						</button>
					</div>
				)}
			</PanelToolbar>

			{mode === "repository" ? (
				<RepositoryChanges key={sessionId} split={split} />
			) : candidates.length === 0 ? (
				<PanelEmpty
					icon={mode === "artifacts" ? Package : FilePen}
					title={t(mode === "artifacts" ? "diffPanel.emptyArtifacts" : "diffPanel.empty")}
					hint={t(mode === "artifacts" ? "diffPanel.emptyArtifactsHint" : "diffPanel.emptyHint")}
				/>
			) : mode === "timeline" || mode === "artifacts" ? (
				<DiffTimeline candidates={candidates} />
			) : (
				<SessionEdits candidates={candidates} split={split} />
			)}

			{scopeMenu && (
				<ContextMenu
					x={scopeMenu.x}
					y={scopeMenu.y}
					onClose={() => setScopeMenu(null)}
					items={MODES.map(entry => ({
						id: `diff-mode-${entry.id}`,
						label: t(`diffPanel.mode.${entry.id}`),
						description: t(`diffPanel.mode.${entry.id}Description`),
						icon: entry.icon,
						hint: entry.id === mode ? "✓" : undefined,
						onSelect: () => {
							setMode(entry.id);
							setScopeMenu(null);
						},
					}))}
				/>
			)}
		</div>
	);
}
