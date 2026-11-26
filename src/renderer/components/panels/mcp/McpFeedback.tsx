/**
 * Shared MCP feedback blocks: copy-to-clipboard button, copyable error box,
 * and the connection-test result view (success tool list / failure error).
 * Used by the add-server wizard pre-check and the server-card inline test.
 *
 * `summarizeMcpTestData` maps the raw mcp_test wire payload
 * ({ ok, toolNames?, toolCount?, error? }) onto a render-ready view model:
 * the first MCP_TEST_SHOWN_LIMIT tool names plus a "+N more" remainder that
 * also respects a toolCount larger than the returned name list.
 */

import { X } from "lucide-react";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { Spinner } from "../../common";
import { CopyButton } from "../../common/CopyButton";

/** Tool names rendered before the "+N more" remainder kicks in. */
export const MCP_TEST_SHOWN_LIMIT = 10;

/** Render-ready mapping of an mcp_test result payload. */
export type McpTestView =
	| { kind: "ok"; toolCount: number; shown: string[]; extra: number }
	| { kind: "error"; error: string };

/** Map a raw mcp_test `data` payload onto the inline result view model. */
export function summarizeMcpTestData(data: unknown): McpTestView {
	const payload = data as { ok?: boolean; toolNames?: string[]; toolCount?: number; error?: string } | undefined;
	if (payload?.ok !== true) {
		return { kind: "error", error: payload?.error ?? "" };
	}
	const names = payload.toolNames ?? [];
	const toolCount = payload.toolCount ?? names.length;
	const shown = names.slice(0, MCP_TEST_SHOWN_LIMIT);
	const extra = Math.max(0, Math.max(names.length, toolCount) - shown.length);
	return { kind: "ok", toolCount, shown, extra };
}

/** Red error box whose message can be copied verbatim (server-side errors). */
export function CopyableError({ title, text, className }: { title?: string; text: string; className?: string }) {
	return (
		<div
			className={cx(
				"rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-2.5 py-1.5",
				className,
			)}
		>
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					{title && <span className="mb-0.5 block text-omp-sm font-medium text-(--omp-error)">{title}</span>}
					<span className="block whitespace-pre-wrap break-all font-mono text-omp-xs text-(--omp-error)">
						{text}
					</span>
				</div>
				<CopyButton text={text} />
			</div>
		</div>
	);
}

/**
 * Inline connection-test result: spinner while running, tool list on success
 * (first MCP_TEST_SHOWN_LIMIT names as chips + "+N more"), copyable error on
 * failure. Optional dismiss for card-hosted results.
 */
export function McpTestResultView({
	testing,
	view,
	onDismiss,
	className,
}: {
	testing?: boolean;
	view: McpTestView | null;
	onDismiss?: () => void;
	className?: string;
}) {
	const t = useT();
	if (testing) {
		return (
			<div
				className={cx(
					"flex items-center gap-2 rounded-md border border-(--omp-border-muted) bg-transparent px-2.5 py-1.5",
					className,
				)}
			>
				<Spinner size="sm" />
				<span className="text-omp-sm text-(--omp-muted)">{t("mcp.wizard.testing")}</span>
			</div>
		);
	}
	if (!view) return null;
	if (view.kind === "error") {
		return (
			<div
				className={cx(
					"rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-2.5 py-1.5",
					className,
				)}
			>
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<span className="mb-0.5 block text-omp-sm font-medium text-(--omp-error)">
							{t("mcp.test.failed")}
						</span>
						<span className="block whitespace-pre-wrap break-all font-mono text-omp-xs text-(--omp-error)">
							{view.error || t("mcp.test.unknownError")}
						</span>
					</div>
					{onDismiss && (
						<button
							aria-label={t("mcp.test.dismiss")}
							className="shrink-0 text-(--omp-dim) transition-colors hover:text-(--omp-text)"
							onClick={onDismiss}
							title={t("mcp.test.dismiss")}
							type="button"
						>
							<X size={11} />
						</button>
					)}
				</div>
			</div>
		);
	}
	return (
		<div className={cx("rounded-md bg-(--omp-tool-success-bg) px-2.5 py-1.5", className)}>
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 text-omp-sm font-medium text-(--omp-success)">
					{view.toolCount > 0 ? t("mcp.test.ok", { count: view.toolCount }) : t("mcp.test.okNoTools")}
				</span>
				{onDismiss && (
					<button
						aria-label={t("mcp.test.dismiss")}
						className="shrink-0 text-(--omp-dim) transition-colors hover:text-(--omp-text)"
						onClick={onDismiss}
						title={t("mcp.test.dismiss")}
						type="button"
					>
						<X size={11} />
					</button>
				)}
			</div>
			{view.shown.length > 0 && (
				<div className="mt-1 flex flex-wrap items-center gap-1">
					{view.shown.map(name => (
						<code
							className="rounded bg-(--omp-code-bg) px-1.5 py-px font-mono text-omp-xs text-(--omp-muted)"
							key={name}
						>
							{name}
						</code>
					))}
					{view.extra > 0 && (
						<span className="text-omp-xs text-(--omp-dim)">{t("mcp.test.more", { count: view.extra })}</span>
					)}
				</div>
			)}
		</div>
	);
}
