/**
 * Files panel: workspace file tree sourced via the dedicated `fs:explore` /
 * `fs:read` / `fs:read-image` main-process IPC (node:fs — cross-platform, works
 * with no live agent session), in-drawer preview, and @mention insertion via
 * the "omp:insert-mention" window event.
 */

import {
	AtSign,
	Check,
	Copy,
	ExternalLink as ExternalLinkIcon,
	Eye,
	EyeOff,
	File,
	FileX,
	Folder,
	FolderOpen,
	FolderX,
	RefreshCw,
	X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type DocumentPage, HTML_DOCUMENT, OFFICE_DOCUMENT, TABLE_DOCUMENT } from "../../../shared/document-preview";
import type { FileEditFailure, FsTreeEntry } from "../../../shared/ipc-types";
import { isSessionOutputPath } from "../../../shared/session-output";
import { describeError } from "../../lib/errors";
import { basename, copyText, formatBytes } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isSelectAll } from "../../lib/keymap";
import { MarkdownRenderer } from "../../lib/markdown";
import { useSessionStore } from "../../stores/session";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { useUiStore } from "../../stores/ui";
import { Button, Spinner } from "../common";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { ZoomableImage } from "../common/ImageViewer";
import { showPathMenu } from "../common/LinkMenu";
import { type TreeNode, TreeView } from "../common/TreeView";
import { PathLink } from "../tools/PathLink";
import { DelimitedTable, DocumentPreview } from "./DocumentPreview";
import { FileTabStrip } from "./FileTabStrip";
import {
	EMPTY_FILE_TABS,
	hasFormattedPreview,
	projectRelativeFile,
	useFileTabs,
	type WorkspaceFileTab,
} from "./file-tabs";
import { useWorkspaceExplorer } from "./use-workspace-explorer";
import { setFileDraft, useFileDrafts, WorkspaceFileEditor } from "./WorkspaceFileEditor";
import { FileLabel, PanelEmpty, PanelSearch, PanelToolbar, ToolbarIconButton } from "./workspace-ui";

const PREVIEW_MAX_BYTES = 200_000;
const SVG_NAME = /\.svg$/i;
const SVG_MIME = "image/svg+xml";

interface PreviewImage {
	url: string;
	mime: string | null;
	bytes?: number;
}

interface PreviewState {
	path: string;
	content: string | null;
	image: PreviewImage | null;
	pages: DocumentPage[] | null;
	/** What to say about the file when there is nothing of it to show. */
	notice: { title: string; hint?: string } | null;
	loading: boolean;
	truncated: boolean;
}

const NOTHING_LOADED = { content: null, image: null, pages: null, notice: null, loading: false, truncated: false };

function expandedFolders(path: string): string[] {
	const parts = path.split("/");
	return parts.map((_, index) => `dir:${parts.slice(0, index + 1).join("/")}`);
}

/** Select exactly `node`'s text, as the browser's own select-all would select the page. */
function selectContents(node: Node): void {
	const selection = window.getSelection();
	if (!selection) return;
	const range = document.createRange();
	range.selectNodeContents(node);
	selection.removeAllRanges();
	selection.addRange(range);
}

/** Fits the panel's width; a click opens the full-window viewer to zoom in. */
function ImagePreview({
	image,
	name,
	contentRef,
	onFailed,
}: {
	image: PreviewImage;
	name: string;
	contentRef: (node: HTMLElement | null) => void;
	onFailed: () => void;
}) {
	const [pixels, setPixels] = useState<string | null>(null);
	return (
		<div ref={contentRef} className="flex min-h-full flex-col items-center justify-center gap-2 p-4">
			<ZoomableImage
				src={image.url}
				alt={name}
				className="omp-image-checker block h-auto max-w-full rounded-md border border-(--omp-border-muted)"
				onLoad={event => {
					const { naturalWidth, naturalHeight } = event.currentTarget;
					// A vector has no pixel size of its own; the browser would report a default.
					if (image.mime !== SVG_MIME && naturalWidth > 0) setPixels(`${naturalWidth} × ${naturalHeight}`);
				}}
				onError={onFailed}
			/>
			{(pixels || image.bytes !== undefined) && (
				<span className="text-omp-xs text-(--omp-dim)">
					{[pixels, image.bytes === undefined ? null : formatBytes(image.bytes)].filter(Boolean).join(" · ")}
				</span>
			)}
		</div>
	);
}

export function FilesPanel() {
	const t = useT();
	const tabId = useRuntimeTabId();
	const cwd = useSessionStore(state => state.cwd);
	const sessionFile = useSessionStore(state => state.sessionFile);
	const sessionScope = `${tabId ?? ""}\0${sessionFile ?? ""}`;
	const requestedPath = useUiStore(s => s.filePreviewPath);
	const requestedLine = useUiStore(s => s.filePreviewLine);
	const requestId = useUiStore(s => s.filePreviewRequestId);
	const filePreviewImage = useUiStore(s => s.filePreviewImage);
	const openFilePreview = useUiStore(s => s.openFilePreview);
	const closeFilePreview = useUiStore(s => s.closeFilePreview);
	const workspace = useFileTabs(state => state.workspaces.get(cwd) ?? EMPTY_FILE_TABS);
	const activeTab = filePreviewImage
		? undefined
		: workspace.tabs.find(
				tab =>
					tab.id === workspace.activeId &&
					(!isSessionOutputPath(tab.path) || workspace.sessionScope === sessionScope),
			);
	const filePreviewPath = activeTab?.path ?? null;
	const filePreviewLine = activeTab?.line ?? null;
	useLayoutEffect(() => {
		const changed = useFileTabs.getState().scopeSession(cwd, sessionScope);
		if (changed && requestedPath && isSessionOutputPath(requestedPath)) {
			closeFilePreview();
			return;
		}
		if (requestedPath) useFileTabs.getState().open(cwd, requestedPath, requestedLine, requestId);
	}, [cwd, sessionScope, requestedPath, requestedLine, requestId, closeFilePreview]);
	const previewVersion = useRef(0);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const { directories, query, term, setQuery, showIgnored, setShowIgnored, search, refresh } = useWorkspaceExplorer(
		cwd,
		tabId,
		expanded,
	);
	const [preview, setPreview] = useState<PreviewState | null>(null);
	const [treeShare, setTreeShare] = useState(32);
	const [editError, setEditError] = useState<{ id: string; failure: FileEditFailure; detail?: string } | null>(null);
	const [closingTab, setClosingTab] = useState<WorkspaceFileTab | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const resizing = useRef(false);

	const treePath = filePreviewPath ? projectRelativeFile(cwd, filePreviewPath) : null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: expansion belongs to the active workspace.
	useEffect(() => setExpanded(new Set()), [cwd, tabId]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: rebuild the selected path after switching workspaces.
	useEffect(() => {
		if (!treePath?.includes("/")) return;
		const ancestors = expandedFolders(treePath.slice(0, treePath.lastIndexOf("/")));
		setExpanded(current => new Set([...current, ...ancestors]));
	}, [treePath, cwd, tabId]);

	const draftId = activeTab?.id ?? "";
	const hasDraft = useFileDrafts(state => state.drafts.has(draftId));
	const editStatus = editError?.id === draftId ? editError : null;

	function removeTab(tab: WorkspaceFileTab) {
		if (useFileDrafts.getState().drafts.get(tab.id)?.saving) return;
		useFileTabs.getState().remove(cwd, tab.id);
		setFileDraft(tab.id, null);
		setClosingTab(null);
		if (tab.id !== activeTab?.id) return;
		const remaining = useFileTabs.getState().workspaces.get(cwd);
		const next = remaining?.tabs.find(item => item.id === remaining.activeId);
		if (next) openFilePreview(next.path);
		else closeFilePreview();
	}

	function requestTabClose(tab: WorkspaceFileTab) {
		const draft = useFileDrafts.getState().drafts.get(tab.id);
		if (draft && draft.content !== draft.initial) setClosingTab(tab);
		else removeTab(tab);
	}

	const openPreview = useCallback(
		async (path: string) => {
			const version = ++previewVersion.current;
			setPreview({ ...NOTHING_LOADED, path, loading: true });
			try {
				if (OFFICE_DOCUMENT.test(path)) {
					const document = await window.omp.fs.documentPreview(path, false, tabId ?? undefined);
					if (version !== previewVersion.current) return;
					setPreview({
						...NOTHING_LOADED,
						path,
						pages: document.kind === "document" ? document.pages : null,
						truncated: document.kind === "document" && document.incomplete,
						notice: document.kind === "document" ? null : { title: t("filesPanel.binary") },
					});
					return;
				}
				const result = tabId
					? await window.omp.fs.read(path, PREVIEW_MAX_BYTES, tabId)
					: await window.omp.fs.read(path, PREVIEW_MAX_BYTES);
				if (version !== previewVersion.current) return;
				if (!result.ok) {
					setPreview({
						...NOTHING_LOADED,
						path,
						notice: { title: t("filesPanel.readFailed"), hint: describeError(result.error) },
					});
					return;
				}
				// Binary content is an image or it isn't, whatever its name says. SVG
				// is text, so only its name says to draw it.
				const read =
					result.binary || SVG_NAME.test(path)
						? await window.omp.fs.readImage(path, tabId ?? undefined).catch(() => null)
						: null;
				if (version !== previewVersion.current) return;
				const image = read?.ok && read.dataUrl ? { url: read.dataUrl, mime: read.mime, bytes: read.size } : null;
				if (result.binary && !image) {
					const notice = read?.tooLarge
						? {
								title: t("filesPanel.imageTooLarge"),
								hint: t("filesPanel.imageTooLargeHint", { size: formatBytes(read.size) }),
							}
						: { title: t("filesPanel.binary") };
					setPreview({ ...NOTHING_LOADED, path, notice });
					return;
				}
				setPreview({
					...NOTHING_LOADED,
					path,
					content: result.binary ? null : result.content,
					truncated: result.truncated,
					image,
				});
			} catch (error) {
				if (version !== previewVersion.current) return;
				setPreview({
					...NOTHING_LOADED,
					path,
					notice: { title: t("filesPanel.readFailed"), hint: describeError(error) },
				});
			}
		},
		[t, tabId],
	);

	// The bytes passed the sniff but didn't decode. An SVG still has its source to show.
	const onImageFailed = useCallback(() => {
		setPreview(current => {
			if (!current) return current;
			const notice = current.content
				? null
				: { title: t("filesPanel.imageFailed"), hint: t("filesPanel.imageFailedHint") };
			return { ...current, image: null, notice };
		});
	}, [t]);

	useEffect(() => {
		if (filePreviewPath) void openPreview(filePreviewPath);
		else setPreview(null);
		return () => {
			previewVersion.current++;
		};
	}, [filePreviewPath, openPreview]);

	const insertMention = useCallback(
		(path: string) => {
			window.dispatchEvent(new CustomEvent("omp:insert-mention", { detail: { path, tabId } }));
		},
		[tabId],
	);

	// Wire file activation: clicking a file previews it, clicking a dir toggles.
	const onNodeClick = useCallback(
		(id: string) => {
			if (id.startsWith("file:")) openFilePreview(id.slice(5));
			else if (id.startsWith("dir:")) {
				if (term) {
					setQuery("");
					setExpanded(prev => new Set([...prev, ...expandedFolders(id.slice(4))]));
					return;
				}
				setExpanded(prev => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			}
		},
		[openFilePreview, term, setQuery],
	);

	const directory = term ? search : directories.get("");
	const nodes = useMemo<TreeNode[]>(() => {
		const toNode = (entry: FsTreeEntry): TreeNode => {
			const id = `${entry.kind}:${entry.path}`;
			const isDir = entry.kind === "dir";
			const children = directories.get(entry.path);
			const entries = children?.entries ?? entry.children;
			return {
				id,
				label: term ? <FileLabel path={entry.path} /> : entry.name,
				icon: isDir ? expanded.has(id) ? <FolderOpen size={14} /> : <Folder size={14} /> : <File size={14} />,
				onClick: () => onNodeClick(id),
				onContextMenu: event => showPathMenu(event, entry.path, tabId),
				hasChildren: isDir && !term && (!entries || entries.length > 0 || children?.ok === false),
				children:
					isDir && !term
						? children?.ok === false
							? [
									{
										id: `error:${entry.path}`,
										label: <span title={children.error}>{t("filesPanel.unavailable")}</span>,
									},
								]
							: entries?.map(toNode)
						: undefined,
			};
		};
		return (directory?.entries ?? []).map(toNode);
	}, [directory, directories, term, expanded, onNodeClick, tabId, t]);

	const activePreview = preview?.path === filePreviewPath ? preview : null;
	const formattedFile = !!filePreviewPath && hasFormattedPreview(filePreviewPath);
	const formattedPreview = formattedFile && activeTab?.view === "preview";
	const previewDraft = useFileDrafts(state => (formattedPreview ? state.drafts.get(draftId)?.content : undefined));
	// An SVG draws on the same terms: a link that named a line wants its source.
	const previewImage = filePreviewLine === null || !activePreview?.content ? (activePreview?.image ?? null) : null;
	const editing = hasDraft && !formattedPreview && !previewImage;
	const wantsEditor =
		!isSessionOutputPath(filePreviewPath ?? "") &&
		!formattedPreview &&
		!previewImage &&
		typeof activePreview?.content === "string" &&
		typeof window.omp?.fs?.openEdit === "function";
	useEffect(() => {
		if (!filePreviewPath || !wantsEditor || hasDraft) return;
		let cancelled = false;
		setEditError(null);
		void window.omp.fs
			.openEdit({ path: filePreviewPath, tabId: tabId ?? undefined })
			.then(result => {
				if (cancelled) return;
				if (result.ok) {
					if (!useFileDrafts.getState().drafts.has(draftId)) {
						setFileDraft(draftId, {
							initial: result.content,
							content: result.content,
							revision: result.revision,
						});
					}
				} else setEditError({ id: draftId, failure: result.reason, detail: result.detail });
			})
			.catch(error => {
				if (!cancelled) setEditError({ id: draftId, failure: "io", detail: describeError(error) });
			});
		return () => {
			cancelled = true;
		};
	}, [draftId, filePreviewPath, tabId, wantsEditor, hasDraft]);
	const previewLines = useMemo(() => {
		const content = activePreview?.content;
		if (!content || formattedPreview) return 0;
		// A trailing newline ends the last line; it does not start another.
		return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
	}, [activePreview?.content, formattedPreview]);
	const [copied, setCopied] = useState(false);

	// A link that named a line (`src/a.ts:42`) lands on it: scrolled into view
	// a third of the way down, with the line marked.
	const markedLine = filePreviewLine !== null && filePreviewLine <= previewLines ? filePreviewLine : null;
	const previewScrollRef = useRef<HTMLDivElement>(null);
	/** The file's text (code or rendered Markdown), without the line numbers. */
	const previewContentRef = useRef<HTMLElement | null>(null);
	const setPreviewContent = useCallback((node: HTMLElement | null) => {
		previewContentRef.current = node;
	}, []);
	const gutterRef = useRef<HTMLDivElement>(null);
	const [lineBand, setLineBand] = useState<{ top: number; height: number } | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the rows are measured from the DOM, so a newly loaded file at the same line must measure again.
	useLayoutEffect(() => {
		const gutter = gutterRef.current;
		const scroller = previewScrollRef.current;
		const row = markedLine && gutter ? gutter.children[markedLine - 1] : undefined;
		if (!gutter || !scroller || !(row instanceof HTMLElement)) {
			setLineBand(null);
			return;
		}
		const top = gutter.offsetTop + row.offsetTop;
		setLineBand({ top, height: row.offsetHeight });
		scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
	}, [markedLine, activePreview?.content]);

	const hasPreview = Boolean(filePreviewPath || filePreviewImage);
	const previewBody =
		filePreviewPath && activeTab ? (
			<div className="omp-file-preview flex min-h-0 min-w-0 flex-1 flex-col">
				<PanelToolbar className="omp-file-preview-toolbar gap-1 border-b border-(--omp-border-muted) pl-1.5">
					<span className="omp-file-preview-label min-w-0 flex-1 px-1 text-omp-sm font-medium">
						<FileLabel path={filePreviewPath} />
					</span>
					{formattedFile && (
						<div className="omp-segmented no-drag flex shrink-0">
							{(["source", "preview"] as const).map(view => (
								<button
									aria-pressed={activeTab.view === view}
									className="rounded px-2 py-1 text-omp-xs aria-pressed:bg-(--omp-selected-bg)"
									key={view}
									onClick={() => useFileTabs.getState().changeView(cwd, activeTab.id, view)}
									type="button"
								>
									{t(`filesPanel.${view}`)}
								</button>
							))}
						</div>
					)}
					<ToolbarIconButton
						label={t(copied ? "filesPanel.copied" : "filesPanel.copyPath")}
						onClick={() =>
							void copyText(filePreviewPath).then(ok => {
								if (!ok) return;
								setCopied(true);
								window.setTimeout(() => setCopied(false), 1400);
							})
						}
					>
						{copied ? <Check size={14} className="text-(--omp-success)" /> : <Copy size={14} />}
					</ToolbarIconButton>
					<ToolbarIconButton
						label={t("filesPanel.insertMention")}
						onClick={() => {
							insertMention(filePreviewPath);
						}}
					>
						<AtSign size={14} />
					</ToolbarIconButton>
					<PathLink
						path={filePreviewPath}
						external
						label={t("filesPanel.openExternal")}
						className="omp-pressable flex size-7 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-text) hover:no-underline"
					>
						<ExternalLinkIcon size={14} />
					</PathLink>
				</PanelToolbar>
				{!formattedPreview && editStatus && (
					<p className="shrink-0 px-3 py-2 text-omp-sm text-(--omp-error)" role="alert" title={editStatus.detail}>
						{t(`filesPanel.editError.${editStatus.failure}`)}
					</p>
				)}
				{editing ? (
					<WorkspaceFileEditor
						key={draftId}
						draftId={draftId}
						path={filePreviewPath}
						tabId={tabId}
						line={filePreviewLine}
						lineRequest={activeTab.lineRequest}
					/>
				) : (
					<div
						ref={previewScrollRef}
						tabIndex={-1}
						data-file-preview=""
						onKeyDown={event => {
							if (!isSelectAll(event) || !previewContentRef.current) return;
							event.preventDefault();
							selectContents(previewContentRef.current);
						}}
						className="min-h-0 flex-1 overflow-auto bg-(--omp-code-bg) outline-none"
					>
						{!activePreview || activePreview.loading || (wantsEditor && !editStatus) ? (
							<div className="flex items-center gap-2 p-4">
								<Spinner size="sm" />
								<span className="text-omp-sm text-(--omp-dim)">{t("filesPanel.reading")}</span>
							</div>
						) : activePreview.notice ? (
							<PanelEmpty icon={FileX} title={activePreview.notice.title} hint={activePreview.notice.hint} />
						) : previewImage ? (
							<ImagePreview
								image={previewImage}
								name={basename(filePreviewPath)}
								contentRef={setPreviewContent}
								onFailed={onImageFailed}
							/>
						) : activePreview.pages ? (
							<DocumentPreview
								key={filePreviewPath}
								title={basename(filePreviewPath)}
								pages={activePreview.pages}
								incomplete={activePreview.truncated}
							/>
						) : formattedPreview && HTML_DOCUMENT.test(filePreviewPath) ? (
							<DocumentPreview
								key={filePreviewPath}
								title={basename(filePreviewPath)}
								pages={[{ html: previewDraft ?? activePreview.content ?? "" }]}
							/>
						) : formattedPreview && TABLE_DOCUMENT.test(filePreviewPath) ? (
							<DelimitedTable content={previewDraft ?? activePreview.content ?? ""} path={filePreviewPath} />
						) : formattedPreview ? (
							<div ref={setPreviewContent} className="mx-auto max-w-3xl px-5 py-4 text-omp-md text-(--omp-text)">
								<MarkdownRenderer
									content={previewDraft ?? activePreview.content ?? ""}
									sourcePath={filePreviewPath}
								/>
								{previewDraft === undefined && activePreview.truncated && (
									<div className="mt-3 text-omp-xs text-(--omp-dim)">
										{t("filesPanel.truncated", { kb: PREVIEW_MAX_BYTES / 1000 })}
									</div>
								)}
							</div>
						) : (
							<div className="relative flex min-w-max py-2 font-mono text-omp-xs leading-[1.6]">
								{lineBand && (
									<div
										aria-hidden="true"
										data-marked-line={markedLine ?? undefined}
										className="pointer-events-none absolute inset-x-0 bg-[var(--omp-accent)]/12"
										style={{ top: lineBand.top, height: lineBand.height }}
									/>
								)}
								<div
									ref={gutterRef}
									aria-hidden="true"
									className="sticky left-0 shrink-0 select-none bg-(--omp-code-bg) pr-3 pl-3 text-right text-(--omp-dim) opacity-70"
								>
									{Array.from({ length: previewLines }, (_, index) => (
										<div
											key={index}
											data-marked={index + 1 === markedLine || undefined}
											className={index + 1 === markedLine ? "font-semibold text-(--omp-accent)" : undefined}
										>
											{index + 1}
										</div>
									))}
								</div>
								<pre ref={setPreviewContent} className="m-0 pr-4 whitespace-pre text-(--omp-text) [tab-size:4]">
									{activePreview.content}
									{activePreview.truncated && (
										<span className="text-(--omp-dim)">
											{"\n"}
											{t("filesPanel.truncated", { kb: PREVIEW_MAX_BYTES / 1000 })}
										</span>
									)}
								</pre>
							</div>
						)}
					</div>
				)}
			</div>
		) : filePreviewImage ? (
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<PanelToolbar className="gap-1 border-b border-(--omp-border-muted)">
					<ToolbarIconButton label={t("filesPanel.back")} onClick={closeFilePreview}>
						<X size={14} />
					</ToolbarIconButton>
					<span className="min-w-0 flex-1 truncate text-omp-sm font-medium">{filePreviewImage.label}</span>
				</PanelToolbar>
				<div className="min-h-0 flex-1 overflow-auto" data-file-preview="">
					<ZoomableImage
						src={filePreviewImage.src}
						alt={filePreviewImage.label}
						className="omp-image-checker mx-auto block h-auto max-w-full object-contain p-3"
					/>
				</div>
			</div>
		) : null;

	const resizeTree = (share: number) => setTreeShare(Math.round(Math.min(74, Math.max(17, share))));

	return (
		<div
			className="grid h-full min-h-0"
			ref={panelRef}
			style={{
				gridTemplateColumns: hasPreview
					? `minmax(0, ${100 - treeShare}fr) 5px minmax(7rem, ${treeShare}fr)`
					: "minmax(0, 1fr)",
			}}
		>
			{hasPreview && (
				<section className="flex min-h-0 min-w-0 flex-col">
					<FileTabStrip
						tabs={workspace.tabs}
						activeId={activeTab?.id}
						onActivate={tab => openFilePreview(tab.path)}
						onClose={requestTabClose}
					/>
					{previewBody}
					<ConfirmDialog
						open={closingTab !== null}
						title={t("filesPanel.discard")}
						message={t("filesPanel.discardHint")}
						confirmLabel={t("filesPanel.discard")}
						onConfirm={() => closingTab && removeTab(closingTab)}
						onCancel={() => setClosingTab(null)}
					/>
				</section>
			)}
			{hasPreview && (
				<div
					aria-label={t("filesPanel.resize")}
					aria-orientation="vertical"
					aria-valuemin={17}
					aria-valuemax={74}
					aria-valuenow={treeShare}
					className="z-10 cursor-col-resize touch-none border-x border-(--omp-border-muted) hover:bg-(--omp-accent) focus-visible:bg-(--omp-accent)"
					role="separator"
					tabIndex={0}
					onKeyDown={event => {
						if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
						event.preventDefault();
						resizeTree(treeShare + (event.key === "ArrowLeft" ? 5 : -5));
					}}
					onPointerDown={event => {
						resizing.current = true;
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={event => {
						const bounds = panelRef.current?.getBoundingClientRect();
						if (resizing.current && bounds?.width)
							resizeTree(((bounds.right - event.clientX) / bounds.width) * 100);
					}}
					onLostPointerCapture={() => {
						resizing.current = false;
					}}
				/>
			)}
			<section className="flex min-h-0 min-w-0 flex-col">
				<PanelToolbar className="gap-1 px-2">
					<span className="min-w-0 flex-1 truncate text-omp-sm font-medium">{t("filesPanel.title")}</span>
					<ToolbarIconButton
						label={t(showIgnored ? "filesPanel.hideIgnored" : "filesPanel.showIgnored")}
						pressed={showIgnored}
						onClick={() => setShowIgnored(!showIgnored)}
					>
						{showIgnored ? <EyeOff size={14} /> : <Eye size={14} />}
					</ToolbarIconButton>
					<ToolbarIconButton label={t("filesPanel.refresh")} disabled={!directory} onClick={refresh}>
						<RefreshCw size={14} />
					</ToolbarIconButton>
				</PanelToolbar>
				<div className="shrink-0 px-2 pb-1.5">
					<PanelSearch label={t("filesPanel.search")} value={query} onChange={setQuery} />
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
					{!directory ? (
						<div className="flex items-center justify-center gap-2 py-10">
							<Spinner size="sm" />
							<span className="text-omp-sm text-(--omp-dim)">
								{t(term ? "common.loading" : "filesPanel.scanning")}
							</span>
						</div>
					) : !directory.ok ? (
						<PanelEmpty
							icon={FolderX}
							tone="error"
							title={t("filesPanel.unavailable")}
							hint={directory.error}
							action={
								<Button onClick={refresh} size="sm" variant="secondary">
									{t("filesPanel.retry")}
								</Button>
							}
						/>
					) : term && nodes.length === 0 ? (
						<p className="px-3 py-6 text-center text-omp-sm text-(--omp-dim)">{t("filesPanel.noMatch")}</p>
					) : (
						<TreeView
							emptyMessage={t("filesPanel.empty")}
							expanded={expanded}
							nodes={nodes}
							onExpandedChange={setExpanded}
							selectedId={treePath ? `file:${treePath}` : undefined}
						/>
					)}
				</div>
			</section>
		</div>
	);
}
