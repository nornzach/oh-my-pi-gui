/**
 * Files panel: workspace file tree sourced via the dedicated `fs:list` /
 * `fs:read` main-process IPC (node:fs — cross-platform, works with no live
 * agent session), in-drawer preview, and @mention insertion via the
 * "omp:insert-mention" window event.
 */

import { ArrowLeft, AtSign, ExternalLink as ExternalLinkIcon, File, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FsTreeEntry } from "../../../shared/ipc-types";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { useUiStore } from "../../stores/ui";
import { Button, Spinner } from "../common";
import { type TreeNode, TreeView } from "../common/TreeView";
import { PathLink } from "../tools/PathLink";

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

export function FilesPanel() {
	const t = useT();
	const tabId = useRuntimeTabId();
	const filePreviewPath = useUiStore(s => s.filePreviewPath);
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
				icon: isDir ? expanded.has(id) ? <FolderOpen size={12} /> : <Folder size={12} /> : <File size={12} />,
				onClick: () => onNodeClick(id),
				children: entry.children && entry.children.length > 0 ? entry.children.map(toNode) : undefined,
			};
		};
		return query.trim()
			? searchFiles(tree, query).map(entry => ({ ...toNode(entry), label: entry.path }))
			: tree.map(toNode);
	}, [tree, query, expanded, onNodeClick]);

	const fileCount = useMemo(() => countFiles(tree), [tree]);
	const activePreview = preview?.path === filePreviewPath ? preview : null;
	const previewIsMarkdown = filePreviewPath ? /\.mdx?$/i.test(filePreviewPath) : false;

	if (filePreviewPath) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-(--omp-border-muted) px-3 py-2">
					<button
						type="button"
						onClick={closeFilePreview}
						aria-label={t("filesPanel.back")}
						className="omp-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
					>
						<ArrowLeft size={14} />
					</button>
					<File className="shrink-0 text-(--omp-dim)" size={12} />
					<span className="min-w-0 flex-1 truncate font-mono text-omp-xs" title={filePreviewPath}>
						{filePreviewPath}
					</span>
					<PathLink
						path={filePreviewPath}
						className="inline-flex shrink-0 items-center gap-1 px-1.5 py-1 text-omp-xs text-(--omp-muted)"
					>
						<ExternalLinkIcon size={12} />
						<span>{t("filesPanel.openExternal")}</span>
					</PathLink>
					<button
						type="button"
						onClick={() => {
							insertMention(filePreviewPath);
							closeFilePreview();
						}}
						className="omp-pressable inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-omp-xs text-(--omp-muted) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
					>
						<AtSign size={12} />
						<span>{t("filesPanel.insertMention")}</span>
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-auto bg-(--omp-code-bg)">
					{!activePreview || activePreview.loading ? (
						<div className="flex items-center gap-2 p-4">
							<Spinner size="sm" />
							<span className="text-omp-sm text-(--omp-dim)">{t("filesPanel.reading")}</span>
						</div>
					) : previewIsMarkdown ? (
						<div className="p-4 text-omp-md text-(--omp-text)">
							<MarkdownRenderer content={activePreview.content ?? ""} />
							{activePreview.truncated && (
								<div className="mt-3 text-omp-xs text-(--omp-dim)">
									{t("filesPanel.truncated", { kb: PREVIEW_MAX_BYTES / 1000 })}
								</div>
							)}
						</div>
					) : (
						<pre className="p-3 font-mono text-omp-sm leading-[1.5] break-words whitespace-pre-wrap text-(--omp-text)">
							{activePreview.content}
							{activePreview.truncated && (
								<span className="text-(--omp-dim)">
									{"\n"}
									{t("filesPanel.truncated", { kb: PREVIEW_MAX_BYTES / 1000 })}
								</span>
							)}
						</pre>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
				<span className="text-omp-xs font-medium tracking-widest text-(--omp-dim) uppercase">
					{t("filesPanel.title")}
				</span>
				<div className="flex items-center gap-1.5">
					<span className="text-omp-xs tabular-nums text-(--omp-dim)">
						{fileCount}
						{truncated ? "+" : ""}
					</span>
					<button
						aria-label={t("filesPanel.refresh")}
						className="rounded p-0.5 text-(--omp-dim) transition-colors hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
						disabled={loading}
						onClick={() => void load()}
						type="button"
					>
						<RefreshCw className={loading ? "animate-spin" : undefined} size={11} />
					</button>
				</div>
			</div>
			<div className="px-3 pb-2">
				<input
					aria-label={t("filesPanel.search")}
					placeholder={t("filesPanel.search")}
					className="w-full rounded border border-(--omp-input-border) bg-(--omp-input-bg) px-2 py-1.5 text-omp-sm"
					value={query}
					onChange={event => setQuery(event.target.value)}
				/>
				{truncated && (
					<p className="mt-1 text-omp-xs text-(--omp-muted)">
						{t("filesPanel.searchLimit", { files: MAX_FILES, depth: MAX_DEPTH })}
					</p>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
				{loading && tree.length === 0 ? (
					<div className="flex items-center justify-center gap-2 py-8">
						<Spinner size="sm" />
						<span className="text-omp-sm text-(--omp-dim)">{t("filesPanel.scanning")}</span>
					</div>
				) : error !== null ? (
					<div className="px-4 py-8 text-center text-omp-sm leading-relaxed text-(--omp-dim)">
						{t("filesPanel.unavailable")}
						<br />
						<span className="break-words">{error}</span>
						<div className="mt-2">
							<Button onClick={() => void load()} size="sm" variant="ghost">
								{t("filesPanel.retry")}
							</Button>
						</div>
					</div>
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
