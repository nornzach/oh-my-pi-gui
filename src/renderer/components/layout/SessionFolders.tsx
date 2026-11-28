import {
	Check,
	ChevronDown,
	ChevronRight,
	Folder,
	FolderOpen,
	FolderPlus,
	MoreHorizontal,
	Pencil,
	Trash2,
	X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSessionList } from "../../hooks/use-session-list";
import { basename, cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { onEscape } from "../../lib/keymap";
import { addFolderReferences, allowFolderDrop, dropOnFolder, type FolderSource } from "../../lib/session-folder-drag";
import { sessionDisplayTitle } from "../../lib/session-title";
import { isSubagentSession, listedSessions, sessionParents } from "../../lib/session-tree";
import { tabSignalPresentation } from "../../lib/tab-signal";
import { useSessionStore } from "../../stores/session";
import {
	DEFAULT_FOLDER,
	folderMembership,
	orderedFolders,
	tabFolderKey,
	useSessionFolders,
} from "../../stores/session-folders";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import { useTabsStore } from "../../stores/tabs";
import { Button } from "../common/Button";
import { anchorFromEvent, ContextMenu, type ContextMenuAnchor } from "../common/ContextMenu";
import { InlineConfirm } from "../common/InlineConfirm";

const iconButton =
	"no-drag omp-pressable flex size-6 shrink-0 items-center justify-center rounded-md text-(--omp-dim) hover:bg-(--omp-selected-bg) hover:text-(--omp-text)";

export function SessionFolderTree() {
	const t = useT();
	const folders = useSessionFolders(state => state.folders);
	const active = useSessionFolders(state => state.active);
	const ordered = useMemo(() => orderedFolders(folders), [folders]);
	const tabs = useTabsStore(state => state.tabs);
	const activeTabId = useTabsStore(state => state.activeTabId);
	const live = useSessionStore(state => state.isStreaming || state.isCompacting || state.isBackgroundCompacting);
	const hiddenDefaults = useSessionFolders(state => state.hidden);
	const runningFolders = useMemo(() => {
		const running = new Set<string>();
		if (!folders.length) return running;
		const membership = folderMembership(folders);
		const excluded = new Set(hiddenDefaults);
		for (const tab of tabs) {
			if (!tabSignalPresentation(tab, tab.id === activeTabId && live).running) continue;
			const key = tabFolderKey(tab);
			const owners = membership.get(key);
			if (owners) for (const owner of owners) running.add(owner);
			else if (!excluded.has(key)) running.add(DEFAULT_FOLDER);
		}
		for (let index = ordered.length - 1; index >= 0; index--) {
			const { folder } = ordered[index];
			if (running.has(folder.id) && folder.parentId !== DEFAULT_FOLDER) running.add(folder.parentId);
		}
		return running;
	}, [tabs, activeTabId, live, folders, hiddenDefaults, ordered]);
	const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
	const [dragOver, setDragOver] = useState<string | null>(null);
	const [menu, setMenu] = useState<{ id: string; anchor: ContextMenuAnchor } | null>(null);
	const [edit, setEdit] = useState<{ kind: "create" | "rename" | "delete"; id: string } | null>(null);
	const [name, setName] = useState("");
	const hidden = new Set<string>();
	const parents = new Set(folders.map(folder => folder.parentId));
	const rows = ordered.filter(({ folder }) => {
		if (!hidden.has(folder.parentId) && !folded.has(folder.parentId)) return true;
		hidden.add(folder.id);
		return false;
	});
	const start = (kind: "create" | "rename" | "delete", id: string) => {
		setMenu(null);
		setName(kind === "rename" ? (folders.find(folder => folder.id === id)?.name ?? "") : "");
		setEdit({ kind, id });
	};
	const save = () => {
		if (!edit || (edit.kind !== "delete" && !name.trim())) return;
		const state = useSessionFolders.getState();
		if (edit.kind === "create") {
			state.createFolder(name, edit.id);
			setFolded(previous => new Set([...previous].filter(id => id !== edit.id)));
		} else if (edit.kind === "rename") state.rename(edit.id, name);
		else {
			const before = useSessionFolders.getState();
			state.deleteFolder(edit.id);
			const tabs = useTabsStore.getState();
			void tabs.refreshFolderView().then(() => {
				const after = useSessionFolders.getState();
				for (const tab of tabs.tabs) {
					const key = tabFolderKey(tab);
					if (
						folderMembership(before.folders)
							.get(key)
							?.some(id => !after.views[id])
					) {
						void tabs.releaseUnreferencedTab(tab.id);
					}
				}
			});
		}
		setEdit(null);
	};

	const row = (id: string, label: string, depth: number) => {
		const current = active === id;
		const Icon = current ? FolderOpen : Folder;
		const working = runningFolders.has(id);
		const status = working ? t("sidebar.signal.running") : undefined;
		const expanded = !folded.has(id);
		return (
			<div
				key={id}
				className="group/folder flex min-w-0 items-center gap-0.5"
				style={{ paddingInlineStart: Math.min(depth, 8) * 10 }}
				onDragOver={event => {
					if (id === DEFAULT_FOLDER || !allowFolderDrop(event)) return;
					setDragOver(id);
					if (!expanded) setFolded(previous => new Set([...previous].filter(key => key !== id)));
				}}
				onDragLeave={event => {
					if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(null);
				}}
				onDrop={event => {
					if (id !== DEFAULT_FOLDER && dropOnFolder(event, id)) setDragOver(null);
				}}
			>
				{id !== DEFAULT_FOLDER && parents.has(id) ? (
					<button
						type="button"
						className={iconButton}
						aria-label={label}
						aria-expanded={expanded}
						onClick={() => {
							setFolded(previous => {
								const next = new Set(previous);
								if (next.has(id)) next.delete(id);
								else next.add(id);
								return next;
							});
						}}
					>
						{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
					</button>
				) : (
					<span className="w-6 shrink-0" />
				)}
				<button
					type="button"
					aria-current={current ? "page" : undefined}
					className={cx(
						"omp-pressable flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-start text-omp-sm hover:bg-(--omp-selected-bg)",
						current ? "bg-(--omp-selected-bg) text-(--omp-text)" : "text-(--omp-text-secondary)",
						dragOver === id && "bg-(--omp-selected-bg) ring-1 ring-inset ring-(--omp-accent)",
					)}
					title={working ? `${label} · ${status}` : label}
					aria-description={status}
					onClick={() => void useTabsStore.getState().selectFolder(id)}
					onContextMenu={
						id === DEFAULT_FOLDER
							? undefined
							: event => {
									event.preventDefault();
									setMenu({ id, anchor: anchorFromEvent(event) });
								}
					}
				>
					<span className="relative shrink-0" aria-hidden="true">
						<Icon
							aria-hidden="true"
							size={14}
							className={current ? "shrink-0 text-(--omp-accent)" : "shrink-0 text-(--omp-dim)"}
						/>
						{working && (
							<span className="pointer-events-none absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-(--omp-accent) ring-1 ring-(--omp-sidebar-bg) motion-safe:animate-pulse" />
						)}
					</span>
					<span className="truncate">{label}</span>
				</button>
				{id !== DEFAULT_FOLDER ? (
					<button
						type="button"
						className={cx(iconButton, "opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100")}
						aria-label={t("folders.actions", { name: label })}
						onClick={event => {
							const rect = event.currentTarget.getBoundingClientRect();
							setMenu({ id, anchor: { x: rect.left, y: rect.bottom + 4 } });
						}}
					>
						<MoreHorizontal size={13} />
					</button>
				) : (
					<span className="w-6 shrink-0" />
				)}
			</div>
		);
	};
	const editTitle = t(
		edit?.kind === "rename" ? "folders.rename" : edit?.kind === "delete" ? "folders.delete" : "folders.create",
	);
	const nameEditor = (depth: number) => (
		<FolderNameField
			key={`${edit?.kind}:${edit?.id}`}
			title={editTitle}
			name={name}
			onChange={setName}
			onSave={save}
			onCancel={() => setEdit(null)}
			depth={depth}
		/>
	);
	return (
		<section aria-label={t("folders.label")} className="flex min-h-0 shrink-0 flex-col">
			<div className="flex h-7 shrink-0 items-center ps-4 pe-2.5">
				<span className="min-w-0 flex-1 truncate text-omp-xs font-medium text-(--omp-dim)">
					{t("folders.label")}
				</span>
				<button
					type="button"
					className={iconButton}
					aria-label={t("folders.create")}
					title={t("folders.create")}
					onClick={() => start("create", DEFAULT_FOLDER)}
				>
					<FolderPlus size={14} />
				</button>
			</div>
			{(folders.length > 0 || edit?.kind === "create") && (
				<div className="max-h-[min(26vh,15rem)] overflow-y-auto px-2 pb-1">
					{edit?.kind === "create" && edit.id === DEFAULT_FOLDER && nameEditor(0)}
					{folders.length > 0 && row(DEFAULT_FOLDER, t("folders.default"), 0)}
					{rows.map(({ folder, depth }) => (
						<Fragment key={folder.id}>
							{edit?.kind === "rename" && edit.id === folder.id
								? nameEditor(depth)
								: row(folder.id, folder.name, depth)}
							{edit?.kind === "create" && edit.id === folder.id && nameEditor(depth + 1)}
							{edit?.kind === "delete" && edit.id === folder.id && (
								<InlineConfirm
									title={editTitle}
									message={t("folders.deleteBody", { name: folder.name })}
									confirmLabel={editTitle}
									onConfirm={save}
									onCancel={() => setEdit(null)}
								/>
							)}
						</Fragment>
					))}
				</div>
			)}
			{menu && (
				<ContextMenu
					{...menu.anchor}
					onClose={() => setMenu(null)}
					items={[
						{
							id: "folder-child",
							icon: FolderPlus,
							label: t("folders.createChild"),
							onSelect: () => start("create", menu.id),
						},
						{
							id: "folder-rename",
							icon: Pencil,
							label: t("folders.rename"),
							onSelect: () => start("rename", menu.id),
						},
						{
							id: "folder-delete",
							icon: Trash2,
							danger: true,
							label: t("folders.delete"),
							onSelect: () => start("delete", menu.id),
						},
					]}
				/>
			)}
		</section>
	);
}

function FolderNameField({
	title,
	name,
	onChange,
	onSave,
	onCancel,
	depth = 0,
}: {
	title: string;
	name: string;
	onChange: (name: string) => void;
	onSave: () => void;
	onCancel: () => void;
	depth?: number;
}) {
	const t = useT();
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);
	return (
		<form
			aria-label={title}
			className="flex min-w-0 items-center gap-0.5 py-0.5"
			style={{ paddingInlineStart: Math.min(depth, 8) * 10 + 4 }}
			onSubmit={event => {
				event.preventDefault();
				if (name.trim()) onSave();
			}}
			onBlur={event => {
				if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onCancel();
			}}
			onKeyDown={event => {
				if (event.key === "Enter" && isImeKeyEvent(event)) event.preventDefault();
				else if (onEscape(event, onCancel)) event.stopPropagation();
			}}
		>
			<Folder size={14} className="shrink-0 text-(--omp-dim)" />
			<input
				ref={input}
				value={name}
				maxLength={80}
				aria-label={t("folders.name")}
				placeholder={t("folders.name")}
				onChange={event => onChange(event.target.value)}
				className="h-7 min-w-0 flex-1 rounded-md border border-(--omp-border) bg-transparent px-1.5 text-omp-sm"
			/>
			<button className={iconButton} type="submit" disabled={!name.trim()} aria-label={title} title={title}>
				<Check size={13} />
			</button>
			<button
				className={iconButton}
				type="button"
				aria-label={t("common.cancel")}
				title={t("common.cancel")}
				onClick={onCancel}
			>
				<X size={13} />
			</button>
		</form>
	);
}

export function SessionFolderSwitcher() {
	const t = useT();
	const folders = useSessionFolders(state => state.folders);
	const active = useSessionFolders(state => state.active);
	const entries = useMemo(() => orderedFolders(folders), [folders]);
	const button = useRef<HTMLButtonElement>(null);
	const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
	const open = () => {
		const rect = button.current?.getBoundingClientRect();
		if (rect) setAnchor({ x: rect.left, y: rect.bottom + 3 });
	};
	useEffect(() => {
		if (!anchor) return;
		const close = () => setAnchor(null);
		let frame = 0;
		const afterDrop = () => {
			frame = requestAnimationFrame(close);
		};
		window.addEventListener("dragend", close, true);
		window.addEventListener("drop", afterDrop, true);
		window.addEventListener("resize", close);
		return () => {
			window.removeEventListener("dragend", close, true);
			window.removeEventListener("drop", afterDrop, true);
			cancelAnimationFrame(frame);
			window.removeEventListener("resize", close);
		};
	}, [anchor]);
	if (entries.length === 0) return null;
	const label = entries.find(entry => entry.folder.id === active)?.path ?? t("folders.default");
	const pick = (id: string) => {
		setAnchor(null);
		void useTabsStore.getState().selectFolder(id);
	};
	return (
		<>
			<button
				ref={button}
				type="button"
				aria-label={t("folders.switch", { name: label })}
				aria-haspopup="menu"
				aria-expanded={!!anchor}
				title={label}
				onClick={() => (anchor ? setAnchor(null) : open())}
				onDragOver={event => {
					if (allowFolderDrop(event) && !anchor) open();
				}}
				className="no-drag omp-pressable me-1 flex h-7 max-w-[32%] shrink-0 items-center gap-1.5 rounded-md px-2 text-omp-sm text-(--omp-text-secondary) hover:bg-(--omp-selected-bg)"
			>
				<FolderOpen size={14} className="shrink-0 text-(--omp-accent)" />
				<span className="min-w-0 truncate">{label}</span>
				<ChevronDown size={12} className="shrink-0 text-(--omp-dim)" />
			</button>
			{anchor && (
				<ContextMenu
					{...anchor}
					trigger={button.current}
					label={t("folders.label")}
					onClose={() => setAnchor(null)}
					items={[
						{ id: DEFAULT_FOLDER, path: t("folders.default") },
						...entries.map(({ folder, path }) => ({ id: folder.id, path })),
					].map(({ id, path }) => ({
						id,
						label: path,
						icon: id === active ? FolderOpen : Folder,
						current: id === active,
						onSelect: () => pick(id),
						onDragOver: id === DEFAULT_FOLDER ? undefined : allowFolderDrop,
						onDrop: event => {
							if (id !== DEFAULT_FOLDER && dropOnFolder(event, id)) setAnchor(null);
						},
					}))}
				/>
			)}
		</>
	);
}

export type FolderPicker = { source: FolderSource; anchor: ContextMenuAnchor };

export function EmptyFolderView() {
	const t = useT();
	const active = useSessionFolders(state => state.active);
	const folders = useSessionFolders(state => state.folders);
	const archived = useSidebarPrefs(state => state.archivedSessions);
	const lastUsed = useSidebarPrefs(state => state.sessionLastUsed);
	const { sessions } = useSessionList("global");
	const recent = useMemo(() => {
		const membership = folderMembership(folders);
		const archive = new Set(archived);
		const listed = listedSessions(sessions, session => membership.has(session.path)).sessions;
		const parents = sessionParents(listed);
		return listed
			.filter(session => {
				const assigned = membership.get(session.path);
				if (active === DEFAULT_FOLDER ? assigned : !assigned?.includes(active)) return false;
				if (isSubagentSession(session)) return false;
				for (let cursor: typeof session | undefined = session; cursor; cursor = parents.get(cursor.path)) {
					if (archive.has(cursor.path)) return false;
				}
				return true;
			})
			.sort(
				(first, second) =>
					(lastUsed[second.path] ?? Date.parse(second.modified)) -
					(lastUsed[first.path] ?? Date.parse(first.modified)),
			)
			.slice(0, 4);
	}, [active, folders, archived, lastUsed, sessions]);
	return (
		<section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6" data-empty-folder="">
			<p className="text-omp-md text-(--omp-muted)">{t(recent.length ? "folders.resume" : "folders.empty")}</p>
			{recent.length > 0 && (
				<div className="flex w-full max-w-sm flex-col">
					{recent.map(session => (
						<button
							type="button"
							key={session.path}
							className="omp-pressable flex min-w-0 items-baseline gap-3 rounded-md px-3 py-2 text-start hover:bg-(--omp-selected-bg)"
							onClick={() =>
								void useTabsStore.getState().openTab({
									sessionPath: session.path,
									kind: session.kind,
									cwd: session.cwd,
									folderId: active,
								})
							}
						>
							<span className="min-w-0 flex-1 truncate text-omp-md">
								{sessionDisplayTitle(session, t("sidebar.untitled"))}
							</span>
							<span className="max-w-32 truncate text-omp-xs text-(--omp-dim)" title={session.cwd}>
								{basename(session.cwd)}
							</span>
						</button>
					))}
				</div>
			)}
			<Button variant="secondary" onClick={() => void useTabsStore.getState().openTab({ work: true })}>
				{t("folders.start")}
			</Button>
		</section>
	);
}

export function AddToSessionFolders({ source, anchor, onClose }: FolderPicker & { onClose: () => void }) {
	const t = useT();
	const folders = useSessionFolders(state => state.folders);
	const entries = useMemo(() => orderedFolders(folders), [folders]);
	const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
	const [multiple, setMultiple] = useState("paths" in source && source.paths.length > 1);
	const [naming, setNaming] = useState(entries.length === 0);
	const [name, setName] = useState("");
	const tab = useTabsStore(state =>
		"tabId" in source ? state.tabs.find(entry => entry.id === source.tabId) : undefined,
	);
	const views = useSessionFolders(state => state.views);
	const paths = "paths" in source ? source.paths : tab ? [tabFolderKey(tab)] : [];
	const createAndAdd = () => {
		if (!paths.length) return onClose();
		const id = useSessionFolders.getState().createFolder(name, DEFAULT_FOLDER);
		if (!id) return;
		addFolderReferences(source, [...selection, id]);
		onClose();
	};
	return (
		<ContextMenu
			key={naming ? "create" : multiple ? "multiple" : "single"}
			{...anchor}
			label={t("folders.add")}
			onClose={onClose}
			editor={
				naming ? (
					<FolderNameField
						title={t("folders.createAndAdd")}
						name={name}
						onChange={setName}
						onSave={createAndAdd}
						onCancel={() => {
							if (!entries.length) onClose();
							else {
								setName("");
								setNaming(false);
							}
						}}
					/>
				) : undefined
			}
			items={[
				...entries.map(({ folder, path }) => {
					const alreadyAdded = paths.every(
						key => folder.sessions.includes(key) && (!tab || views[folder.id]?.order.includes(key)),
					);
					const checked = alreadyAdded || selection.has(folder.id);
					return {
						id: folder.id,
						label: path,
						icon: checked ? Check : Folder,
						checked: multiple ? checked : undefined,
						disabled: alreadyAdded,
						onSelect: () => {
							if (!multiple) {
								addFolderReferences(source, [folder.id]);
								onClose();
								return;
							}
							setSelection(previous => {
								const next = new Set(previous);
								if (!next.delete(folder.id)) next.add(folder.id);
								return next;
							});
						},
					};
				}),
				{ id: "new", label: t("folders.createAndAdd"), icon: FolderPlus, onSelect: () => setNaming(true) },
				...(multiple
					? [
							{
								id: "apply",
								label: t("folders.add"),
								icon: FolderPlus,
								disabled: !selection.size,
								onSelect: () => {
									addFolderReferences(source, [...selection]);
									onClose();
								},
							},
						]
					: entries.length > 1
						? [
								{
									id: "multiple",
									label: t("folders.multiple"),
									icon: FolderPlus,
									onSelect: () => setMultiple(true),
								},
							]
						: []),
			]}
		/>
	);
}
