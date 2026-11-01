/**
 * Files panel: workspace file tree sourced via the dedicated `fs:list` /
 * `fs:read` main-process IPC (node:fs — cross-platform, works with no live
 * agent session), in-drawer preview, and @mention insertion via the
 * "omp:insert-mention" window event.
 */

import {
	ArrowLeft,
	AtSign,
	Check,
	Copy,
	ExternalLink as ExternalLinkIcon,
	File,
	Folder,
	FolderOpen,
	FolderX,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FsTreeEntry } from "../../../shared/ipc-types";
import { copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isSelectAll } from "../../lib/keymap";
import { MarkdownRenderer } from "../../lib/markdown";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { useUiStore } from "../../stores/ui";
import { Button, Spinner } from "../common";
import { showPathMenu } from "../common/LinkMenu";
import { type TreeNode, TreeView } from "../common/TreeView";
import { PathLink } from "../tools/PathLink";
import { FileLabel, PanelEmpty, PanelSearch, PanelToolbar, ToolbarIconButton } from "./workspace-ui";

const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const PREVIEW_MAX_BYTES = 200_000;

interface PreviewState {
	path: string;
	content: string | null;
	loading: boolean;
	truncated: boolean;
}

function countFiles(entries: FsTreeEntry[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.kind === "file") count += 1;
		else if (entry.children) count += countFiles(entry.children);
	}
	return count;
}

/** Search the bounded tree already loaded from the workspace; preserve full paths. */
export function searchFiles(entries: FsTreeEntry[], query: string): FsTreeEntry[] {
	const needle = query.trim().toLocaleLowerCase();
	return entries.flatMap(entry =>
		entry.kind === "file"
			? entry.path.toLocaleLowerCase().includes(needle)
				? [entry]
				: []
			: searchFiles(entry.children ?? [], query),
	);
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

export function FilesPanel() {
	const t = useT();
	const tabId = useRuntimeTabId();
	const filePreviewPath = useUiStore(s => s.filePreviewPath);
	const filePreviewLine = useUiStore(s => s.filePreviewLine);
	const openFilePreview = useUiStore(s => s.openFilePreview);
	const closeFilePreview = useUiStore(s => s.closeFilePreview);
	const listVersion = useRef(0);
	const previewVersion = useRef(0);
	const [query, setQuery] = useState("");
	const [tree, setTree] = useState<FsTreeEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [truncated, setTruncated] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [preview, setPreview] = useState<PreviewState | null>(null);

	const load = useCallback(async () => {
		const version = ++listVersion.current;
		setLoading(true);
		setError(null);
		try {
			const result = tabId
				? await window.omp.fs.list(undefined, MAX_DEPTH, MAX_FILES, tabId)
				: await window.omp.fs.list(undefined, MAX_DEPTH, MAX_FILES);
			if (version !== listVersion.current) return;
			if (!result.ok) {
				setError(result.error ?? t("filesPanel.unavailable"));
				setTree([]);
				setTruncated(false);
				return;
			}
			setTree(result.entries);
			setTruncated(result.truncated);
		} catch (err) {
			if (version !== listVersion.current) return;
			setError(err instanceof Error ? err.message : String(err));
			setTree([]);
			setTruncated(false);
		} finally {
			if (version === listVersion.current) setLoading(false);
		}
	}, [t, tabId]);

	useEffect(() => {
		setTree([]);
		setExpanded(new Set());
		void load();
		return () => {
			listVersion.current++;
		};
	}, [load]);

	const openPreview = useCallback(
		async (path: string) => {
			const version = ++previewVersion.current;
			setPreview({ path, content: null, loading: true, truncated: false });
			try {
				const result = tabId
					? await window.omp.fs.read(path, PREVIEW_MAX_BYTES, tabId)
					: await window.omp.fs.read(path, PREVIEW_MAX_BYTES);
				if (version !== previewVersion.current) return;
				if (!result.ok) {
					setPreview({
						path,
						content: t("filesPanel.readFailed", { error: result.error ?? "unknown" }),
						loading: false,
						truncated: false,
					});
					return;
				}
				if (result.binary) {
					setPreview({ path, content: t("filesPanel.binary"), loading: false, truncated: false });
					return;
				}
				setPreview({ path, content: result.content, loading: false, truncated: result.truncated });
			} catch (error) {
				if (version !== previewVersion.current) return;
				setPreview({
					path,
					content: t("filesPanel.readFailed", { error: error instanceof Error ? error.message : String(error) }),
					loading: false,
					truncated: false,
				});
			}
		},
		[t, tabId],
	);

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
				setExpanded(prev => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			}
		},
		[openFilePreview],
	);

	const nodes = useMemo<TreeNode[]>(() => {
		const toNode = (entry: FsTreeEntry): TreeNode => {
			const id = `${entry.kind}:${entry.path}`;
			const isDir = entry.kind === "dir";
			return {
				id,
				label: entry.name,
				icon: isDir ? expanded.has(id) ? <FolderOpen size={14} /> : <Folder size={14} /> : <File size={14} />,
				onClick: () => onNodeClick(id),
				onContextMenu: event => showPathMenu(event, entry.path, tabId),
				children: entry.children && entry.children.length > 0 ? entry.children.map(toNode) : undefined,
			};
		};
		return query.trim()
			? searchFiles(tree, query).map(entry => ({ ...toNode(entry), label: <FileLabel path={entry.path} /> }))
			: tree.map(toNode);
	}, [tree, query, expanded, onNodeClick, tabId]);

	const fileCount = useMemo(() => countFiles(tree), [tree]);
	const activePreview = preview?.path === filePreviewPath ? preview : null;
	// Markdown renders, except when a link named a line: rendered prose has no
	// line numbers, so the source shows with that line marked (as GitHub does).
	const previewIsMarkdown = filePreviewPath ? /\.mdx?$/i.test(filePreviewPath) && filePreviewLine === null : false;
	const previewLines = useMemo(() => {
		const content = activePreview?.content;
		if (!content || previewIsMarkdown) return 0;
		// A trailing newline ends the last line; it does not start another.
		return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
	}, [activePreview?.content, previewIsMarkdown]);
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

	if (filePreviewPath) {
		return (
			<div className="flex h-full flex-col">
				<PanelToolbar className="gap-1 border-b border-(--omp-border-muted) pl-1.5">
					<ToolbarIconButton label={t("filesPanel.back")} onClick={closeFilePreview}>
						<ArrowLeft size={15} />
					</ToolbarIconButton>
					<span className="min-w-0 flex-1 px-1 text-omp-sm font-medium">
						<FileLabel path={filePreviewPath} />
					</span>
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
							closeFilePreview();
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
				{/* Focusable so a click puts ⌘A here: it selects the file, not the whole window. */}
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
					{!activePreview || activePreview.loading ? (
						<div className="flex items-center gap-2 p-4">
							<Spinner size="sm" />
							<span className="text-omp-sm text-(--omp-dim)">{t("filesPanel.reading")}</span>
						</div>
					) : previewIsMarkdown ? (
						<div ref={setPreviewContent} className="mx-auto max-w-3xl px-5 py-4 text-omp-md text-(--omp-text)">
							<MarkdownRenderer content={activePreview.content ?? ""} />
							{activePreview.truncated && (
								<div className="mt-3 text-omp-xs text-(--omp-dim)">
									{t("filesPanel.truncated", { kb: PREVIEW_MAX_BYTES / 1000 })}
								</div>
							)}
						</div>
					) : (
						<div className="relative flex min-w-max py-2 font-mono text-xs leading-[1.6]">
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
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<span className="sr-only">{t("filesPanel.title")}</span>
			<PanelToolbar>
				<PanelSearch
					label={t("filesPanel.search")}
					placeholder={
						fileCount > 0
							? t("filesPanel.searchPlaceholder", { count: `${fileCount}${truncated ? "+" : ""}` })
							: t("filesPanel.search")
					}
					value={query}
					onChange={setQuery}
				/>
				<ToolbarIconButton label={t("filesPanel.refresh")} disabled={loading} onClick={() => void load()}>
					<RefreshCw className={loading ? "animate-spin" : undefined} size={14} />
				</ToolbarIconButton>
			</PanelToolbar>
			{truncated && (
				<p className="px-3 pb-1.5 text-omp-xs text-(--omp-dim)">
					{t("filesPanel.searchLimit", { files: MAX_FILES, depth: MAX_DEPTH })}
				</p>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
				{loading && tree.length === 0 ? (
					<div className="flex items-center justify-center gap-2 py-10">
						<Spinner size="sm" />
						<span className="text-omp-sm text-(--omp-dim)">{t("filesPanel.scanning")}</span>
					</div>
				) : error !== null ? (
					<PanelEmpty
						icon={FolderX}
						tone="error"
						title={t("filesPanel.unavailable")}
						hint={error}
						action={
							<Button onClick={() => void load()} size="sm" variant="secondary">
								{t("filesPanel.retry")}
							</Button>
						}
					/>
				) : query.trim() && nodes.length === 0 ? (
					<p className="px-3 py-6 text-center text-omp-sm text-(--omp-dim)">{t("filesPanel.noMatch")}</p>
				) : (
					<TreeView
						emptyMessage={t("filesPanel.empty")}
						expanded={expanded}
						nodes={nodes}
						onExpandedChange={setExpanded}
					/>
				)}
			</div>
		</div>
	);
}
