/**
 * Memory window: what omp remembers about a project, where it learned it, and
 * the skills it taught itself — visible, correctable, erasable.
 *
 * Knowledge and Sources show one project's local memory (memory_summary.md,
 * the user's notes, captured lessons, and the sessions they came from).
 * Skills reviews the auto-learned skills, which are shared by all projects.
 */
import {
	AlertTriangle,
	Brain,
	CheckCircle2,
	ChevronDown,
	FolderOpen,
	MoreHorizontal,
	PowerOff,
	RefreshCw,
	Settings2,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSessionList } from "../../hooks/use-session-list";
import { cx, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isSubagentSession } from "../../lib/session-tree";
import { useSessionStore } from "../../stores/session";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import { usePendingSkillReviews } from "../../stores/skill-review";
import { toast } from "../../stores/toast";
import { type MemoryTabId, useUiStore } from "../../stores/ui";
import { Button, ConfirmDialog, Modal, Spinner, type TabItem, Tabs } from "../common";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { KnowledgeView } from "./KnowledgeView";
import { MemoryIntro, OtherBackend } from "./MemoryIntro";
import { type MemoryStatus, memoryProjects, memoryStatus } from "./memory-model";
import { SkillsView } from "./SkillsView";
import { SourcesView } from "./SourcesView";
import { type MemoryProject, useMemoryProject } from "./use-memory-project";

function iso(ms: number | undefined): string | undefined {
	return ms === undefined ? undefined : new Date(ms).toISOString();
}

/** A choice closes its menu before it acts (the menu leaves closing to its owner). */
function closing(items: ContextMenuItem[], close: () => void): ContextMenuItem[] {
	return items.map(item => ({
		...item,
		onSelect: () => {
			close();
			item.onSelect();
		},
	}));
}

function StatusLine({ status }: { status: MemoryStatus }) {
	const t = useT();
	switch (status.kind) {
		case "off":
			return <span className="text-(--omp-dim)">{t("memory.status.off")}</span>;
		case "reading":
			return (
				<span className="flex items-center gap-1.5 text-(--omp-muted)">
					<Spinner size="sm" />
					{status.elsewhere || status.total === 0
						? t("memory.status.readingElsewhere")
						: t("memory.status.reading", { done: Math.min(status.done + 1, status.total), total: status.total })}
				</span>
			);
		case "consolidating":
			return (
				<span className="flex items-center gap-1.5 text-(--omp-muted)">
					<Spinner size="sm" />
					{t("memory.status.consolidating")}
				</span>
			);
		case "failed":
			return (
				<span className="flex min-w-0 items-center gap-1.5 text-(--omp-warning)" title={status.error}>
					<AlertTriangle aria-hidden="true" className="shrink-0" size={13} />
					<span className="truncate">{t("memory.status.failed")}</span>
				</span>
			);
		case "empty":
			return (
				<span className="text-(--omp-dim)">
					{status.ready > 0
						? t("memory.status.emptyReady", { count: status.ready, plural: status.ready === 1 ? "" : "s" })
						: t("memory.status.empty")}
				</span>
			);
		case "current":
			return (
				<span className="flex min-w-0 items-center gap-1.5 text-(--omp-muted)">
					<CheckCircle2 aria-hidden="true" className="shrink-0 text-(--omp-success)" size={13} />
					<span className="truncate">
						{t("memory.status.current", { count: status.sessions, plural: status.sessions === 1 ? "" : "s" })}
						{status.updatedAt !== undefined && ` · ${formatTimeAgo(iso(status.updatedAt))}`}
						{status.ready > 0 && ` · ${t("memory.status.ready", { count: status.ready })}`}
					</span>
				</span>
			);
	}
}

function ProjectPicker({ cwd, onChange }: { cwd: string | null; onChange: (cwd: string) => void }) {
	const t = useT();
	const { sessions } = useSessionList("global");
	const aliases = useSidebarPrefs(state => state.groupAliases);
	const [workCwd, setWorkCwd] = useState<string | null>(null);
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

	useEffect(() => {
		void window.omp.sidecar
			.defaultWorkspace()
			.then(setWorkCwd)
			.catch(() => {});
	}, []);

	const projects = useMemo(
		() =>
			memoryProjects(
				sessions.filter(session => !isSubagentSession(session)),
				{ current: cwd, aliases, workCwd, workLabel: t("sidebar.mode.work") },
			),
		[aliases, cwd, sessions, t, workCwd],
	);
	const current = projects.find(project => project.cwd === cwd);
	const items: ContextMenuItem[] = projects.map(project => ({
		id: project.cwd,
		label: project.label,
		description: project.cwd,
		icon: project.cwd === cwd ? CheckCircle2 : undefined,
		onSelect: () => onChange(project.cwd),
	}));

	return (
		<>
			<button
				aria-haspopup="menu"
				className="omp-pressable inline-flex h-7 min-w-0 max-w-72 items-center gap-1.5 rounded-lg border border-(--omp-border-muted) px-2 text-omp-sm font-normal tracking-normal text-(--omp-text-secondary) hover:border-(--omp-border-strong) hover:text-(--omp-text)"
				disabled={projects.length === 0}
				onClick={event => {
					const box = event.currentTarget.getBoundingClientRect();
					setMenu({ x: box.left, y: box.bottom + 4 });
				}}
				title={cwd ?? undefined}
				type="button"
			>
				<FolderOpen aria-hidden="true" className="shrink-0 text-(--omp-muted)" size={13} />
				<span className="truncate">{current?.label ?? t("memory.project.none")}</span>
				<ChevronDown aria-hidden="true" className="shrink-0 text-(--omp-dim)" size={12} />
			</button>
			{menu && (
				<ContextMenu
					items={closing(items, () => setMenu(null))}
					onClose={() => setMenu(null)}
					x={menu.x}
					y={menu.y}
				/>
			)}
		</>
	);
}

function ProjectActions({ project, onErase }: { project: MemoryProject; onErase: () => void }) {
	const t = useT();
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const overview = project.overview;
	const running = overview?.activity !== undefined;
	const items: ContextMenuItem[] = [
		{
			id: "settings",
			label: t("memory.menu.settings"),
			icon: Settings2,
			onSelect: () => useUiStore.getState().openSettings("memory"),
		},
		{
			id: "folder",
			label: t("memory.menu.folder"),
			icon: FolderOpen,
			disabled: !overview || (!overview.summary && overview.notes.length === 0 && overview.lessons.length === 0),
			onSelect: () => {
				if (overview) void window.omp.system.openPath(overview.root);
			},
		},
	];
	if (overview?.enabled) {
		items.push({
			id: "off",
			label: t("memory.menu.turnOff"),
			description: t("memory.menu.turnOffHint"),
			icon: PowerOff,
			onSelect: () => {
				void project.setEnabled(false).then(ok => {
					if (ok) toast({ variant: "info", message: t("memory.toast.off") });
				});
			},
		});
	}
	items.push({
		id: "erase",
		label: t("memory.menu.erase"),
		icon: Trash2,
		danger: true,
		disabled: !overview || running,
		disabledReason: running ? t("memory.menu.eraseBusy") : undefined,
		onSelect: onErase,
	});
	return (
		<>
			<button
				aria-haspopup="menu"
				aria-label={t("memory.menu.label")}
				className="rounded-lg p-1.5 text-(--omp-muted) transition-colors hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) disabled:opacity-40"
				disabled={!project.connected}
				onClick={event => {
					const box = event.currentTarget.getBoundingClientRect();
					setMenu({ x: box.right - 240, y: box.bottom + 4 });
				}}
				type="button"
			>
				<MoreHorizontal size={15} />
			</button>
			{menu && (
				<ContextMenu
					items={closing(items, () => setMenu(null))}
					onClose={() => setMenu(null)}
					x={menu.x}
					y={menu.y}
				/>
			)}
		</>
	);
}

export function MemoryWindow() {
	const t = useT();
	const open = useUiStore(state => state.memoryOpen);
	const tab = useUiStore(state => state.memoryTab);
	const close = useUiStore(state => state.closeMemory);
	const sessionCwd = useSessionStore(state => state.cwd);
	const pendingSkills = usePendingSkillReviews();
	const [cwd, setCwd] = useState<string | null>(null);
	const [eraseOpen, setEraseOpen] = useState(false);
	const [erasing, setErasing] = useState(false);
	const [updating, setUpdating] = useState(false);

	// Each opening starts on the project being worked in.
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow the session only when the window opens
	useEffect(() => {
		if (open) setCwd(sessionCwd || null);
	}, [open]);

	const project = useMemoryProject(open, cwd);
	const overview = project.overview;
	const status = overview ? memoryStatus(overview) : null;
	const running = overview?.activity !== undefined;
	const local = overview?.backend === "local" || overview?.backend === "off";

	const tabs: TabItem[] = useMemo(
		() => [
			{ id: "knowledge", label: t("memory.tab.knowledge") },
			{ id: "skills", label: t("memory.tab.skills"), badge: pendingSkills > 0 ? pendingSkills : undefined },
			{ id: "sources", label: t("memory.tab.sources") },
		],
		[pendingSkills, t],
	);

	const runUpdate = async () => {
		setUpdating(true);
		try {
			await project.update();
		} finally {
			setUpdating(false);
		}
	};

	const erase = async () => {
		setErasing(true);
		try {
			const result = await project.edit({ kind: "erase" });
			if (result?.ok) toast({ variant: "success", message: t("memory.toast.erased") });
		} finally {
			setErasing(false);
			setEraseOpen(false);
		}
	};

	const projectBody = () => {
		if (!project.connected) {
			return (
				<div className="flex h-full items-center justify-center gap-2 text-omp-sm text-(--omp-dim)">
					<Spinner size="sm" />
					{t("memory.connecting")}
				</div>
			);
		}
		if (!cwd) {
			return (
				<div className="flex h-full items-center justify-center text-omp-sm text-(--omp-dim)">
					{t("memory.project.pick")}
				</div>
			);
		}
		if (project.error && !overview) {
			return (
				<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
					<AlertTriangle className="text-(--omp-warning)" size={20} />
					<p className="max-w-md text-omp-sm text-(--omp-muted)">{project.error}</p>
					<Button onClick={() => void project.reload()} size="sm">
						{t("common.retry")}
					</Button>
				</div>
			);
		}
		if (!overview) {
			return (
				<div className="flex h-full items-center justify-center">
					<Spinner size="md" />
				</div>
			);
		}
		if (!local) return <OtherBackend backend={overview.backend} onSwitch={() => void project.setEnabled(true)} />;
		if (!overview.enabled) return <MemoryIntro overview={overview} onEnable={() => project.setEnabled(true)} />;
		if (tab === "sources") return <SourcesView onOpenSession={close} overview={overview} project={project} />;
		return (
			<KnowledgeView
				onUpdate={() => void runUpdate()}
				overview={overview}
				project={project}
				updating={updating || running}
			/>
		);
	};

	return (
		<Modal
			bodyClassName="p-0"
			onClose={close}
			open={open}
			size="lg"
			title={
				<span className="flex min-w-0 items-center gap-2.5">
					<Brain aria-hidden="true" className="shrink-0 text-(--omp-accent)" size={17} strokeWidth={1.75} />
					<span className="shrink-0">{t("memory.title")}</span>
					{tab !== "skills" && <ProjectPicker cwd={cwd} onChange={setCwd} />}
				</span>
			}
		>
			<div className="flex h-[min(78dvh,52rem)] min-h-0 flex-col">
				<div className="flex shrink-0 items-center gap-3 border-b border-(--omp-border-muted) pr-3 pl-4">
					<Tabs
						activeId={tab}
						ariaLabel={t("memory.title")}
						className="-mb-px shrink-0 border-b-0"
						onChange={id => useUiStore.setState({ memoryTab: id as MemoryTabId })}
						tabs={tabs}
					/>
					<div className="min-w-0 flex-1" />
					{tab !== "skills" && status && (
						<div className="flex min-w-0 items-center gap-2 text-omp-sm">
							<StatusLine status={status} />
							{overview?.enabled && local && (
								<Button
									className={cx(running && "pointer-events-none")}
									disabled={running || updating}
									icon={<RefreshCw size={12} />}
									onClick={() => void runUpdate()}
									size="sm"
									title={t("memory.update.hint")}
									variant="secondary"
								>
									{t("memory.update.label")}
								</Button>
							)}
						</div>
					)}
					{tab !== "skills" && <ProjectActions onErase={() => setEraseOpen(true)} project={project} />}
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{tab === "skills" ? <SkillsView open={open} /> : projectBody()}
				</div>
			</div>
			<ConfirmDialog
				busy={erasing}
				confirmLabel={t("memory.erase.confirm")}
				message={t("memory.erase.message")}
				onCancel={() => setEraseOpen(false)}
				onConfirm={() => void erase()}
				open={eraseOpen}
				title={t("memory.erase.title")}
				warning={t("memory.erase.warning")}
			/>
		</Modal>
	);
}
