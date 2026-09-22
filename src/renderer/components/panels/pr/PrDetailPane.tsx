/**
 * PR detail pane (plan/21): header card (title/badges/branches/actions),
 * collapsible markdown body, checks list, and the files index with per-file
 * lazy DiffView expansion. Diff text loads on first expand via pr_diff —
 * the wire stays small and closed files cost nothing.
 */

import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Circle,
	ExternalLink,
	GitBranch,
	GitPullRequestClosed,
	GitPullRequestDraft,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { DiffView } from "../../../lib/diff";
import { useT } from "../../../lib/i18n";
import { MarkdownRenderer } from "../../../lib/markdown";
import { usePrCenterStore } from "../../../stores/pr-center";
import { Button, Spinner } from "../../common";

const BODY_COLLAPSE_LINES = 12;

function checkIcon(conclusion: string | null, status: string) {
	if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED") {
		return <CheckCircle2 size={12} className="shrink-0 text-(--omp-success)" />;
	}
	if (conclusion) return <XCircle size={12} className="shrink-0 text-(--omp-error)" />;
	if (status === "IN_PROGRESS" || status === "QUEUED")
		return <Circle size={9} className="shrink-0 fill-current text-(--omp-warning)" />;
	return <Circle size={12} className="shrink-0 text-(--omp-dim)" />;
}

function FileRow({ path, additions, deletions }: { path: string; additions: number; deletions: number }) {
	const t = useT();
	const expanded = usePrCenterStore(state => state.expandedFiles[path]);
	return (
		<div className="rounded-md border border-(--omp-border-muted)">
			<button
				type="button"
				onClick={() => void usePrCenterStore.getState().toggleFile(path)}
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-(--omp-selected-bg)"
			>
				{expanded ? (
					<ChevronDown size={11} className="shrink-0" />
				) : (
					<ChevronRight size={11} className="shrink-0" />
				)}
				<span className="min-w-0 flex-1 truncate font-mono text-omp-sm text-(--omp-text)">{path}</span>
				<span className="shrink-0 text-omp-xs text-(--omp-success)">+{additions}</span>
				<span className="shrink-0 text-omp-xs text-(--omp-error)">-{deletions}</span>
			</button>
			{expanded?.phase === "loading" && (
				<div className="flex items-center gap-2 border-t border-(--omp-border-muted) px-3 py-2 text-omp-sm text-(--omp-dim)">
					<Spinner size="sm" /> {t("prCenter.diffLoading")}
				</div>
			)}
			{expanded?.phase === "error" && (
				<div className="border-t border-(--omp-border-muted) px-3 py-2 text-omp-sm text-(--omp-error)">
					{t("prCenter.diffFailed")}
				</div>
			)}
			{expanded?.phase === "ready" && (
				<div className="overflow-x-auto border-t border-(--omp-border-muted) bg-(--omp-code-bg) py-1">
					<DiffView diff={expanded.diff} filePath={path} />
				</div>
			)}
		</div>
	);
}

export function PrDetailPane({ onCreateOpen }: { onCreateOpen: () => void }) {
	const t = useT();
	const detail = usePrCenterStore(state => state.detail);
	const detailLoading = usePrCenterStore(state => state.detailLoading);
	const selected = usePrCenterStore(state => state.selected);
	const [bodyExpanded, setBodyExpanded] = useState(false);

	if (selected === null) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
				<GitPullRequestDraft size={28} className="text-(--omp-dim)" />
				<p className="text-omp-md text-(--omp-dim)">{t("prCenter.noSelection")}</p>
				<Button variant="secondary" size="sm" onClick={onCreateOpen}>
					{t("prCenter.create")}
				</Button>
			</div>
		);
	}
	if (detailLoading || !detail) {
		return (
			<div className="flex h-full items-center justify-center gap-2 text-omp-md text-(--omp-dim)">
				<Spinner size="sm" /> {t("prCenter.loading")}
			</div>
		);
	}

	const bodyLines = detail.body.split("\n");
	const collapsible = bodyLines.length > BODY_COLLAPSE_LINES;
	const shownBody = bodyExpanded || !collapsible ? detail.body : bodyLines.slice(0, BODY_COLLAPSE_LINES).join("\n");

	return (
		// Keyed on the selection so switching PRs replays the entrance instead of
		// mutating the previous PR's body in place, and resets the local body
		// expansion that belongs to the PR being left behind.
		<div key={selected} className="omp-fade-up flex flex-col gap-4 p-4">
			{/* Header card */}
			<div className="flex flex-col gap-2 rounded-lg border border-(--omp-border-muted) bg-transparent p-3">
				<div className="flex items-start gap-2">
					{detail.isDraft ? (
						<GitPullRequestDraft size={14} className="mt-0.5 shrink-0 text-(--omp-muted)" />
					) : (
						<GitPullRequestClosed size={14} className="mt-0.5 shrink-0 text-(--omp-success)" />
					)}
					<h2 className="min-w-0 flex-1 text-omp-lg font-medium leading-snug text-(--omp-text)">
						<span className="text-(--omp-dim)">#{detail.number}</span> {detail.title}
					</h2>
					{detail.isDraft && (
						<span className="shrink-0 rounded border border-(--omp-border-muted) px-1.5 py-0.5 text-omp-xs text-(--omp-muted)">
							{t("prCenter.draft")}
						</span>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-omp-sm text-(--omp-dim)">
					<span className="text-(--omp-muted)">@{detail.authorLogin}</span>
					<span>·</span>
					<GitBranch size={10} className="shrink-0" />
					<span className="font-mono">{detail.headRefName}</span>
					<span>→</span>
					<span className="font-mono">{detail.baseRefName}</span>
					<span>·</span>
					<span className="text-(--omp-success)">+{detail.additions}</span>
					<span className="text-(--omp-error)">-{detail.deletions}</span>
					{detail.reviewDecision && (
						<>
							<span>·</span>
							<span>{detail.reviewDecision.toLowerCase().replace(/_/g, " ")}</span>
						</>
					)}
				</div>
				<div className="mt-1 flex items-center gap-2">
					<Button variant="secondary" size="sm" onClick={() => void window.omp.system.openExternal(detail.url)}>
						<ExternalLink size={11} /> {t("prCenter.openInBrowser")}
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => void usePrCenterStore.getState().checkout(detail.number)}
					>
						<GitBranch size={11} /> {t("prCenter.checkout")}
					</Button>
				</div>
			</div>

			{/* Body */}
			{detail.body.trim().length > 0 && (
				<section>
					<h3 className="mb-1.5 text-omp-sm font-medium uppercase tracking-wide text-(--omp-dim)">
						{t("prCenter.section.body")}
					</h3>
					<div className="rounded-lg border border-(--omp-border-muted) p-3 text-omp-md">
						<MarkdownRenderer content={shownBody} />
						{collapsible && (
							<button
								type="button"
								onClick={() => setBodyExpanded(expanded => !expanded)}
								className="mt-1.5 text-omp-sm text-(--omp-accent) hover:underline"
							>
								{bodyExpanded
									? t("prCenter.collapse")
									: t("prCenter.expand", { count: String(bodyLines.length - BODY_COLLAPSE_LINES) })}
							</button>
						)}
					</div>
				</section>
			)}

			{/* Checks */}
			{detail.checks.length > 0 && (
				<section>
					<h3 className="mb-1.5 text-omp-sm font-medium uppercase tracking-wide text-(--omp-dim)">
						{t("prCenter.section.checks", { count: String(detail.checks.length) })}
					</h3>
					<div className="flex flex-col gap-0.5 rounded-lg border border-(--omp-border-muted) p-2">
						{detail.checks.map(check => (
							<div key={check.name} className="flex items-center gap-2 px-1 py-0.5 text-omp-sm">
								{checkIcon(check.conclusion, check.status)}
								<span className="min-w-0 truncate text-(--omp-text)">{check.name}</span>
								<span className="ml-auto shrink-0 text-omp-xs text-(--omp-dim)">
									{check.conclusion ?? check.status}
								</span>
							</div>
						))}
					</div>
				</section>
			)}

			{/* Files */}
			<section>
				<h3 className="mb-1.5 text-omp-sm font-medium uppercase tracking-wide text-(--omp-dim)">
					{t("prCenter.section.files", { count: String(detail.files.length) })}
				</h3>
				<div className="flex flex-col gap-1.5">
					{detail.files.map(file => (
						<FileRow key={file.path} path={file.path} additions={file.additions} deletions={file.deletions} />
					))}
				</div>
			</section>
		</div>
	);
}
