import { useTabRpc } from "../../../lib/tab-rpc";
/**
 * PR create dialog (plan/21): title/body form with an [AI 起草] button that
 * fills both fields from the head branch's commits + diffstat (pr_draft,
 * user-editable after), a draft checkbox, and pr_create on submit. The head
 * branch reads from the active tab's live git status; base defaults to the
 * repo's default branch.
 */

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { RpcGitStatus, RpcPrCreateResult, RpcPrDraftResult } from "../../../../shared/rpc-types";
import { useT } from "../../../lib/i18n";
import { usePrCenterStore } from "../../../stores/pr-center";
import { useSessionStore } from "../../../stores/session";
import { toast } from "../../../stores/toast";
import { Button, Input, Modal, TextArea } from "../../common";

const drafts = new Map<string, { title: string; body: string; draft: boolean }>();

export function PrCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const cwd = useSessionStore(state => state.cwd);
	const repo = usePrCenterStore(state => state.repo);
	if (!open || !repo?.available) return null;
	const scope = JSON.stringify([cwd, repo.repo, repo.defaultBranch]);
	return <OpenPrDialog key={scope} scope={scope} base={repo.defaultBranch ?? undefined} onClose={onClose} />;
}

function OpenPrDialog({ scope, base, onClose }: { scope: string; base?: string; onClose: () => void }) {
	const t = useT();
	const rpc = useTabRpc();
	const [head, setHead] = useState<string | null>();
	useEffect(() => {
		let current = true;
		void rpc.getGitStatus().then(
			response => {
				if (current)
					setHead(response.success ? ((response.data as RpcGitStatus | undefined)?.branch ?? null) : null);
			},
			() => {
				if (current) setHead(null);
			},
		);
		return () => {
			current = false;
		};
	}, [rpc]);
	if (head === undefined)
		return (
			<Modal open onClose={onClose} title={t("prCenter.createTitle")} size="lg">
				<p role="status">{t("common.loading")}</p>
			</Modal>
		);
	const draftKey = JSON.stringify([scope, head]);
	return <PrForm key={draftKey} draftKey={draftKey} head={head ?? undefined} base={base} onClose={onClose} />;
}

function PrForm({
	draftKey,
	head,
	base,
	onClose,
}: {
	draftKey: string;
	head?: string;
	base?: string;
	onClose: () => void;
}) {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const [fields, setFields] = useState(() => drafts.get(draftKey) ?? { title: "", body: "", draft: true });
	const { title, body, draft } = fields;
	const edit = (patch: Partial<typeof fields>) => {
		const next = { ...fields, ...patch };
		drafts.set(draftKey, next);
		setFields(next);
	};
	const [drafting, setDrafting] = useState(false);
	const [creating, setCreating] = useState(false);

	const aiDraft = async () => {
		if (!sidecarReady || drafting) return;
		setDrafting(true);
		try {
			const response = await tabRpc.prDraft({ base, head });
			if (!response.success) {
				toast({ variant: "error", title: t("prCenter.draftFailed"), message: response.error });
				return;
			}
			// pr_draft success arm carries RpcPrDraftResult — one named assertion home.
			const result = response.data as RpcPrDraftResult | undefined;
			if (result) {
				edit({ title: result.title, body: result.body });
			}
		} catch (error) {
			toast({ variant: "error", title: t("prCenter.draftFailed"), message: String(error) });
		} finally {
			setDrafting(false);
		}
	};

	const submit = async () => {
		if (!sidecarReady || !title.trim() || creating || drafting) return;
		setCreating(true);
		try {
			const response = await tabRpc.prCreate({ title: title.trim(), body, base, head, draft });
			if (!response.success) {
				toast({ variant: "error", title: t("prCenter.createFailed"), message: response.error });
				return;
			}
			const result = response.data as RpcPrCreateResult | undefined;
			if (result) {
				toast({ variant: "success", message: t("prCenter.created", { number: String(result.number) }) });
				void window.omp.system.openExternal(result.url);
			}
			void usePrCenterStore.getState().refresh();
			drafts.delete(draftKey);
			onClose();
		} catch (error) {
			toast({ variant: "error", title: t("prCenter.createFailed"), message: String(error) });
		} finally {
			setCreating(false);
		}
	};

	return (
		<Modal
			open
			onClose={() => {
				if (!creating && !drafting) onClose();
			}}
			title={t("prCenter.createTitle")}
			size="lg"
		>
			<form
				className="flex flex-col gap-3"
				onSubmit={event => {
					event.preventDefault();
					void submit();
				}}
			>
				<p className="text-omp-sm text-(--omp-dim)">
					{t("prCenter.branches", { head: head ?? "?", base: base ?? "?" })}
				</p>
				<div className="flex items-end gap-2">
					<div className="flex-1">
						<Input
							label={t("prCenter.titleLabel")}
							placeholder={t("prCenter.titlePlaceholder")}
							value={title}
							disabled={creating || drafting}
							onChange={event => edit({ title: event.target.value })}
							maxLength={120}
							autoFocus
						/>
					</div>
					<Button
						disabled={!sidecarReady || creating}
						loading={drafting}
						onClick={() => void aiDraft()}
						title={!sidecarReady ? t("common.notConnected") : undefined}
						type="button"
						variant="secondary"
					>
						<Sparkles size={12} /> {t("prCenter.aiDraft")}
					</Button>
				</div>
				<TextArea
					label={t("prCenter.bodyLabel")}
					placeholder={t("prCenter.bodyPlaceholder")}
					value={body}
					disabled={creating || drafting}
					onChange={event => edit({ body: event.target.value })}
					rows={10}
				/>
				<label className="flex cursor-pointer items-center gap-2 text-omp-md text-(--omp-text)">
					<input
						type="checkbox"
						checked={draft}
						disabled={creating || drafting}
						onChange={event => edit({ draft: event.target.checked })}
						className="accent-(--omp-accent)"
					/>
					{t("prCenter.asDraft")}
				</label>
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						disabled={creating || drafting}
						onClick={() => {
							drafts.delete(draftKey);
							onClose();
						}}
					>
						{t(drafts.has(draftKey) ? "filesPanel.discard" : "common.cancel")}
					</Button>
					<Button
						disabled={!sidecarReady || drafting || title.trim().length === 0}
						loading={creating}
						title={!sidecarReady ? t("common.notConnected") : undefined}
						type="submit"
						variant="primary"
					>
						{t("prCenter.createSubmit")}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
