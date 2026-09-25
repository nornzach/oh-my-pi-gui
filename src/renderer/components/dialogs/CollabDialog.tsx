import { Copy, ExternalLink, LogOut, Radio, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { RpcCollabState } from "../../../shared/rpc-types";
import { hydrateSession, hydrateTabSession } from "../../hooks/use-rpc-events";
import { copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Input, Modal, Spinner } from "../common";

const EMPTY: RpcCollabState = { role: null, readOnly: false, participants: [] };

export function CollabDialog() {
	const tabRpc = useTabRpc();
	const originTabId = useRuntimeTabId();
	const sessionStore = originTabId ? sessionRuntimeStore<SessionStore>(originTabId, "session") : null;
	const sidecarReady = useStore(sessionStore ?? useSessionStore, state => state.status) === "ready";
	const generation = useRef(0);
	const mutation = useRef(0);
	const busyRef = useRef(false);
	const t = useT();
	const open = useUiStore(state => state.collabOpen);
	const initialJoinLink = useUiStore(state => state.collabJoinLink);
	const close = useUiStore(state => state.closeCollab);
	const [state, setState] = useState<RpcCollabState>(EMPTY);
	const [relay, setRelay] = useState("");
	const [joinLink, setJoinLink] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const confirm = useCallback(
		(value: RpcCollabState) => {
			setState(value);
			(sessionStore ?? useSessionStore).setState({ collab: value });
		},
		[sessionStore],
	);

	const join = useCallback(
		async (link: string) => {
			const trimmed = link.trim();
			if (!sidecarReady || !trimmed) return;
			const version = generation.current;
			mutation.current++;
			busyRef.current = true;
			setBusy(true);
			setError(null);
			try {
				const response = await tabRpc.collabJoin(trimmed);
				if (generation.current !== version) return;
				if (!response.success) throw new Error(response.error);
				confirm(response.data as RpcCollabState);
				if (originTabId) await hydrateTabSession(originTabId);
				else await hydrateSession();
			} catch (cause) {
				if (generation.current === version) setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				if (generation.current === version) {
					busyRef.current = false;
					setBusy(false);
				}
			}
		},
		[sidecarReady, tabRpc.collabJoin, originTabId, confirm],
	);

	useEffect(() => {
		if (!open) return;
		setJoinLink(initialJoinLink ?? "");
		setState(EMPTY);
		busyRef.current = false;
		setBusy(false);
		setError(null);
		const version = ++generation.current;
		let pending = false;
		const refresh = async () => {
			if (pending || busyRef.current || document.visibilityState === "hidden") return;
			const revision = mutation.current;
			pending = true;
			try {
				const response = await tabRpc.getCollabState();
				if (generation.current !== version || revision !== mutation.current) return;
				if (!response.success) throw new Error(response.error);
				confirm(response.data as RpcCollabState);
				setError(null);
			} catch (cause) {
				if (generation.current === version) setError(String(cause));
			} finally {
				pending = false;
			}
		};
		void refresh();
		const timer = window.setInterval(() => void refresh(), 2000);
		return () => {
			generation.current++;
			window.clearInterval(timer);
		};
	}, [open, initialJoinLink, tabRpc, confirm]);

	const host = async () => {
		if (!sidecarReady) return;
		const version = generation.current;
		mutation.current++;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			const response = await tabRpc.collabStart(relay.trim() || undefined);
			if (generation.current !== version) return;
			if (!response.success) throw new Error(response.error);
			confirm(response.data as RpcCollabState);
		} catch (cause) {
			if (generation.current === version) setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (generation.current === version) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	};

	const leave = async () => {
		if (!sidecarReady) return;
		const version = generation.current;
		mutation.current++;
		busyRef.current = true;
		setBusy(true);
		try {
			const response = await tabRpc.collabLeave();
			if (generation.current !== version) return;
			if (!response.success) throw new Error(response.error);
			confirm(response.data as RpcCollabState);
			if (originTabId) await hydrateTabSession(originTabId);
			else await hydrateSession();
		} catch (cause) {
			if (generation.current === version) setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (generation.current === version) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	};

	const copy = async (value: string) => {
		if (await copyText(value)) toast({ variant: "success", message: t("collab.copied") });
		else toast({ variant: "error", message: t("collab.copyFailed") });
	};

	return (
		<Modal
			onClose={() => {
				if (!busy) close();
			}}
			open={open}
			size="lg"
			title={t("collab.title")}
		>
			{state.role ? (
				<div className="space-y-4">
					<div className="flex items-center justify-between rounded-lg border border-(--omp-border-muted) bg-transparent p-3">
						<div className="flex items-center gap-2 text-sm text-(--omp-text)">
							<Radio className="text-(--omp-success)" size={15} />
							{state.role === "host"
								? t("collab.hosting")
								: state.readOnly
									? t("collab.viewing")
									: t("collab.joined")}
						</div>
						<Button
							disabled={busy || !sidecarReady}
							onClick={() => void leave()}
							size="sm"
							title={!sidecarReady ? t("modelPicker.notConnected") : undefined}
							variant="danger"
						>
							<LogOut size={13} /> {t("collab.leave")}
						</Button>
					</div>
					{state.role === "host" ? (
						<div className="space-y-3">
							{state.link ? <LinkRow label={t("collab.editLink")} onCopy={copy} value={state.link} /> : null}
							{state.viewLink ? (
								<LinkRow label={t("collab.viewLink")} onCopy={copy} value={state.viewLink} />
							) : null}
							{state.webLink ? (
								<WebLinkRow label={t("collab.webLink")} onCopy={copy} value={state.webLink} />
							) : null}
							{state.webViewLink ? (
								<WebLinkRow label={t("collab.webViewLink")} onCopy={copy} value={state.webViewLink} />
							) : null}
						</div>
					) : null}
					<div>
						<div className="mb-2 flex items-center gap-2 text-xs font-semibold text-(--omp-text)">
							<Users size={14} /> {t("collab.participants")} ({state.participants.length})
						</div>
						<div className="divide-y divide-(--omp-border-muted) rounded-lg border border-(--omp-border-muted)">
							{state.participants.map((participant, index) => (
								<div
									className="flex items-center justify-between px-3 py-2 text-sm"
									key={`${participant.name}-${index}`}
								>
									<span className="text-(--omp-text)">{participant.name}</span>
									<span className="text-xs text-(--omp-dim)">
										{participant.role === "host"
											? t("collab.host")
											: participant.readOnly
												? t("collab.readOnly")
												: t("collab.guest")}
									</span>
								</div>
							))}
						</div>
					</div>
					{error ? <div className="text-sm text-(--omp-error)">{error}</div> : null}
				</div>
			) : (
				<div className="grid gap-5 md:grid-cols-2">
					<section className="space-y-3 rounded-lg border border-(--omp-border-muted) p-4">
						<h3 className="text-sm font-semibold text-(--omp-text)">{t("collab.hostTitle")}</h3>
						<p className="text-xs text-(--omp-dim)">{t("collab.hostDesc")}</p>
						<Input
							onChange={event => setRelay(event.target.value)}
							placeholder={t("collab.relayPlaceholder")}
							value={relay}
						/>
						<Button
							disabled={busy || !sidecarReady}
							onClick={() => void host()}
							title={!sidecarReady ? t("modelPicker.notConnected") : undefined}
						>
							{busy ? <Spinner size="sm" /> : <Radio size={14} />} {t("collab.start")}
						</Button>
					</section>
					<section className="space-y-3 rounded-lg border border-(--omp-border-muted) p-4">
						<h3 className="text-sm font-semibold text-(--omp-text)">{t("collab.joinTitle")}</h3>
						<p className="text-xs text-(--omp-dim)">{t("collab.joinDesc")}</p>
						<Input
							onChange={event => setJoinLink(event.target.value)}
							placeholder={t("collab.joinPlaceholder")}
							value={joinLink}
						/>
						<Button
							disabled={busy || !joinLink.trim() || !sidecarReady}
							onClick={() => void join(joinLink)}
							title={!sidecarReady ? t("modelPicker.notConnected") : undefined}
						>
							{busy ? <Spinner size="sm" /> : <Users size={14} />} {t("collab.join")}
						</Button>
					</section>
					{error ? <div className="text-sm text-(--omp-error) md:col-span-2">{error}</div> : null}
				</div>
			)}
		</Modal>
	);
}

function LinkRow({ label, value, onCopy }: { label: string; value: string; onCopy(value: string): Promise<void> }) {
	return (
		<div>
			<div className="mb-1 text-xs font-medium text-(--omp-dim)">{label}</div>
			<div className="flex gap-2">
				<code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-(--omp-code-bg) px-3 py-2 text-xs text-(--omp-text)">
					{value}
				</code>
				<Button aria-label={label} onClick={() => void onCopy(value)} size="sm" variant="secondary">
					<Copy size={13} />
				</Button>
			</div>
		</div>
	);
}

function WebLinkRow(props: { label: string; value: string; onCopy(value: string): Promise<void> }) {
	return (
		<div className="flex items-end gap-2">
			<div className="min-w-0 flex-1">
				<LinkRow {...props} />
			</div>
			<Button
				aria-label={props.label}
				onClick={() => void window.omp.system.openExternal(props.value)}
				size="sm"
				variant="secondary"
			>
				<ExternalLink size={13} />
			</Button>
		</div>
	);
}
