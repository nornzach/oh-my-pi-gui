/**
 * One async section, one truthful state.
 *
 * Every list/detail pane that reads from the sidecar has the same four states,
 * and the interesting rule is their precedence: a failed request is not an
 * empty collection, and a reload is not an initial load. Getting that backwards
 * is what made a dead sidecar look like "no model roles configured" and a
 * failed provider read look like "you are not signed in".
 *
 * When the section already has rows, the caller passes `hasData` and renders
 * them as children: the error then degrades to a banner over stale data instead
 * of replacing it.
 */

import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

export interface AsyncSectionProps {
	loading: boolean;
	/** Rows from the last successful load are still on screen. */
	hasData?: boolean;
	error: string | null;
	/** Whether the loaded collection is empty; never consulted while `error` is set. */
	empty?: boolean;
	onRetry?: () => void;
	loadingLabel?: string;
	/** Heading above the error message. */
	errorTitle?: string;
	/** Banner label when stale rows stay visible under the error. */
	staleLabel?: string;
	emptyLabel?: string;
	retryLabel?: string;
	/** Box for the full-panel states; compact rows pass their own padding. */
	className?: string;
	children: ReactNode;
}

const PLAIN_STATE_CLASS = "flex flex-col items-center justify-center gap-2 px-4 py-6 text-center";

export function AsyncSection({
	loading,
	hasData = false,
	error,
	empty = false,
	onRetry,
	loadingLabel,
	errorTitle,
	staleLabel,
	emptyLabel,
	retryLabel,
	className,
	children,
}: AsyncSectionProps) {
	const t = useT();
	const box = className ?? "h-64";
	const retry = retryLabel ?? t("common.retry");
	const retryButton = onRetry && (
		<Button icon={<RefreshCw size={12} />} onClick={onRetry} size="sm" variant="secondary">
			{retry}
		</Button>
	);

	if (loading && !hasData) {
		return (
			<div className={cx(PLAIN_STATE_CLASS, "gap-2.5", box)}>
				<Spinner size="md" />
				{loadingLabel && <span className="text-xs text-(--omp-dim)">{loadingLabel}</span>}
			</div>
		);
	}
	if (error && !hasData) {
		return (
			<div className={cx(PLAIN_STATE_CLASS, "gap-3", box)}>
				<AlertTriangle className="text-(--omp-warning)" size={20} />
				<div className="max-w-sm text-xs leading-relaxed text-(--omp-muted)">
					{errorTitle && (
						<>
							<span className="font-semibold text-(--omp-text)">{errorTitle}</span>
							<br />
						</>
					)}
					{error}
				</div>
				{retryButton}
			</div>
		);
	}
	if (empty && !error) {
		return (
			<div className={cx(PLAIN_STATE_CLASS, box)}>
				<Inbox className="text-(--omp-dim)" size={20} />
				{emptyLabel && <span className="text-xs text-(--omp-dim)">{emptyLabel}</span>}
			</div>
		);
	}
	return (
		<>
			{error && (
				<div
					role="alert"
					className="m-3 flex items-center gap-3 rounded border border-(--omp-border-muted) p-3 text-omp-sm text-[var(--omp-warning)]"
				>
					<span className="flex-1">{staleLabel ? `${staleLabel}: ${error}` : error}</span>
					{retryButton}
				</div>
			)}
			{children}
		</>
	);
}
