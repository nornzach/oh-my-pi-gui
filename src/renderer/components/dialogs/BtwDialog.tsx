import { GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getBtwLatestTurn } from "../../../shared/rpc-types";
import { hydrateSession, hydrateTabSession } from "../../hooks/use-rpc-events";
import { copyText, formatClock } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { useBtwStore } from "../../stores/btw";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner, TextArea } from "../common";
import { BtwAnswer } from "../panels/BtwAnswer";

export function BtwDialog() {
	const t = useT();
	const tabId = useRuntimeTabId();
	const generation = useRef(0);
	const [draft, setDraft] = useState("");
	const question = useUiStore(state => state.btwRequest);
	const close = useUiStore(state => state.closeBtw);
	const records = useBtwStore(state => state.records);
	const branchableId = useBtwStore(state => state.branchableId);
	const pending = useBtwStore(state => state.pending);
	const ask = useBtwStore(state => state.ask);
	const cancel = useBtwStore(state => state.cancel);
	const branch = useBtwStore(state => state.branch);
	const [recordId, setRecordId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [branching, setBranching] = useState(false);

	const record = recordId ? (records.find(candidate => candidate.id === recordId) ?? null) : null;
	const latest = record ? getBtwLatestTurn(record) : null;
	const running = latest?.status === "running";
	const runningRecord = records.find(candidate => getBtwLatestTurn(candidate).status === "running");
	const busy = pending || runningRecord !== undefined;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a tab switch invalidates the local topic id even when the question string is unchanged.
	useEffect(() => {
		generation.current++;
		setRecordId(null);
		setError(null);
		setBranching(false);
		setDraft(question ?? "");
	}, [question, tabId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh the newly focused tab's store; the tab id is the trigger.
	useEffect(() => {
		void useBtwStore.getState().refresh();
	}, [tabId]);

	const closeDialog = (): void => {
		// Closing is not a cancel: the answer keeps streaming into the sidebar's
		// topic list, so put that list in view instead of discarding the turn.
		const active = busy;
		close();
		if (active) useUiStore.getState().setPanelTab("btw");
	};

	const askNow = async (): Promise<void> => {
		if (!draft.trim() || busy) return;
		const version = generation.current;
		setError(null);
		try {
			const started = await ask(draft.trim(), recordId ?? undefined);
			if (generation.current !== version) return;
			setRecordId(started.id);
			setDraft("");
		} catch (cause) {
			if (generation.current === version) setError(String(cause));
		}
	};

	const answerText = latest?.answer ?? "";
	const canBranch = recordId !== null && branchableId === recordId && latest?.status === "complete";

	const stop = (): void => {
		if (!recordId) return;
		void cancel(recordId).catch(() => {});
	};

	const copyAnswer = async (): Promise<void> => {
		if (!answerText.trim()) return;
		if (!(await copyText(answerText))) {
			toast({ variant: "error", message: t("btw.copyFailed") });
			return;
		}
		toast({ variant: "success", message: t("btw.copied") });
	};

	const branchNow = async (): Promise<void> => {
		if (!canBranch || branching) return;
		const version = generation.current;
		setBranching(true);
		try {
			const data = await branch();
			if (data.cancelled) {
				toast({ variant: "info", message: t("btw.branchCancelled") });
				return;
			}
			if (tabId) await hydrateTabSession(tabId);
			else await hydrateSession();
			if (version !== generation.current) return;
			close();
			toast({ variant: "success", message: t("btw.branched") });
		} catch (cause) {
			toast({ variant: "error", title: t("btw.branchFailed"), message: String(cause) });
		} finally {
			setBranching(false);
		}
	};

	const statusNote = latest
		? latest.status === "cancelled" || latest.status === "interrupted"
			? t("btw.statusCancelled")
			: latest.status === "error"
				? latest.error || t("btw.statusError")
				: null
		: null;

	return (
		<Modal onClose={closeDialog} open={question !== null} size="lg" title={t("btw.title")}>
			<div className="flex max-h-[70vh] flex-col">
				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					{pending && !record ? (
						<div className="flex items-center justify-center gap-2 py-16 text-sm text-(--omp-dim)">
							<Spinner size="sm" /> {t("btw.thinking")}
						</div>
					) : error ? (
						<div className="rounded-lg border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent p-3 text-sm text-[var(--omp-error)]">
							{error}
						</div>
					) : record && latest ? (
						<div className="space-y-4">
							<div className="flex flex-col items-end gap-1">
								<div className="max-w-[85%] rounded-xl border border-[var(--omp-user-msg-border)] bg-[var(--omp-user-msg-bg)] px-3.5 py-3 text-omp-lg leading-[1.6] text-[var(--omp-text)]">
									<MarkdownRenderer content={latest.question} />
								</div>
								<div className="text-omp-xs tabular-nums text-(--omp-dim)">{formatClock(latest.createdAt)}</div>
							</div>
							<div className="flex flex-col items-start gap-1.5">
								{answerText ? (
									<BtwAnswer answer={answerText} inject={record.inject} recordId={record.id} />
								) : running ? (
									<div className="flex items-center gap-2 py-3 text-sm text-(--omp-dim)">
										<Spinner size="sm" /> {t("btw.thinking")}
									</div>
								) : null}
								{statusNote ? <div className="text-xs text-(--omp-dim)">{statusNote}</div> : null}
							</div>
						</div>
					) : null}
				</div>
				<div className="mt-4 shrink-0 border-t border-(--omp-border-muted) pt-3">
					{busy && !running ? (
						<div className="mb-1.5 flex items-center gap-2 text-omp-xs text-(--omp-dim)">
							<span className="min-w-0 flex-1">{t("btw.busyHint")}</span>
							<Button
								onClick={() => {
									if (runningRecord) void cancel(runningRecord.id).catch(() => {});
								}}
								size="sm"
								variant="secondary"
							>
								{t("btw.cancel")}
							</Button>
						</div>
					) : null}
					<TextArea
						aria-label={t("btw.title")}
						autoGrow
						className="max-h-40 w-full"
						disabled={pending || branching}
						onChange={event => {
							setDraft(event.target.value);
						}}
						onKeyDown={event => {
							if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
								event.preventDefault();
								void askNow();
							}
						}}
						placeholder={recordId ? t("btw.followUpPlaceholder") : t("btw.questionPlaceholder")}
						rows={2}
						value={draft}
					/>
					<div className="mt-2 flex flex-wrap items-center justify-end gap-2">
						{running ? (
							<Button onClick={stop} size="sm" variant="secondary">
								{t("btw.cancel")}
							</Button>
						) : (
							<Button
								disabled={!draft.trim() || pending || branching || busy}
								loading={pending}
								onClick={() => void askNow()}
								size="sm"
							>
								{recordId ? t("btw.followUp") : t("btw.ask")}
							</Button>
						)}
						<Button disabled={!answerText.trim()} onClick={() => void copyAnswer()} size="sm" variant="secondary">
							{t("btw.copy")}
						</Button>
						<Button disabled={!canBranch || branching} onClick={() => void branchNow()} size="sm">
							{branching ? <Spinner size="sm" /> : <GitBranch size={13} />}
							{t("btw.branch")}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
