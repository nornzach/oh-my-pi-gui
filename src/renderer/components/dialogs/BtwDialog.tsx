import { GitBranch, MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type BtwHistoryRecord, getBtwLatestTurn } from "../../../shared/rpc-types";
import { hydrateSession, hydrateTabSession } from "../../hooks/use-rpc-events";
import { copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { useRuntimeTabId, useTabCommand } from "../../stores/session-runtime-context";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner, TextArea } from "../common";

export function BtwDialog() {
	const t = useT();
	const command = useTabCommand();
	const tabId = useRuntimeTabId();
	const generation = useRef(0);
	const [draft, setDraft] = useState("");
	const question = useUiStore(state => state.btwRequest);
	const close = useUiStore(state => state.closeBtw);
	const [record, setRecord] = useState<BtwHistoryRecord | null>(null);
	const [liveAnswer, setLiveAnswer] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [branching, setBranching] = useState(false);
	const recordIdRef = useRef<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: changing the bound task invalidates the pending answer even if its question is identical.
	useEffect(() => {
		generation.current++;
		setRecord(null);
		setLiveAnswer("");
		setError(null);
		setLoading(false);
		setBranching(false);
		setDraft(question ?? "");
		recordIdRef.current = null;
		return () => {
			generation.current++;
		};
	}, [question, command]);

	// Streaming frames: deltas append to the running answer; record snapshots are
	// authoritative on every lifecycle change (started/complete/cancelled/error).
	useEffect(() => {
		return window.omp.events.onBtwFrame(frame => {
			const currentId = recordIdRef.current;
			if (!currentId) return;
			if (frame.type === "btw_delta") {
				if (frame.recordId === currentId) setLiveAnswer(prev => prev + frame.delta);
				return;
			}
			if (frame.record.id !== currentId) return;
			setRecord(frame.record);
			setLiveAnswer(getBtwLatestTurn(frame.record).answer);
			setLoading(false);
		});
	}, []);

	const ask = async () => {
		if (!draft.trim() || loading) return;
		const version = generation.current;
		setError(null);
		setLoading(true);
		try {
			const priorId = record?.id;
			const response = await command(
				{ type: "btw", question: draft.trim(), ...(priorId ? { recordId: priorId } : {}) },
				120_000,
			);
			if (generation.current !== version) return;
			if (!response.success) throw new Error(response.error);
			const data = response.data as { record: BtwHistoryRecord };
			setRecord(data.record);
			recordIdRef.current = data.record.id;
			setLiveAnswer(getBtwLatestTurn(data.record).answer);
		} catch (cause) {
			if (generation.current === version) setError(String(cause));
		} finally {
			// The response carries the started record; the running state below
			// shows its own streaming/thinking indicator.
			if (generation.current === version) setLoading(false);
		}
	};

	const latest = record ? getBtwLatestTurn(record) : null;
	const running = latest?.status === "running";
	const answerText = running || !record ? liveAnswer : latest!.answer;
	const canBranch = latest?.status === "complete";

	const copyAnswer = async (): Promise<void> => {
		if (!answerText.trim()) return;
		if (!(await copyText(answerText))) {
			toast({ variant: "error", message: t("btw.copyFailed") });
			return;
		}
		toast({ variant: "success", message: t("btw.copied") });
	};

	const branch = async (): Promise<void> => {
		if (!canBranch || branching) return;
		const version = generation.current;
		setBranching(true);
		try {
			const response = await command({ type: "btw_branch" });
			if (!response.success) throw new Error(response.error);
			const data = response.data as { cancelled?: boolean } | undefined;
			if (data?.cancelled) {
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

	return (
		<Modal onClose={close} open={question !== null} size="lg" title={t("btw.title")}>
			<div className="mb-4 flex items-start gap-2 rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2.5 text-xs text-(--omp-dim)">
				<MessageCircleQuestion className="mt-0.5 shrink-0" size={14} />
				<TextArea
					aria-label={t("btw.title")}
					value={draft}
					onChange={event => {
						setDraft(event.target.value);
					}}
					disabled={loading || branching}
					rows={3}
				/>
			</div>
			{loading && !record ? (
				<div className="flex items-center justify-center gap-2 py-16 text-sm text-(--omp-dim)">
					<Spinner size="sm" /> {t("btw.thinking")}
				</div>
			) : error ? (
				<div className="rounded-lg border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent p-3 text-sm text-[var(--omp-error)]">
					{error}
				</div>
			) : record ? (
				<div className="max-h-[55vh] overflow-y-auto pr-1">
					{latest && latest.status !== "running" && latest.status !== "complete" ? (
						<div className="mb-2 text-xs text-(--omp-dim)">
							{latest.status === "cancelled" || latest.status === "interrupted"
								? t("btw.statusCancelled")
								: latest.error || t("btw.statusError")}
						</div>
					) : null}
					{answerText ? (
						<MarkdownRenderer content={answerText} />
					) : (
						<div className="flex items-center gap-2 py-8 text-sm text-(--omp-dim)">
							<Spinner size="sm" /> {t("btw.thinking")}
						</div>
					)}
					{(record.followUps?.length ?? 0) > 0 && latest && latest.question !== record.question && (
						<div className="mt-2 text-xs text-(--omp-dim)">{latest.question}</div>
					)}
				</div>
			) : null}
			<div className="mt-5 flex justify-end gap-2 border-t border-(--omp-border-muted) pt-3">
				<Button
					disabled={!draft.trim() || loading || branching}
					loading={loading}
					onClick={() => void ask()}
					size="sm"
				>
					{t("btw.ask")}
				</Button>
				<Button disabled={!answerText.trim()} onClick={() => void copyAnswer()} size="sm" variant="secondary">
					{t("btw.copy")}
				</Button>
				<Button disabled={!canBranch || branching} onClick={() => void branch()} size="sm">
					{branching ? <Spinner size="sm" /> : <GitBranch size={13} />}
					{t("btw.branch")}
				</Button>
			</div>
		</Modal>
	);
}
