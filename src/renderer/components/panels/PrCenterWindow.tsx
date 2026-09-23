/**
 * PR Center (plan/21): fullscreen in-renderer panel for GitHub pull requests —
 * rich list (CI badges, initial avatars, diff stats), markdown detail,
 * per-file lazy diffs (DiffView), AI-drafted create flow, and one-click
 * checkout into a bound worktree tab (plan/20 tie-in). Data rides the active
 * tab's sidecar via the pr_* RPCs; the store re-probes on open.
 */

import { GitPullRequest, GitPullRequestDraft, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { RpcPrListItem } from "../../../shared/rpc-types";
import { cx, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { usePrCenterStore } from "../../stores/pr-center";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner, Tabs } from "../common";
import { PrCreateDialog } from "./pr/PrCreateDialog";
import { PrDetailPane } from "./pr/PrDetailPane";

/** Deterministic avatar hue from the login (Linear-style initial badges). */
function avatarHue(login: string): number {
	let hash = 0;
	for (let index = 0; index < login.length; index++) hash = (hash * 31 + login.charCodeAt(index)) | 0;
	return Math.abs(hash) % 360;
}

function checksBadge(item: RpcPrListItem): { glyph: string; className: string } {
	const { success, failure, pending } = item.checks;
	if (failure > 0) return { glyph: "✗", className: "text-(--omp-error)" };
	if (pending > 0) return { glyph: "●", className: "text-(--omp-warning)" };
	if (success > 0) return { glyph: "✓", className: "text-(--omp-success)" };
	return { glyph: "○", className: "text-(--omp-dim)" };
}

function PrListRow({ item, active, onSelect }: { item: RpcPrListItem; active: boolean; onSelect: () => void }) {
	const badge = checksBadge(item);
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cx(
				"flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
				active ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-selected-bg)",
			)}
		>
			<span className="flex items-center gap-1.5">
				<span className={cx("w-3 shrink-0 text-center text-omp-sm", badge.className)}>{badge.glyph}</span>
				<span className="shrink-0 text-omp-sm text-(--omp-dim)">#{item.number}</span>
				{item.isDraft && <GitPullRequestDraft size={11} className="shrink-0 text-(--omp-muted)" />}
				<span className="min-w-0 flex-1 truncate text-omp-md text-(--omp-text)">{item.title}</span>
			</span>
			<span className="flex items-center gap-1.5 pl-[18px] text-omp-xs text-(--omp-dim)">
				<span
					className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-omp-xxs font-semibold text-white"
					style={{ backgroundColor: `hsl(${avatarHue(item.authorLogin)} 45% 42%)` }}
				>
					{item.authorLogin[0]?.toUpperCase() ?? "?"}
				</span>
				<span className="min-w-0 truncate">{item.headRefName}</span>
				<span className="shrink-0 text-(--omp-success)">+{item.additions}</span>
				<span className="shrink-0 text-(--omp-error)">-{item.deletions}</span>
				<span className="shrink-0">{formatTimeAgo(item.updatedAt)}</span>
			</span>
		</button>
	);
}

export function PrCenterWindow() {
	const t = useT();
	const open = useUiStore(state => state.prCenterOpen);
	const close = useUiStore(state => state.closePrCenter);
	const repo = usePrCenterStore(state => state.repo);
	const list = usePrCenterStore(state => state.list);
	const listState = usePrCenterStore(state => state.listState);
	const listLoading = usePrCenterStore(state => state.listLoading);
	const selected = usePrCenterStore(state => state.selected);
	const error = usePrCenterStore(state => state.error);
	const [createOpen, setCreateOpen] = useState(false);

	useEffect(() => {
		if (open) void usePrCenterStore.getState().probe();
	}, [open]);

	const stateTabs = (["open", "closed", "merged", "all"] as const).map(state => ({
		id: state,
		label: t(`prCenter.state.${state}`),
	}));

	return (
		<Modal open={open} onClose={close} title={t("prCenter.title")} size="full" bodyClassName="p-0">
			<div className="flex h-[80vh] min-h-0 flex-col">
				{/* Header */}
				<div className="flex shrink-0 items-center gap-3 border-b border-(--omp-border-muted) px-4 py-2.5">
					<GitPullRequest size={14} className="shrink-0 text-(--omp-accent)" />
					<span className="text-omp-lg font-medium text-(--omp-text)">{t("prCenter.title")}</span>
					{repo?.available && <span className="truncate text-omp-md text-(--omp-dim)">{repo.repo}</span>}
					<div className="ml-auto flex items-center gap-2">
						<Tabs
							tabs={stateTabs}
							activeId={listState}
							onChange={id => usePrCenterStore.getState().setListState(id as typeof listState)}
						/>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								void (repo?.available
									? usePrCenterStore.getState().refresh()
									: usePrCenterStore.getState().probe())
							}
							disabled={listLoading}
							title={t("prCenter.refresh")}
						>
							<RefreshCw size={12} className={listLoading ? "animate-spin" : undefined} />
						</Button>
						<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)} disabled={!repo?.available}>
							<Plus size={12} /> {t("prCenter.create")}
						</Button>
					</div>
				</div>

				{/* Body */}
				{!repo && error ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
						<p role="alert" className="max-w-sm text-omp-md text-(--omp-error)">
							{error}
						</p>
						<Button
							icon={<RefreshCw size={12} />}
							onClick={() => void usePrCenterStore.getState().probe()}
							size="sm"
							variant="secondary"
						>
							{t("common.retry")}
						</Button>
					</div>
				) : !repo ? (
					<div className="flex flex-1 items-center justify-center gap-2 text-omp-md text-(--omp-dim)">
						<Spinner size="sm" /> {t("prCenter.probing")}
					</div>
				) : !repo.available ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
						<GitPullRequest size={28} className="text-(--omp-dim)" />
						<p className="text-omp-lg text-(--omp-muted)">{t(`prCenter.unavailable.${repo.reason}`)}</p>
						{repo.reason === "gh_missing" && (
							<p className="font-mono text-omp-sm text-(--omp-dim)">brew install gh && gh auth login</p>
						)}
					</div>
				) : (
					<div className="flex min-h-0 flex-1">
						{/* List pane */}
						<div className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-(--omp-border-muted) p-2">
							{error && (
								<p className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-2 py-1.5 text-omp-sm text-(--omp-error)">
									{error}
								</p>
							)}
							{error && list.length === 0 ? (
								/* The banner above names the failure; this keeps the pane
								   from reading as "no pull requests" while nothing loaded. */
								<div className="flex flex-1 items-center justify-center">
									<Button
										icon={<RefreshCw size={12} />}
										onClick={() => void usePrCenterStore.getState().refresh()}
										size="sm"
										variant="secondary"
									>
										{t("common.retry")}
									</Button>
								</div>
							) : error ? null : listLoading && list.length === 0 ? (
								<div className="flex flex-1 items-center justify-center gap-2 text-omp-md text-(--omp-dim)">
									<Spinner size="sm" /> {t("prCenter.loading")}
								</div>
							) : list.length === 0 ? (
								<div className="flex flex-1 items-center justify-center text-omp-md text-(--omp-dim)">
									{t("prCenter.empty")}
								</div>
							) : (
								list.map(item => (
									<PrListRow
										key={item.number}
										item={item}
										active={item.number === selected}
										onSelect={() => void usePrCenterStore.getState().select(item.number)}
									/>
								))
							)}
						</div>
						{/* Detail pane */}
						<div className="min-w-0 flex-1 overflow-y-auto">
							<PrDetailPane onCreateOpen={() => setCreateOpen(true)} />
						</div>
					</div>
				)}
			</div>
			<PrCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
		</Modal>
	);
}
