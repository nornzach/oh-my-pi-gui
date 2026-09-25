/**
 * Workspace-directories dialog (TUI /dirs /add-dir /remove-dir /move parity):
 * lists the session's roots with the primary (cwd) badge, adds roots via the
 * native directory picker, removes non-primary roots behind an inline
 * confirm, and moves the session file's cwd association to a picked directory
 * (move_session → toast + session rehydrate). Mutations are blocked while
 * streaming — the server also refuses with the "busy" code.
 */
import { FolderGit2, FolderPlus, PackageOpen, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RpcWorkspaceDirectoriesResult } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import {
	addWorkspaceDirectory,
	moveSessionTo,
	pickWorkspaceDirectory,
	type RpcWorkspaceDirectory,
	removeWorkspaceDirectory,
} from "../../lib/workspace-dirs";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";
import { AsyncSection, Badge, Button, Modal } from "../common";

export function WorkspaceDirsDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const open = useUiStore(state => state.workspaceDirsOpen);
	const close = useUiStore(state => state.closeWorkspaceDirs);
	const busy = useSessionStore(state => state.isStreaming || state.isCompacting);
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const [directories, setDirectories] = useState<RpcWorkspaceDirectory[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mutating, setMutating] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		if (!sidecarReady) {
			setError(t("sidecar.notResponding"));
			setLoading(false);
			return;
		}
		try {
			const response = await tabRpc.getDirectories();
			if (response.success) {
				setDirectories((response.data as RpcWorkspaceDirectoriesResult | undefined)?.directories ?? []);
			} else {
				setError(response.error);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [sidecarReady, t, tabRpc.getDirectories]);

	useEffect(() => {
		if (!open) return;
		setConfirmRemove(null);
		void reload();
	}, [open, reload]);

	const onAdd = async (): Promise<void> => {
		if (!sidecarReady) return;
		const path = await pickWorkspaceDirectory();
		if (!path) return;
		setMutating(true);
		try {
			const result = await addWorkspaceDirectory(path);
			if (result) setDirectories(result);
		} finally {
			setMutating(false);
		}
	};

	const onRemove = async (path: string): Promise<void> => {
		if (!sidecarReady) return;
		setMutating(true);
		setConfirmRemove(null);
		try {
			const result = await removeWorkspaceDirectory(path);
			if (result) setDirectories(result);
		} finally {
			setMutating(false);
		}
	};

	const onMove = async (): Promise<void> => {
		if (!sidecarReady) return;
		const path = await pickWorkspaceDirectory();
		if (!path) return;
		setMutating(true);
		try {
			const moved = await moveSessionTo(path);
			// move_session returns only the new cwd — refetch for the post-move list.
			if (moved) await reload();
		} finally {
			setMutating(false);
		}
	};

	return (
		<Modal onClose={close} open={open} size="md" title={t("workspaceDirs.title")}>
			<div className="flex flex-col gap-3">
				<div className="text-xs text-(--omp-dim)">{t("workspaceDirs.subtitle")}</div>
				<div className="max-h-[38vh] min-h-16 overflow-y-auto rounded-md border border-(--omp-border-muted)">
					<AsyncSection
						className="min-h-24"
						empty={directories.length === 0}
						emptyLabel={t("workspaceDirs.empty")}
						error={error}
						hasData={directories.length > 0}
						loading={loading}
						loadingLabel={t("workspaceDirs.loading")}
						onRetry={() => void reload()}
					>
						{directories.map(directory => (
							<div
								className="flex items-center gap-2 border-b border-(--omp-border-muted) px-3 py-2 last:border-b-0"
								key={directory.path}
							>
								<FolderGit2 className="shrink-0 text-(--omp-dim)" size={14} />
								<span
									className="min-w-0 flex-1 truncate font-mono text-xs text-(--omp-text)"
									title={directory.path}
								>
									{directory.path}
								</span>
								{directory.primary ? (
									<Badge variant="info">{t("workspaceDirs.primary")}</Badge>
								) : confirmRemove === directory.path ? (
									<span className="flex shrink-0 items-center gap-1">
										<Button
											disabled={mutating || !sidecarReady}
											onClick={() => void onRemove(directory.path)}
											size="sm"
											variant="danger"
										>
											{t("common.confirm")}
										</Button>
										<Button
											disabled={mutating}
											onClick={() => setConfirmRemove(null)}
											size="sm"
											variant="ghost"
										>
											{t("common.cancel")}
										</Button>
									</span>
								) : (
									<Button
										disabled={mutating || busy || !sidecarReady}
										icon={<Trash2 size={13} />}
										onClick={() => setConfirmRemove(directory.path)}
										size="sm"
										title={
											!sidecarReady
												? t("sidecar.notResponding")
												: busy
													? t("workspaceDirs.busy")
													: t("workspaceDirs.remove")
										}
										variant="ghost"
									/>
								)}
							</div>
						))}
					</AsyncSection>
				</div>
				<div className="flex items-center justify-between gap-2">
					<Button
						disabled={mutating || busy || loading || !sidecarReady}
						icon={<FolderPlus size={14} />}
						onClick={() => void onAdd()}
						size="sm"
						title={!sidecarReady ? t("sidecar.notResponding") : busy ? t("workspaceDirs.busy") : undefined}
					>
						{t("workspaceDirs.add")}
					</Button>
				</div>
				<div className="rounded-md border border-(--omp-border-muted) p-3">
					<div className="mb-1 text-xs font-medium text-(--omp-text)">{t("workspaceDirs.moveTitle")}</div>
					<div className="mb-2 text-xs text-(--omp-dim)">{t("workspaceDirs.moveDesc")}</div>
					<Button
						disabled={mutating || busy || loading || !sidecarReady}
						icon={<PackageOpen size={14} />}
						onClick={() => void onMove()}
						size="sm"
						title={!sidecarReady ? t("sidecar.notResponding") : busy ? t("workspaceDirs.busy") : undefined}
					>
						{t("workspaceDirs.move")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
