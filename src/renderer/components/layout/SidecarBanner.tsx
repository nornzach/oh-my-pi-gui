/**
 * Global sidecar status banner. Shows when the agent process is not usable:
 * failed, exited, crash-looping through its restart attempts, or "ready" but
 * failing health checks. Restart attempts are amber progress reporting; the
 * rest is an error with a restart action.
 */

import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";

export function SidecarBanner() {
	const t = useT();
	const status = useSessionStore(s => s.status);
	const cwd = useSessionStore(s => s.cwd);
	const sidecarError = useUiStore(s => s.sidecarError);
	const sidecarRestart = useUiStore(s => s.sidecarRestart);
	const sidecarDismissed = useUiStore(s => s.sidecarDismissed);
	const clearSidecarError = useUiStore(s => s.clearSidecarError);
	const dismissSidecarBanner = useUiStore(s => s.dismissSidecarBanner);

	const restarting = status === "restarting";
	// Show banner when the sidecar is down, respawning itself, or a health check
	// failed on a nominally "ready" process.
	const show = restarting || status === "error" || status === "exited" || sidecarError !== null;
	if (!show || sidecarDismissed) return null;

	const progress =
		sidecarRestart === null
			? null
			: restarting
				? t("sidecar.attempt", { attempt: sidecarRestart.attempt, maxAttempts: sidecarRestart.maxAttempts })
				: status === "error"
					? t("sidecar.exhausted", { maxAttempts: sidecarRestart.maxAttempts })
					: null;
	const reason =
		sidecarError ??
		(status === "error"
			? t("sidecar.failedStart")
			: status === "exited"
				? t("sidecar.exited")
				: restarting
					? t("sidecar.restartingTitle")
					: t("sidecar.notResponding"));

	return (
		<div
			role="status"
			className={`flex items-center gap-3 border-b px-4 py-2.5 ${
				restarting
					? "border-[var(--omp-warning)]/30 bg-[var(--omp-warning-dim)]"
					: "border-[var(--omp-error)]/30 bg-[var(--omp-error)]/10"
			}`}
		>
			{restarting ? (
				<RefreshCw size={16} className="shrink-0 animate-spin text-[var(--omp-warning)]" />
			) : (
				<AlertTriangle size={16} className="shrink-0 text-[var(--omp-error)]" />
			)}
			<div className="min-w-0 flex-1">
				<div
					className={`text-omp-md font-medium ${
						restarting ? "text-[var(--omp-warning)]" : "text-[var(--omp-error)]"
					}`}
				>
					{restarting ? t("sidecar.restartingTitle") : t("sidecar.title")}
				</div>
				<div className="truncate text-omp-sm text-[var(--omp-muted)]" title={reason}>
					{progress ? `${progress} — ${reason}` : reason}
				</div>
				{cwd && <div className="text-omp-xs text-[var(--omp-dim)]">{t("sidecar.project", { cwd })}</div>}
			</div>
			<button
				type="button"
				onClick={() => {
					clearSidecarError();
					void window.omp.sidecar.restart();
				}}
				className="omp-pressable flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--omp-border-muted)] px-2.5 py-1 text-omp-sm font-medium text-[var(--omp-text)] hover:bg-[var(--omp-selected-bg)]"
			>
				<RefreshCw size={11} />
				{t("sidecar.restart")}
			</button>
			<button
				type="button"
				onClick={dismissSidecarBanner}
				aria-label={t("common.close")}
				className="omp-pressable flex shrink-0 items-center justify-center rounded-md p-1 text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
			>
				<X size={12} />
			</button>
		</div>
	);
}
