/**
 * Update banner for both staged automatic updates and verified manual macOS
 * installers. Manual mode keeps the DMG replacement steps visible after the
 * installer opens in Finder.
 */
import { AlertTriangle, Download, FolderOpen, RefreshCw, X } from "lucide-react";
import { useT } from "../../lib/i18n";
import { useUpdaterStore } from "../../stores/updater";
import { Button } from "../common";

function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
	return `${bytes} B`;
}

export function UpdateBanner() {
	const t = useT();
	const status = useUpdaterStore(s => s.status);
	const dismissed = useUpdaterStore(s => s.dismissed);
	const dismiss = useUpdaterStore(s => s.dismiss);
	const dismissError = useUpdaterStore(s => s.dismissError);

	if (status.state === "available") {
		if (dismissed.version === status.version) return null;
		return (
			<div className="flex items-center gap-2 border-b border-(--omp-border-muted) bg-transparent px-3 py-1.5 text-omp-md">
				<Download size={13} className="shrink-0 text-(--omp-accent)" />
				<span className="min-w-0 flex-1 truncate text-(--omp-text)">
					{t("updater.available", { version: status.version })}
				</span>
				<Button size="sm" onClick={() => void window.omp.updater.download()}>
					{status.mode === "manual" ? t("updater.downloadInstaller") : t("updater.download")}
				</Button>
				<button
					type="button"
					aria-label={t("updater.dismiss")}
					className="shrink-0 text-(--omp-dim) hover:text-(--omp-text)"
					onClick={() => dismiss(status.version)}
				>
					<X size={13} />
				</button>
			</div>
		);
	}

	if (status.state === "downloading") {
		return (
			<div className="flex items-center gap-2 border-b border-(--omp-border-muted) bg-transparent px-3 py-1.5 text-omp-md">
				<Download size={13} className="shrink-0 text-(--omp-accent)" />
				<div className="min-w-0 flex-1">
					<div className="mb-1 flex justify-between text-(--omp-text)">
						<span>{status.mode === "manual" ? t("updater.downloadingInstaller") : t("updater.downloading")}</span>
						<span className="tabular-nums text-(--omp-dim)">
							{status.percent}% · {formatBytes(status.transferred)}/{formatBytes(status.total)}
						</span>
					</div>
					<div
						className="h-1 overflow-hidden rounded-full bg-(--omp-bg-primary)" // surface-ok: progress bar track
					>
						<div
							className="omp-progress-width h-full bg-(--omp-accent)"
							style={{ width: `${status.percent}%` }}
						/>
					</div>
				</div>
			</div>
		);
	}

	if (status.state === "downloaded") {
		if (status.mode === "manual") {
			return (
				<div className="flex items-center gap-2 border-b border-(--omp-border-muted) bg-transparent px-3 py-2 text-omp-md">
					<FolderOpen size={13} className="shrink-0 text-(--omp-success)" />
					<div className="min-w-0 flex-1">
						<div className="text-(--omp-text)">{t("updater.installerReady", { version: status.version })}</div>
						<div className="mt-0.5 text-omp-xs text-(--omp-dim)">{t("updater.manualInstructions")}</div>
					</div>
					<Button size="sm" onClick={() => void window.omp.updater.apply()}>
						{t("updater.openInstaller")}
					</Button>
				</div>
			);
		}
		return (
			<div className="flex items-center gap-2 border-b border-(--omp-border-muted) bg-transparent px-3 py-1.5 text-omp-md">
				<RefreshCw size={13} className="shrink-0 text-(--omp-success)" />
				<span className="min-w-0 flex-1 truncate text-(--omp-text)">
					{t("updater.ready", { version: status.version })}
				</span>
				<Button size="sm" onClick={() => void window.omp.updater.apply()}>
					{t("updater.restart")}
				</Button>
			</div>
		);
	}

	if (status.state === "error" && status.showInBanner !== false) {
		// A dismissed failure stays hidden until a check actually succeeds again, so
		// the four-hourly poll can't resurrect a banner the user already closed.
		if (dismissed.error) return null;
		return (
			<div className="flex items-center gap-2 border-b border-(--omp-border-muted) bg-transparent px-3 py-1.5 text-omp-md">
				<AlertTriangle size={13} className="shrink-0 text-(--omp-error)" />
				<span className="min-w-0 flex-1 text-(--omp-error)">{status.message}</span>
				<Button size="sm" onClick={() => void window.omp.updater.check()}>
					{t("updater.retry")}
				</Button>
				<button
					type="button"
					aria-label={t("updater.dismissFailure")}
					className="shrink-0 text-(--omp-dim) hover:text-(--omp-text)"
					onClick={dismissError}
				>
					<X size={13} />
				</button>
			</div>
		);
	}

	return null;
}
