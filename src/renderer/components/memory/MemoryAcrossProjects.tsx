import { ChevronRight, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RpcMemoryOverview } from "../../../shared/rpc-types";
import { describeError } from "../../lib/errors";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { useTabRpc } from "../../lib/tab-rpc";
import { Button, Spinner } from "../common";
import type { MemoryProjectOption } from "./memory-model";

function ProjectPreview({
	project,
	showSources,
	onOpen,
}: {
	project: MemoryProjectOption;
	showSources: boolean;
	onOpen: (cwd: string) => void;
}) {
	const t = useT();
	const rpc = useTabRpc();
	const card = useRef<HTMLElement>(null);
	const [seen, setSeen] = useState(false);
	const [overview, setOverview] = useState<RpcMemoryOverview | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const node = card.current;
		if (!node || seen) return;
		if (typeof IntersectionObserver === "undefined") {
			setSeen(true);
			return;
		}
		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) {
				observer.disconnect();
				setSeen(true);
			}
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, [seen]);

	useEffect(() => {
		if (!seen) return;
		let cancelled = false;
		setError(null);
		void rpc
			.getMemoryOverview(project.cwd)
			.then(response => {
				if (!response.success) throw new Error(response.error);
				if (!cancelled) setOverview(response.data as RpcMemoryOverview);
			})
			.catch(cause => {
				if (!cancelled) setError(describeError(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [project.cwd, rpc, seen]);

	const sources = overview?.sources.filter(source => source.state !== "old") ?? [];
	const summary = overview?.summary.trim() || overview?.notes[0]?.text || overview?.lessons[0]?.text;
	return (
		<article className="omp-card min-w-0 p-3" ref={card}>
			<h3>
				<button
					className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-omp-md font-medium hover:text-(--omp-accent)"
					onClick={() => onOpen(project.cwd)}
					title={project.cwd}
					type="button"
				>
					<FolderOpen aria-hidden size={15} className="shrink-0 text-(--omp-muted)" />
					<span className="min-w-0 flex-1 truncate">{project.label}</span>
					<ChevronRight aria-hidden size={14} className="shrink-0 text-(--omp-muted)" />
				</button>
			</h3>
			{error ? (
				<p className="line-clamp-2 pt-1 text-omp-xs text-(--omp-warning)" title={error}>
					{error}
				</p>
			) : overview ? (
				showSources ? (
					<>
						<p className="pt-1 text-omp-xs text-(--omp-muted)">
							{t("memory.project.sourceCount", { count: sources.length })}
						</p>
						{sources.length > 0 && (
							<ul className="mt-1 space-y-0.5 text-omp-sm">
								{sources.slice(0, 3).map(source => (
									<li className="truncate" key={source.threadId}>
										{source.title?.trim() || t("search.untitled")}
									</li>
								))}
							</ul>
						)}
					</>
				) : summary ? (
					<div className="mt-1 max-h-24 overflow-hidden text-omp-sm text-(--omp-muted)">
						<MarkdownRenderer content={summary.slice(0, 750)} />
					</div>
				) : (
					<p className="pt-1 text-omp-xs text-(--omp-muted)">{t("memory.status.empty")}</p>
				)
			) : (
				<span className="flex min-h-6 items-center text-(--omp-muted)">{seen && <Spinner size="sm" />}</span>
			)}
		</article>
	);
}

export function MemoryAcrossProjects({
	error,
	loading,
	onOpen,
	onRetry,
	projects,
	showSources,
}: {
	error: string | null;
	loading: boolean;
	onOpen: (cwd: string) => void;
	onRetry: () => void;
	projects: readonly MemoryProjectOption[];
	showSources: boolean;
}) {
	const t = useT();
	return (
		<div className="mx-auto max-w-5xl space-y-3 px-5 py-4">
			<p className="text-omp-sm text-(--omp-muted)">{t("memory.project.allHint")}</p>
			{error && (
				<div role="alert" className="flex flex-wrap items-center gap-2 text-omp-sm text-(--omp-warning)">
					<span>{error}</span>
					<Button onClick={onRetry} size="sm">
						{t("common.retry")}
					</Button>
				</div>
			)}
			{loading && projects.length === 0 ? <Spinner size="sm" /> : null}
			{!loading && !error && projects.length === 0 ? (
				<p className="text-omp-sm text-(--omp-muted)">{t("memory.project.allEmpty")}</p>
			) : null}
			<div className="grid gap-2 sm:grid-cols-2">
				{projects.map(project => (
					<ProjectPreview key={project.cwd} onOpen={onOpen} project={project} showSources={showSources} />
				))}
			</div>
		</div>
	);
}
