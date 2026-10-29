/**
 * Advisor status beside the composer's model chip — the TUI status line's
 * advisor eye. Color follows the worst advisor status; the eye closes once
 * every advisor has finished reviewing the yielded turn. Clicking opens the
 * WATCHDOG.yml editor in the terminal panel.
 */

import { Eye, EyeOff } from "lucide-react";
import type { RpcAdvisorStatus } from "../../../shared/rpc-types";
import { cx, formatCost } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";

type AdvisorEntryStatus = RpcAdvisorStatus["advisors"][number]["status"];

/** The badge color for a roster: any error, then quota exhaustion, then a running advisor. */
export function advisorBadgeColor(statuses: AdvisorEntryStatus[]): string {
	if (statuses.includes("error")) return "var(--omp-error)";
	if (statuses.includes("quota_exhausted")) return "var(--omp-warning)";
	if (statuses.includes("running")) return "var(--omp-success)";
	return "var(--omp-dim)";
}

export function AdvisorBadge() {
	const t = useT();
	const tabRpc = useTabRpc();
	const advisor = useSessionStore(s => s.advisorStatus);
	if (!advisor?.configured || advisor.advisors.length === 0) return null;
	const statuses = advisor.advisors.map(entry => entry.status);
	const allYielded = advisor.advisors.every(entry => entry.yielded);
	const title = [
		t(allYielded ? "advisor.badge.yielded" : "advisor.badge.reviewing"),
		...advisor.advisors.map(entry => `${entry.name}: ${t(`advisor.status.${entry.status}`)}`),
		advisor.cost > 0
			? `${t("advisor.badge.cost")}: ${formatCost(advisor.cost, 4)}${advisor.usingSubscription ? ` (${t("advisor.badge.subscription")})` : ""}`
			: null,
		t("advisor.badge.configure"),
	]
		.filter((line): line is string => line !== null)
		.join("\n");
	const Icon = allYielded ? EyeOff : Eye;
	const openEditor = () => {
		void tabRpc
			.command({ type: "tui_open", surface: "advisor_config" })
			.then(response => {
				if (!response.success) toast({ variant: "error", message: response.error });
			})
			.catch(error => toast({ variant: "error", message: String(error) }));
	};

	return (
		<button
			type="button"
			onClick={openEditor}
			title={title}
			aria-label={title}
			className={cx(
				"omp-pressable flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-omp-sm hover:bg-[var(--omp-selected-bg)]",
			)}
			style={{ color: advisorBadgeColor(statuses) }}
		>
			<Icon aria-hidden="true" size={14} />
			{advisor.cost > 0 && (
				<span className="tabular-nums text-[var(--omp-muted)]">{formatCost(advisor.cost, 2)}</span>
			)}
		</button>
	);
}
