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
import type { RpcPrCreateResult, RpcPrDraftResult } from "../../../../shared/rpc-types";
import { useGitStatus } from "../../../hooks/use-git-status";
import { useT } from "../../../lib/i18n";
import { usePrCenterStore } from "../../../stores/pr-center";
import { useSessionStore } from "../../../stores/session";
import { toast } from "../../../stores/toast";
import { Button, Input, Modal, TextArea } from "../../common";

export function PrCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const repo = usePrCenterStore(state => state.repo);
	const { status: git } = useGitStatus();
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [draft, setDraft] = useState(true);
	const [drafting, setDrafting] = useState(false);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		if (!open) return;
		setTitle("");
		setBody("");
		setDraft(true);
		setDrafting(false);
		setCreating(false);
	}, [open]);

	const head = git?.branch ?? undefined;
	const base = repo?.available ? (repo.defaultBranch ?? undefined) : undefined;

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
				setTitle(result.title);
				setBody(result.body);
			}
		} catch (error) {
			toast({ variant: "error", title: t("prCenter.draftFailed"), message: String(error) });
		} finally {
			setDrafting(false);
		}
	};

	const submit = async () => {
		if (!sidecarReady || !title.trim() || creating) return;
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
			onClose();
		} catch (error) {
			toast({ variant: "error", title: t("prCenter.createFailed"), message: String(error) });
		} finally {
			setCreating(false);
		}
	};

	return (
		<Modal open={open} onClose={onClose} title={t("prCenter.createTitle")} size="lg">
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
							onChange={event => setTitle(event.target.value)}
							maxLength={120}
							autoFocus
						/>
					</div>
					<Button
						disabled={!sidecarReady}
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
					onChange={event => setBody(event.target.value)}
					rows={10}
				/>
				<label className="flex cursor-pointer items-center gap-2 text-omp-md text-(--omp-text)">
					<input
						type="checkbox"
						checked={draft}
						onChange={event => setDraft(event.target.checked)}
						className="accent-(--omp-accent)"
					/>
					{t("prCenter.asDraft")}
				</label>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						disabled={!sidecarReady || title.trim().length === 0}
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
