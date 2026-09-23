import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RpcGitChanges, RpcGitDiff } from "../../../shared/rpc-types";
import { DiffView } from "../../lib/diff";
import { useT } from "../../lib/i18n";
import type { TabRpc } from "../../lib/tab-rpc";
import { useTabRpc } from "../../lib/tab-rpc";

export function RepositoryChanges() {
	const t = useT();
	const rpc = useTabRpc();
	const [refresh, setRefresh] = useState(0);
	const [changes, setChanges] = useState<RpcGitChanges | null>(null);
	const [selected, setSelected] = useState("");
	const [preview, setPreview] = useState<RpcGitDiff | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const loadedFor = useRef<TabRpc | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly reloads the checkout.
	useEffect(() => {
		let active = true;
		setLoading(true);
		// A reload is not an initial load: only switching to another session's
		// client wipes the rows, so a failed refresh keeps the last good diff up.
		if (loadedFor.current !== rpc) {
			setChanges(null);
			setSelected("");
		}
		setError(null);
		void Promise.resolve()
			.then(() => rpc.getGitChanges())
			.then(response => {
				if (!active) return;
				if (!response.success) throw new Error(response.error ?? t("rpc.failed"));
				loadedFor.current = rpc;
				setChanges(response.data as RpcGitChanges);
			})
			.catch(cause => {
				if (active) setError(String(cause));
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [rpc, refresh, t]);
	useEffect(() => {
		let active = true;
		setPreview(null);
		if (!selected) return;
		setError(null);
		void Promise.resolve()
			.then(() => rpc.getGitDiff(selected))
			.then(response => {
				if (!active) return;
				if (!response.success) throw new Error(response.error ?? t("rpc.failed"));
				setPreview(response.data as RpcGitDiff);
			})
			.catch(cause => {
				if (active) setError(String(cause));
			});
		return () => {
			active = false;
		};
	}, [rpc, selected, t]);
	const files = changes?.files.filter(file => file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
			<div className="flex items-start gap-2 text-omp-xs text-(--omp-muted)">
				<p className="flex-1">{t("diffPanel.repositoryScope")}</p>
				<button
					type="button"
					className="flex size-7 items-center justify-center rounded hover:bg-(--omp-hover-bg) disabled:opacity-50"
					title={t("common.refresh")}
					aria-label={t("common.refresh")}
					disabled={loading}
					onClick={() => setRefresh(value => value + 1)}
				>
					<RefreshCw size={14} />
				</button>
			</div>
			{error && (
				<p role="alert" className="break-words text-omp-sm text-(--omp-error)">
					{error}
				</p>
			)}
			{loading && !changes ? (
				<p>{t("common.loading")}</p>
			) : changes && !changes.isRepo ? (
				<p>{t("diffPanel.notRepo")}</p>
			) : changes?.files.length === 0 ? (
				<p>{t("diffPanel.clean")}</p>
			) : (
				changes && (
					<>
						<input
							aria-label={t("diffPanel.search")}
							placeholder={t("diffPanel.search")}
							className="w-full rounded border border-(--omp-input-border) bg-(--omp-input-bg) px-2 py-1.5 text-omp-sm"
							value={query}
							onChange={event => setQuery(event.target.value)}
						/>
						{changes.truncated && <p role="status">{t("diffPanel.listLimited")}</p>}
						<div className="max-h-48 shrink-0 overflow-y-auto">
							{files.map(file => (
								<button
									type="button"
									key={file.path}
									aria-pressed={selected === file.path}
									className={`flex w-full gap-2 rounded px-2 py-1.5 text-left text-omp-sm ${selected === file.path ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-hover-bg)"}`}
									onClick={() => setSelected(file.path)}
								>
									<code className="shrink-0 text-(--omp-muted)">{file.status}</code>
									<span className="break-all">
										{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
									</span>
								</button>
							))}
							{files.length === 0 && <p>{t("diffPanel.noMatch")}</p>}
						</div>
						{selected && !preview && !error && <p>{t("common.loading")}</p>}
						{preview && (
							<div className="min-w-0">
								<p className="mb-2 break-all font-mono text-omp-sm">{preview.path}</p>
								{preview.kind === "text" ? (
									<DiffView diff={preview.diff} filePath={preview.path} />
								) : (
									<p>{t(`diffPanel.kind.${preview.kind}`)}</p>
								)}
								{preview.truncated && (
									<p className="text-omp-xs text-(--omp-warning)">{t("diffPanel.previewLimited")}</p>
								)}
							</div>
						)}
					</>
				)
			)}
		</div>
	);
}
