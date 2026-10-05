import { Mic, MicOff, PhoneOff } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { RpcLiveFrame, RpcLiveMuteResult, RpcLiveStartResult } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { INITIAL_LIVE_STATE, type LiveViewState, reduceLiveFrame } from "../../lib/live-state";
import { acceptsActiveTabEvents } from "../../lib/tab-routing";
import { useTabCommand } from "../../stores/session-runtime-context";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner } from "../common";

type LiveAction =
	| { kind: "frame"; frame: RpcLiveFrame }
	| { kind: "reset" }
	| { kind: "patch"; patch: Partial<LiveViewState> };

function liveReducer(state: LiveViewState, action: LiveAction): LiveViewState {
	if (action.kind === "reset") return INITIAL_LIVE_STATE;
	if (action.kind === "patch") return { ...state, ...action.patch };
	return reduceLiveFrame(state, action.frame);
}

export function LiveVoiceDialog() {
	const t = useT();
	const command = useTabCommand();
	const generation = useRef(0);
	const transcriptEnd = useRef<HTMLDivElement>(null);
	const open = useUiStore(state => state.liveOpen);
	const closeStore = useUiStore(state => state.closeLive);
	const [state, dispatch] = useReducer(liveReducer, INITIAL_LIVE_STATE);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		generation.current++;
		dispatch({ kind: "reset" });
		const unsubscribe = window.omp.events.onLiveFrame(frame => {
			if (!cancelled && acceptsActiveTabEvents()) dispatch({ kind: "frame", frame });
		});
		return () => {
			cancelled = true;
			generation.current++;
			unsubscribe();
		};
	}, [open]);

	const lastEntry = state.transcript.at(-1);
	useEffect(() => {
		if (lastEntry) transcriptEnd.current?.scrollIntoView?.({ block: "end" });
	}, [lastEntry]);

	const run = useCallback(
		async (type: "live_start" | "live_stop" | "live_mute", payload: { muted?: boolean } = {}) => {
			const version = generation.current;
			setBusy(true);
			if (type === "live_start") dispatch({ kind: "patch", patch: { ...INITIAL_LIVE_STATE, active: true } });
			try {
				const response = await command({ type, ...payload }, type === "live_start" ? 60_000 : 15_000);
				if (!response.success) throw new Error(response.error);
				if (version !== generation.current) return true;
				if (type === "live_start") {
					dispatch({ kind: "patch", patch: { voice: (response.data as RpcLiveStartResult).voice } });
				} else if (type === "live_mute") {
					dispatch({ kind: "patch", patch: { muted: (response.data as RpcLiveMuteResult).muted } });
				}
				return true;
			} catch (cause) {
				// A start superseded by End call (or by closing) reports its cancellation here; stay quiet.
				if (version !== generation.current) return false;
				const message = cause instanceof Error ? cause.message : String(cause);
				dispatch({
					kind: "patch",
					patch: type === "live_start" ? { active: false, phase: "error", error: message } : { error: message },
				});
				toast({ variant: "error", message });
				return false;
			} finally {
				if (version === generation.current) setBusy(false);
			}
		},
		[command],
	);

	const close = useCallback(async () => {
		if (busy && !state.active) return;
		if (state.active) {
			// Supersede an in-flight live_start: live_stop cancels the connect.
			generation.current++;
			if (!(await run("live_stop"))) return;
		}
		closeStore();
	}, [busy, closeStore, run, state.active]);

	const connecting = busy && state.phase === "connecting";
	const phaseLabel = !state.active && !busy && !state.error ? t("live.ready") : t(`live.phase.${state.phase}`);
	return (
		<Modal onClose={() => void close()} open={open} size="md" title={t("live.title")}>
			<div className="space-y-4">
				<div className="flex items-center justify-center gap-2 py-2 text-sm font-medium text-(--omp-text)">
					{connecting ? <Spinner size="sm" /> : null}
					<span>{phaseLabel}</span>
					{state.active && state.voice ? (
						<span className="text-omp-xs font-normal text-(--omp-dim)">
							· {t("live.voice", { voice: state.voice })}
						</span>
					) : null}
				</div>
				<div className="space-y-3 rounded-lg border border-(--omp-border-muted) bg-transparent p-4">
					<Level label={t("live.input")} value={state.inputLevel} />
					<Level label={t("live.output")} value={state.outputLevel} />
				</div>
				<div className="max-h-64 min-h-24 space-y-2 overflow-y-auto rounded-lg border border-(--omp-border-muted) bg-transparent p-3 text-sm">
					{state.transcript.length > 0 ? (
						state.transcript.map(entry => (
							<div key={`${entry.role}:${entry.turn}`}>
								<div className="mb-0.5 text-omp-xs font-semibold uppercase tracking-wide text-(--omp-dim)">
									{entry.role === "user" ? t("live.you") : t("live.assistant")}
								</div>
								<div
									className={`whitespace-pre-wrap ${entry.final ? "text-(--omp-text)" : "text-(--omp-dim)"}`}
								>
									{entry.text}
								</div>
							</div>
						))
					) : (
						<div className="text-(--omp-dim)">{t("live.waiting")}</div>
					)}
					<div ref={transcriptEnd} />
				</div>
				{state.error ? <div className="text-sm text-(--omp-error)">{state.error}</div> : null}
				<div className="flex justify-end gap-2">
					{!state.active && (
						<Button disabled={busy} loading={busy} onClick={() => void run("live_start")}>
							{t("live.start")}
						</Button>
					)}
					<Button
						disabled={!state.active || busy}
						onClick={() => void run("live_mute", { muted: !state.muted })}
						variant="secondary"
					>
						{state.muted ? <Mic size={14} /> : <MicOff size={14} />}
						{state.muted ? t("live.unmute") : t("live.mute")}
					</Button>
					<Button disabled={busy && !state.active} onClick={() => void close()} variant="danger">
						<PhoneOff size={14} /> {state.active ? t("live.end") : t("common.close")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function Level({ label, value }: { label: string; value: number }) {
	const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
	return (
		<div className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-2 text-xs">
			<span className="text-(--omp-dim)">{label}</span>
			<div
				className="h-2 overflow-hidden rounded-full bg-(--omp-bg-primary)" // surface-ok: level meter track
			>
				<div className="h-full bg-(--omp-accent) transition-[width] duration-75" style={{ width: `${percent}%` }} />
			</div>
			<span className="text-right tabular-nums text-(--omp-dim)">{percent}%</span>
		</div>
	);
}
