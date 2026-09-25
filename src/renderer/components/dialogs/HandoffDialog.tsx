import { useTabRpc } from "../../lib/tab-rpc";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
/**
 * Handoff dialog: explains the handoff flow, collects optional custom
 * instructions, and calls rpc.handoff(instructions?) — the agent summarizes
 * this session into a handoff document and opens a new session carrying that
 * context (the current session is preserved). Mirrors the TUI /handoff guard:
 * unavailable while the agent is streaming, with the reason shown inline.
 */

import { Handshake } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hydrateSession, hydrateTabSession } from "../../hooks/use-rpc-events";
import { useT } from "../../lib/i18n";
import { useForkHandoffStore } from "../../stores/fork-handoff";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { Button, Modal, Spinner, TextArea } from "../common";

interface HandoffResult {
	savedPath?: string;
}

export function HandoffDialog() {
	const tabRpc = useTabRpc();
	const originTabId = useRuntimeTabId();
	const sessionId = useSessionStore(state => state.sessionId);
	const t = useT();
	const open = useForkHandoffStore(state => state.handoffDialogOpen);
	const close = useForkHandoffStore(state => state.closeHandoffDialog);
	const isStreaming = useSessionStore(state => state.isStreaming);
	const messageCount = useSessionStore(state => state.messageCount);
	const sidecarReady = useSessionStore(state => state.status) === "ready";

	const [prepared, setPrepared] = useState<{ sessionId: string; savedPath?: string; forkAttempted?: boolean } | null>(
		null,
	);
	const [stage, setStage] = useState<"summary" | "fork">("summary");
	const [instructions, setInstructions] = useState("");
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const textRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!open) return;
		setInstructions("");
		setRunning(false);
		setError(null);
		requestAnimationFrame(() => textRef.current?.focus());
	}, [open]);

	// The handoff RPC cannot be cancelled from the GUI — block dismissal while
	// the agent is generating the handoff document.
	const requestClose = () => {
		if (!running) close();
	};

	const blockedReason = isStreaming
		? t("handoff.blockedStreaming")
		: messageCount === 0
			? t("handoff.blockedEmpty")
			: null;

	const submit = async () => {
		if (!sidecarReady || running || blockedReason !== null) return;
		setRunning(true);
		setError(null);
		try {
			const trimmed = instructions.trim();
			let result = prepared?.sessionId === sessionId ? prepared : null;
			if (!result) {
				setStage("summary");
				const response = await tabRpc.handoff(trimmed.length > 0 ? trimmed : undefined);
				if (!response.success) {
					setError(response.error);
					return;
				}
				const handoffResult = response.data as HandoffResult | null | undefined;
				if (handoffResult == null) {
					// null data = the agent-side handoff was cancelled.
					close();
					toast({ variant: "info", message: t("handoff.cancelled") });
					return;
				}
				result = { ...handoffResult, sessionId };
				setPrepared(result);
			}
			if (result.forkAttempted) {
				const current = await tabRpc.getState();
				if (!current.success) throw new Error(current.error);
				if ((current.data as { sessionId?: string }).sessionId !== result.sessionId) {
					if (originTabId) await hydrateTabSession(originTabId);
					else await hydrateSession();
					setPrepared(null);
					close();
					toast({ variant: "info", message: t("handoff.sessionChanged") });
					return;
				}
			}
			setPrepared({ ...result, forkAttempted: true });
			setStage("fork");
			const fork = await tabRpc.fork();
			if (!fork.success) throw new Error(fork.error);
			if ((fork.data as { cancelled?: boolean } | undefined)?.cancelled) throw new Error(t("handoff.cancelled"));
			if (originTabId) await hydrateTabSession(originTabId);
			else await hydrateSession();
			setPrepared(null);
			close();
			toast({
				variant: "success",
				title: t("handoff.successTitle"),
				message: result.savedPath ? t("handoff.successSaved", { path: result.savedPath }) : t("handoff.success"),
			});
		} catch (cause) {
			setError(String(cause));
		} finally {
			setRunning(false);
		}
	};

	return (
		<Modal open={open} onClose={requestClose} title={t("handoff.title")} size="md">
			<div className="flex flex-col gap-3">
				<div className="flex items-start gap-2.5 rounded-md border border-(--omp-border-muted) bg-transparent px-3 py-2.5">
					<Handshake className="mt-0.5 shrink-0 text-(--omp-accent)" size={14} />
					<p className="text-omp-sm leading-relaxed text-(--omp-muted)">{t("handoff.desc")}</p>
				</div>
				<TextArea
					autoGrow
					disabled={running || prepared?.sessionId === sessionId}
					hint={t("handoff.instructionsHint")}
					label={t("handoff.instructionsLabel")}
					maxLength={2000}
					onChange={event => setInstructions(event.target.value)}
					placeholder={t("handoff.instructionsPlaceholder")}
					ref={textRef}
					rows={3}
					value={instructions}
				/>
				{blockedReason !== null && (
					<div className="rounded-md border border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] bg-transparent px-3 py-2 text-omp-sm text-(--omp-warning)">
						{blockedReason}
					</div>
				)}
				{error !== null && (
					<div className="rounded-md border border-[var(--omp-error)] bg-transparent px-3 py-2 text-omp-sm text-[var(--omp-error)]">
						{error}
					</div>
				)}
				{running && (
					<div className="flex items-center gap-2 text-omp-sm text-(--omp-dim)">
						<Spinner size="sm" />
						{t(stage === "summary" ? "handoff.generating" : "handoff.creating")}
					</div>
				)}
				<div className="flex justify-end gap-2">
					<Button disabled={running} onClick={requestClose} type="button" variant="ghost">
						{t("common.cancel")}
					</Button>
					<Button
						disabled={blockedReason !== null || !sidecarReady}
						loading={running}
						onClick={() => void submit()}
						title={blockedReason ?? (!sidecarReady ? t("sidecar.notResponding") : undefined)}
						type="button"
						variant="primary"
					>
						{t(prepared?.sessionId === sessionId ? "handoff.retryFork" : "handoff.start")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
