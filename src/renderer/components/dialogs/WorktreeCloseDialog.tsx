/**
 * Worktree-tab close prompt (plan/20): runs when a worktree-bound tab is
 * closed, BEFORE closeTab. Queries the tab's OWN sidecar via commandForTab
 * (background tabs stay untouched — no forced switch), then:
 * - clean → [删除并关闭] / [保留并关闭] / [取消]
 * - dirty → counts + [强制删除（丢弃改动）] / [保留并关闭] / [取消]
 * The remove RPC also rides the tab's sidecar; the tab closes right after,
 * so the sidecar's cwd-inside-removed-dir never matters.
 */

import { useEffect, useState } from "react";
import type { RpcGitStatus } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner } from "../common";

type QueryState = { phase: "loading" } | { phase: "ready"; status: RpcGitStatus | null } | { phase: "error" };

export function WorktreeCloseDialog() {
	const t = useT();
	const prompt = useUiStore(state => state.worktreeClosePrompt);
	const closePrompt = useUiStore(state => state.closeWorktreeClosePrompt);
	const tab = useTabsStore(state => state.tabs.find(entry => entry.id === prompt?.tabId));
	const closeTab = useTabsStore(state => state.closeTab);

	const [query, setQuery] = useState<QueryState>({ phase: "loading" });
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!prompt) return;
		setQuery({ phase: "loading" });
		setBusy(false);
		if (tab?.status !== "ready") {
			setQuery({ phase: "error" });
			return;
		}
		let cancelled = false;
		window.omp.rpc
			.commandForTab(prompt.tabId, { type: "get_git_status" })
			.then(response => {
				if (cancelled) return;
				setQuery(response.success ? { phase: "ready", status: response.data as RpcGitStatus } : { phase: "error" });
			})
			.catch(() => {
				if (!cancelled) setQuery({ phase: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [prompt, tab]);

	if (!prompt || !tab?.worktree) return null;
	const worktree = tab.worktree;
	const sidecarReady = tab.status === "ready";
	const status = query.phase === "ready" ? query.status : null;
	const dirty = status !== null && (status.staged > 0 || status.unstaged > 0 || status.untracked > 0);

	const finish = () => {
		closePrompt();
		void closeTab(prompt.tabId);
	};

	const removeAndClose = async (force: boolean) => {
		if (!sidecarReady || busy) return;
		setBusy(true);
		try {
			const response = await window.omp.rpc.commandForTab(
				prompt.tabId,
				{ type: "worktree_remove", path: tab.cwd, force },
				60_000,
			);
			if (!response.success) {
				toast({ variant: "error", title: t("worktreeClose.removeFailed"), message: response.error });
				return;
			}
			finish();
		} catch (error) {
			toast({ variant: "error", title: t("worktreeClose.removeFailed"), message: String(error) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal open onClose={closePrompt} title={t("worktreeClose.title", { name: worktree.name })} size="sm">
			{query.phase === "loading" ? (
				<div className="flex items-center justify-center gap-2 py-6 text-xs text-(--omp-dim)">
					<Spinner size="sm" />
					<span>{t("worktreeClose.checking")}</span>
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{query.phase === "error" ? (
						<p className="text-omp-lg leading-relaxed text-(--omp-muted)">
							{sidecarReady ? t("worktreeClose.statusUnknown") : t("worktreeClose.notConnected")}
						</p>
					) : dirty && status ? (
						<p className="text-omp-lg leading-relaxed text-(--omp-warning)">
							{t("worktreeClose.dirtyBody", {
								staged: String(status.staged),
								unstaged: String(status.unstaged),
								untracked: String(status.untracked),
							})}
						</p>
					) : (
						<p className="text-omp-lg leading-relaxed text-(--omp-muted)">{t("worktreeClose.cleanBody")}</p>
					)}
					<p className="truncate font-mono text-omp-sm text-(--omp-dim)" title={tab.cwd}>
						{worktree.branch} — {tab.cwd}
					</p>
					<div className="flex flex-col gap-2">
						{query.phase === "ready" && (
							<Button
								variant={dirty ? "danger" : "primary"}
								loading={busy}
								onClick={() => void removeAndClose(dirty)}
							>
								{dirty ? t("worktreeClose.forceDelete") : t("worktreeClose.delete")}
							</Button>
						)}
						<Button variant="ghost" onClick={finish} disabled={busy}>
							{t("worktreeClose.keep")}
						</Button>
						<Button variant="ghost" onClick={closePrompt} disabled={busy}>
							{t("common.cancel")}
						</Button>
					</div>
				</div>
			)}
		</Modal>
	);
}
