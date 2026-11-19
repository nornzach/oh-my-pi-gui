/** Core 19 performs handoff in the background within the current session. */
import { Handshake } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { describeError } from "../../lib/errors";
import { useT } from "../../lib/i18n";
import { focusedTabRpc, type TabRpc } from "../../lib/tab-rpc";
import { useForkHandoffStore } from "../../stores/fork-handoff";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { Button, LongTaskStatus, Modal, TextArea } from "../common";

export function HandoffDialog() {
	const t = useT();
	const open = useForkHandoffStore(state => state.handoffDialogOpen);
	const close = useForkHandoffStore(state => state.closeHandoffDialog);
	const isCompacting = useSessionStore(state => state.isCompacting);
	const manualMaintenance = useSessionStore(state => state.manualMaintenance);
	const messageCount = useSessionStore(state => state.messageCount);
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const [instructions, setInstructions] = useState("");
	const [running, setRunning] = useState(false);
	const [stageStartedAt, setStageStartedAt] = useState(0);
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const textRef = useRef<HTMLTextAreaElement>(null);
	// Keep cancellation bound to the initiating session if the active tab changes.
	const activeRpc = useRef<TabRpc | null>(null);
	const stopRequested = useRef(false);
	const openRef = useRef(open);
	openRef.current = open;

	useEffect(() => {
		if (!open || activeRpc.current) return;
		setError(null);
		requestAnimationFrame(() => textRef.current?.focus());
	}, [open]);

	const reportError = (cause: unknown) => {
		const message = describeError(cause);
		setError(message);
		if (!openRef.current) toast({ variant: "error", message });
	};

	const cancel = async () => {
		const rpc = activeRpc.current;
		if (!rpc) {
			close();
			return;
		}
		if (stopRequested.current) return;
		stopRequested.current = true;
		setStopping(true);
		try {
			// Full abort also stops the main response, loop and goal; only cancel maintenance.
			const response = await rpc.abortCompaction();
			if (!response.success) throw new Error(response.error);
		} catch (cause) {
			stopRequested.current = false;
			setStopping(false);
			reportError(cause);
		}
	};

	const blockedReason =
		!running && (isCompacting || manualMaintenance !== null)
			? t("handoff.blockedCompacting")
			: messageCount === 0
				? t("handoff.blockedEmpty")
				: null;

	const submit = async () => {
		if (!sidecarReady || activeRpc.current || blockedReason !== null) return;
		const rpc = focusedTabRpc();
		activeRpc.current = rpc;
		setRunning(true);
		setStopping(false);
		stopRequested.current = false;
		setError(null);
		setStageStartedAt(Date.now());
		try {
			const trimmed = instructions.trim();
			const response = await rpc.handoff(trimmed.length > 0 ? trimmed : undefined);
			if (!response.success) throw new Error(response.error);
			// Core returns {} and updates the current session. Never fork or replace
			// live transcript state here; manual_compaction_end refreshes it safely.
			setInstructions("");
			close();
			toast({ variant: "success", title: t("handoff.successTitle"), message: t("handoff.success") });
		} catch (cause) {
			if (stopRequested.current && /cancel|abort/i.test(describeError(cause))) {
				toast({ variant: "info", message: t("handoff.cancelled") });
			} else {
				reportError(cause);
			}
		} finally {
			activeRpc.current = null;
			stopRequested.current = false;
			setRunning(false);
			setStopping(false);
		}
	};

	return (
		<Modal open={open} onClose={close} title={t("handoff.title")} size="md">
			<div className="flex flex-col gap-3">
				<div className="flex items-start gap-2.5 rounded-md border border-(--omp-border-muted) bg-transparent px-3 py-2.5">
					<Handshake className="mt-0.5 shrink-0 text-(--omp-accent)" size={14} />
					<p className="text-omp-sm leading-relaxed text-(--omp-muted)">{t("handoff.desc")}</p>
				</div>
				<TextArea
					autoGrow
					disabled={running}
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
					<LongTaskStatus
						label={t(stopping ? "handoff.stopping" : "handoff.generating")}
						slowHint={t("chat.maintenance.slow")}
						startedAt={stageStartedAt}
					/>
				)}
				<div className="flex justify-end gap-2">
					<Button disabled={stopping} onClick={() => void cancel()} type="button" variant="ghost">
						{t(running ? "handoff.stop" : "common.cancel")}
					</Button>
					<Button
						disabled={blockedReason !== null || !sidecarReady}
						loading={running}
						onClick={() => void submit()}
						title={blockedReason ?? (!sidecarReady ? t("sidecar.notResponding") : undefined)}
						type="button"
						variant="primary"
					>
						{t("handoff.start")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
