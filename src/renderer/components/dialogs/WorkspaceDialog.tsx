/**
 * Workspace manager (Codex-style): lists every known workspace (the cwds of
 * all sessions + the current project) with the current one highlighted, lets
 * the user jump to any of them (`setProject` → sidecar restarts there) or add
 * a new directory (native picker). Far richer than the bare breadcrumb picker.
 */

import { Check, Folder, FolderPlus } from "lucide-react";
import { useMemo } from "react";
import { useSessionList } from "../../hooks/use-session-list";
import { basename, cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isSubagentSession } from "../../lib/session-tree";
import { pickWorkspaceDirectory } from "../../lib/workspace-dirs";
import { useSessionStore } from "../../stores/session";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import { useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { Modal } from "../common";

interface WorkspaceRow {
	cwd: string;
	name: string;
	lastModified: number;
	sessionCount: number;
}

export function WorkspaceDialog({
	open,
	onClose,
	intent = "switch",
}: {
	open: boolean;
	onClose: () => void;
	/** "switch" = jump between workspaces (breadcrumb); "new-session" = the "+"
	 * button — picking a workspace starts a NEW session there. */
	intent?: "switch" | "new-session";
}) {
	const t = useT();
	const { sessions } = useSessionList("global");
	const cwd = useSessionStore(s => s.cwd);
	const workspaceLastUsed = useSidebarPrefs(s => s.workspaceLastUsed);
	const openTab = useTabsStore(s => s.openTab);

	const workspaces = useMemo<WorkspaceRow[]>(() => {
		const byCwd = new Map<string, WorkspaceRow>();
		for (const session of sessions) {
			// A subagent may run in a worktree of its own; it is not a project you opened.
			if (isSubagentSession(session)) continue;
			const modified = Date.parse(session.modified) || 0;
			const existing = byCwd.get(session.cwd);
			if (existing) {
				existing.sessionCount += 1;
				if (modified > existing.lastModified) existing.lastModified = modified;
			} else {
				byCwd.set(session.cwd, {
					cwd: session.cwd,
					name: basename(session.cwd) || session.cwd,
					lastModified: modified,
					sessionCount: 1,
				});
			}
		}
		// Ensure the current project appears even when it has no sessions yet.
		if (cwd && !byCwd.has(cwd)) {
			byCwd.set(cwd, { cwd, name: basename(cwd) || cwd, lastModified: 0, sessionCount: 0 });
		}
		for (const workspace of byCwd.values()) {
			workspace.lastModified = Math.max(workspace.lastModified, workspaceLastUsed[workspace.cwd] ?? 0);
		}
		return [...byCwd.values()].sort((a, b) => b.lastModified - a.lastModified);
	}, [sessions, cwd, workspaceLastUsed]);

	/** In-place workspace switches abort the active sidecar run. New-session
	 * intent opens an independent agent tab and does not need this guard. */
	const guardBusy = (): boolean => {
		const { isStreaming, isCompacting } = useSessionStore.getState();
		if (!isStreaming && !isCompacting) return false;
		toast({ variant: "warning", message: t("sessionSwitch.busyBlocked") });
		return true;
	};

	const newSessionHere = async (target: string) => {
		const tabId = await openTab({ cwd: target, kind: "agent" });
		if (tabId) onClose();
	};

	const pick = async (target: string) => {
		if (intent === "new-session") {
			await newSessionHere(target);
			return;
		}
		// The breadcrumb already points at this workspace.
		if (target === cwd) {
			onClose();
			return;
		}
		if (guardBusy()) return;
		// Breadcrumb switching deliberately re-roots the current tab.
		try {
			const ok = await window.omp.sidecar.setProject(target);
			if (!ok) {
				toast({ variant: "error", title: t("workspaces.switchFailed"), message: target });
				return;
			}
			onClose();
		} catch (error) {
			toast({ variant: "error", title: t("workspaces.switchFailed"), message: String(error) });
		}
	};

	const addWorkspace = async () => {
		if (intent === "switch" && guardBusy()) return;
		try {
			if (intent === "new-session") {
				const picked = await pickWorkspaceDirectory();
				if (picked) await newSessionHere(picked);
				return;
			}
			if (await window.omp.sidecar.selectProject()) onClose();
		} catch (error) {
			toast({ variant: "error", title: t("titlebar.openProjectFailed"), message: String(error) });
		}
	};

	return (
		<Modal
			open={open}
			title={intent === "new-session" ? t("workspaces.newSessionTitle") : t("workspaces.title")}
			onClose={onClose}
			size="md"
		>
			<div className="flex flex-col gap-2">
				<button
					type="button"
					onClick={() => void addWorkspace()}
					className="omp-pressable flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--omp-border)] px-3 py-2.5 text-omp-lg font-medium text-[var(--omp-accent)] transition-colors hover:border-[var(--omp-accent)] hover:bg-[var(--omp-selected-bg)]"
				>
					<FolderPlus size={16} />
					{t("workspaces.add")}
				</button>

				<div className="max-h-[46vh] overflow-y-auto">
					{workspaces.length === 0 ? (
						<div className="px-2 py-8 text-center text-omp-md text-[var(--omp-muted)]">
							{t("workspaces.empty")}
						</div>
					) : (
						workspaces.map(ws => {
							const isCurrent = ws.cwd === cwd;
							return (
								<button
									key={ws.cwd}
									type="button"
									onClick={() => void pick(ws.cwd)}
									className={cx(
										"omp-pressable group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
										isCurrent ? "bg-[var(--omp-selected-bg)]" : "hover:bg-[var(--omp-selected-bg)]",
									)}
								>
									<Folder
										size={16}
										className={cx(
											"shrink-0",
											isCurrent ? "text-[var(--omp-accent)]" : "text-[var(--omp-dim)]",
										)}
									/>
									<span className="min-w-0 flex-1">
										<span className="flex items-baseline gap-2">
											<span
												className={cx(
													"truncate text-omp-lg font-medium",
													isCurrent ? "text-[var(--omp-text)]" : "text-[var(--omp-muted)]",
												)}
											>
												{ws.name}
											</span>
											{ws.sessionCount > 0 && (
												<span className="shrink-0 text-omp-sm text-[var(--omp-dim)]">
													{t("workspaces.sessionCount", { count: ws.sessionCount })}
												</span>
											)}
										</span>
										<span className="block truncate text-omp-sm text-[var(--omp-dim)]">{ws.cwd}</span>
									</span>
									{isCurrent ? (
										<span className="flex shrink-0 items-center gap-1 text-omp-sm font-medium text-[var(--omp-accent)]">
											<Check size={13} />
											{t("workspaces.current")}
										</span>
									) : null}
								</button>
							);
						})
					)}
				</div>
			</div>
		</Modal>
	);
}
