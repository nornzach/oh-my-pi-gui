/**
 * Tool-approval dialog. The sidecar routes tool approval through a plain
 * `select` extension-UI request ending in ["Approve"?, <session>?, "Deny"] —
 * under `always-ask-cached` the same request also leads with grant options
 * ("remember this file/folder" choices, rendered here as extra rows) — and a
 * title of the form "Allow tool: <name>\n<details>". This component gives that
 * prompt a dedicated surface: tool name, capability tier badge, and a
 * monospace args preview. Deny (or closing the dialog) answers with the
 * "Deny" option.
 */

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { type ApprovalSelect, parseApprovalTitle } from "../../../shared/approval-prompt";
import { useT } from "../../lib/i18n";
import { Badge, type BadgeVariant, Button, Modal } from "../common";

const SESSION_OPTION = /^Approve (.+) for this session$/;

export type ApprovalResponse = { value: string } | { confirmed: boolean } | { cancelled: true };

/** The "approve for this session" option and the subject it names, when the prompt offers one. */
function sessionOption(request: ApprovalSelect): { value: string; subject: string } | undefined {
	for (const option of request.options) {
		const subject = SESSION_OPTION.exec(option)?.[1];
		if (subject !== undefined) return { value: option, subject };
	}
	return undefined;
}

/** Grant ("remember") options: every option that is not Approve/session/Deny. */
function grantOptions(request: ApprovalSelect, sessionValue: string | undefined): string[] {
	return request.options.filter(option => option !== "Approve" && option !== "Deny" && option !== sessionValue);
}

const READ_TOOLS = new Set([
	"read",
	"grep",
	"glob",
	"ls",
	"find",
	"lsp",
	"web_search",
	"inspect_image",
	"recall",
	"get_branch_messages",
]);

const WRITE_TOOLS = new Set([
	"edit",
	"write",
	"ast_edit",
	"apply_patch",
	"memory_edit",
	"retain",
	"reflect",
	"learn",
	"manage_skill",
	"set_session_name",
	"todo",
	"goal",
]);

/** Tier badge: read=green, write=yellow, exec=red (default tier is exec). */
function tierFor(toolName: string): { key: string; variant: BadgeVariant } {
	if (READ_TOOLS.has(toolName)) return { key: "approval.tier.read", variant: "success" };
	if (WRITE_TOOLS.has(toolName)) return { key: "approval.tier.write", variant: "warning" };
	return { key: "approval.tier.exec", variant: "error" };
}

export function ApprovalDialog({
	request,
	onRespond,
}: {
	request: ApprovalSelect;
	onRespond: (response: ApprovalResponse) => void;
}) {
	const t = useT();
	const { toolName, body } = useMemo(() => {
		const { toolName: name, body: rest } = parseApprovalTitle(request.title);
		return { toolName: name || t("approval.unknownTool"), body: rest };
	}, [request.title, t]);

	const tier = tierFor(toolName);
	const session = sessionOption(request);
	const grants = grantOptions(request, session?.value);
	const deny = () => onRespond({ value: "Deny" });

	return (
		<Modal onClose={deny} open size="md" title={t("approval.title")}>
			<div className="flex flex-col">
				<div className="flex items-center gap-2.5">
					<ShieldAlert className="shrink-0 text-(--omp-warning)" size={18} />
					<span className="min-w-0 flex-1 truncate font-mono text-omp-md font-semibold text-(--omp-text)">
						{toolName}
					</span>
					<Badge dot variant={tier.variant}>
						{t(tier.key)}
					</Badge>
				</div>
				<div className="mt-3 max-h-[45vh] overflow-y-auto rounded-md border border-(--omp-border-muted) bg-(--omp-code-bg) p-3">
					{body ? (
						<pre className="font-mono text-omp-sm leading-[1.55] break-words whitespace-pre-wrap text-(--omp-muted)">
							{body}
						</pre>
					) : (
						<span className="text-omp-sm text-(--omp-dim) italic">{t("approval.noArgs")}</span>
					)}
				</div>
				{grants.length > 0 && (
					<div className="mt-3 flex flex-col gap-1.5">
						<span className="text-omp-xs font-medium text-(--omp-dim)">{t("approval.remember")}</span>
						{grants.map(option => (
							<button
								className="rounded-md border border-(--omp-border-muted) px-3 py-1.5 text-left text-omp-xs text-(--omp-text-secondary) transition-colors hover:border-(--omp-border-accent) hover:bg-(--omp-selected-bg)"
								key={option}
								onClick={() => onRespond({ value: option })}
								type="button"
							>
								{option}
							</button>
						))}
					</div>
				)}
				<div className="mt-4 flex items-center justify-between gap-2">
					<span className="text-omp-xs text-(--omp-dim)">{t("approval.waiting")}</span>
					<div className="flex gap-2">
						<Button onClick={deny} size="md" variant="danger">
							{t("approval.deny")}
						</Button>
						{session ? (
							<Button
								className="max-w-64"
								onClick={() => onRespond({ value: session.value })}
								size="md"
								title={session.value}
								variant="secondary"
							>
								<span className="truncate">{t("approval.approveSession", { subject: session.subject })}</span>
							</Button>
						) : null}
						<Button
							variant="primary"
							size="md"
							icon={<ShieldCheck size={13} />}
							onClick={() => onRespond({ value: "Approve" })}
						>
							{t("approval.approve")}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
