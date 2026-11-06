/**
 * Configuration warnings the sidecar collected — the GUI counterpart of the
 * TUI header's "Warning: …" rows. A broken models.yml, an extension that failed
 * to load, an invalid WATCHDOG.yml, or a missing default model otherwise fail
 * silently here. Proxies Main kept from the agent join them, since nothing else
 * would say why requests stopped using them. Dismissal hides the current set
 * only; a changed set shows again.
 */

import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";

export function ConfigWarningsBanner() {
	const t = useT();
	const configWarnings = useSessionStore(s => s.configWarnings);
	const proxyWarnings = useSessionStore(s => s.proxyWarnings);
	const dismissed = useSessionStore(s => s.configWarningsDismissed);
	const [expanded, setExpanded] = useState(false);
	const warnings = [
		...proxyWarnings.map(dropped =>
			t(
				`proxy.dropped.${dropped.source}`,
				dropped.source === "environment" ? { names: dropped.names.join(", ") } : undefined,
			),
		),
		...configWarnings,
	];
	const key = warnings.join("\n");
	if (warnings.length === 0 || dismissed === key) return null;
	const multiple = warnings.length > 1;

	return (
		<div
			role="status"
			className="flex items-start gap-3 border-b border-[var(--omp-warning)]/30 bg-[var(--omp-warning-dim)] px-4 py-2.5"
		>
			<AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--omp-warning)]" />
			<div className="min-w-0 flex-1">
				<div className="text-omp-md font-medium text-[var(--omp-warning)]">
					{multiple ? t("configWarnings.titleMany", { count: warnings.length }) : t("configWarnings.title")}
				</div>
				{expanded ? (
					<ul className="mt-1 space-y-1">
						{warnings.map(warning => (
							<li key={warning} className="whitespace-pre-wrap break-words text-omp-sm text-[var(--omp-muted)]">
								{warning}
							</li>
						))}
					</ul>
				) : (
					<div className="truncate text-omp-sm text-[var(--omp-muted)]" title={warnings[0]}>
						{warnings[0]}
					</div>
				)}
			</div>
			{(multiple || (warnings[0]?.length ?? 0) > 80) && (
				<button
					type="button"
					onClick={() => setExpanded(open => !open)}
					className="omp-pressable flex shrink-0 items-center gap-1 rounded-md border border-[var(--omp-border-muted)] px-2.5 py-1 text-omp-sm font-medium text-[var(--omp-text)] hover:bg-[var(--omp-selected-bg)]"
				>
					{expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
					{expanded ? t("configWarnings.showLess") : t("configWarnings.showAll")}
				</button>
			)}
			<button
				type="button"
				onClick={() => useSessionStore.setState({ configWarningsDismissed: key })}
				aria-label={t("common.close")}
				className="omp-pressable flex shrink-0 items-center justify-center rounded-md p-1 text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
			>
				<X size={14} />
			</button>
		</div>
	);
}
