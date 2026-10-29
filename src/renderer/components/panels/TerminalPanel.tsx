import "@xterm/xterm/css/xterm.css";
import { Bot, Plus, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RpcTerminalInfo } from "../../../shared/rpc-types";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { scrollStripOnWheel, useActiveChipInView } from "../../lib/strip-scroll";
import { useTabsStore } from "../../stores/tabs";
import {
	closeTerminal,
	openTerminal,
	setActiveTerminal,
	syncTerminals,
	terminalView,
	useTabTerminals,
	useTerminalsStore,
} from "../../stores/terminals";
import { Button } from "../common";
import { PanelEmpty } from "./workspace-ui";

/** Tabs that already got their first shell, so closing every terminal does not spawn another. */
const autoOpenedTabs = new Set<string>();

function TerminalChip({
	terminal,
	active,
	onSelect,
	onClose,
}: {
	terminal: RpcTerminalInfo;
	active: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	const t = useT();
	const agent = terminal.kind !== "shell";
	const Icon = agent ? Bot : SquareTerminal;
	const ref = useActiveChipInView<HTMLDivElement>(active);
	const where = [terminal.title, terminal.host && `ssh ${terminal.host}`, terminal.cwd].filter(Boolean).join(" — ");
	// A session shows what it is doing: running the agent's command, or waiting for the user.
	const busy = terminal.running && (terminal.state === "busy" || terminal.state === "starting");
	const asking = terminal.running && terminal.state === "input";
	return (
		<div
			ref={ref}
			className={cx(
				"group flex h-7 max-w-44 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 text-omp-sm",
				active ? "bg-(--omp-selected-bg) text-(--omp-text)" : "text-(--omp-muted) hover:text-(--omp-text)",
			)}
		>
			<button
				type="button"
				aria-pressed={active}
				onClick={onSelect}
				title={terminal.kind === "command" ? terminal.title : where}
				className="flex min-w-0 items-center gap-1.5"
			>
				<Icon aria-hidden="true" size={13} className={cx("shrink-0", agent && "text-(--omp-accent)")} />
				<span className={cx("truncate", !terminal.running && "text-(--omp-dim) line-through")}>
					{terminal.title}
				</span>
				{terminal.root && terminal.running && (
					<span className="shrink-0 rounded px-1 text-omp-xxs font-medium text-(--omp-error) ring-1 ring-(--omp-error)/40">
						root
					</span>
				)}
				{(busy || asking) && (
					<span
						data-session-state={terminal.state}
						role="img"
						aria-label={t(asking ? "terminal.state.input" : "terminal.state.busy")}
						title={t(asking ? "terminal.state.input" : "terminal.state.busy")}
						className={cx(
							"size-1.5 shrink-0 rounded-full",
							asking ? "bg-(--omp-warning)" : "animate-pulse bg-(--omp-accent)",
						)}
					/>
				)}
			</button>
			<button
				type="button"
				aria-label={t("terminal.close")}
				title={t("terminal.close")}
				onClick={onClose}
				className="flex size-5 shrink-0 items-center justify-center rounded text-(--omp-dim) opacity-0 hover:bg-(--omp-selected-bg) hover:text-(--omp-text) group-hover:opacity-100 focus-visible:opacity-100"
			>
				<X size={12} />
			</button>
		</div>
	);
}

/** What an agent session is: the agent's shell, a question waiting on the user, a root shell. */
function SessionNotice({ terminal }: { terminal: RpcTerminalInfo }) {
	const t = useT();
	if (terminal.state === "input") {
		return (
			<p
				data-session-notice="input"
				className="shrink-0 border-b border-(--omp-border-muted) bg-(--omp-warning-dim) px-3 py-1.5 text-omp-xs text-(--omp-text)"
			>
				{t("terminal.sessionInput")}
			</p>
		);
	}
	return (
		<p className="shrink-0 border-b border-(--omp-border-muted) bg-(--omp-accent-dim) px-3 py-1.5 text-omp-xs text-(--omp-text)">
			{terminal.host ? t("terminal.sessionRemote", { host: terminal.host }) : t("terminal.session")}
			{terminal.root && <span className="text-(--omp-error)"> {t("terminal.sessionRoot")}</span>}
		</p>
	);
}

/**
 * Terminal drawer view: login shells in the tab's workspace, plus the
 * commands the agent ran with `pty: true`, which wait here for the user to
 * answer them (passwords, prompts, editors), and long-lived commands the agent
 * started with its `terminal` tool. Shells keep running while the drawer is
 * closed or another tab is in front.
 */
export function TerminalPanel() {
	const t = useT();
	const tabId = useTabsStore(state => state.activeTabId);
	const sidecarUp = useTabsStore(state => {
		const status = state.tabs.find(tab => tab.id === state.activeTabId)?.status;
		return status === "ready" || status === "running";
	});
	const { terminals, activeId } = useTabTerminals(tabId);
	const active = terminals.find(terminal => terminal.terminalId === activeId) ?? null;
	const containerRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [opening, setOpening] = useState(false);

	const startShell = useCallback(async (): Promise<void> => {
		if (!tabId) return;
		setOpening(true);
		setError(null);
		try {
			await openTerminal(tabId);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setOpening(false);
		}
	}, [tabId]);

	// Adopt terminals that started before this window loaded, then give a tab
	// its first shell the first time the user looks at its terminal.
	useEffect(() => {
		if (!tabId || !sidecarUp) return;
		let cancelled = false;
		void syncTerminals(tabId).then(async () => {
			if (cancelled || autoOpenedTabs.has(tabId)) return;
			autoOpenedTabs.add(tabId);
			const existing = useTerminalsStore.getState().byTab[tabId]?.terminals.length ?? 0;
			if (existing === 0) await startShell();
		});
		return () => {
			cancelled = true;
		};
	}, [tabId, sidecarUp, startShell]);

	// Show the active terminal's xterm and keep it sized to the drawer.
	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!tabId || !activeId || !container) return;
		const view = terminalView(tabId, activeId);
		if (!view) return;
		container.appendChild(view.host);
		if (!view.opened) {
			view.term.open(view.host);
			view.opened = true;
		}
		const fitToContainer = (): void => {
			if (container.clientWidth === 0 || container.clientHeight === 0) return;
			try {
				view.fit.fit();
			} catch {
				// xterm measures fonts on first paint; the next resize fits it.
			}
		};
		fitToContainer();
		view.term.focus();
		const observer = new ResizeObserver(fitToContainer);
		observer.observe(container);
		return () => {
			observer.disconnect();
			view.host.remove();
		};
	}, [tabId, activeId]);

	return (
		<div className="flex h-full flex-col">
			<span className="sr-only">{t("panel.tabs.terminal")}</span>
			<div
				onWheel={scrollStripOnWheel}
				className="omp-tab-scroller flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-(--omp-border-muted) px-2"
			>
				{tabId &&
					terminals.map(terminal => (
						<TerminalChip
							key={terminal.terminalId}
							terminal={terminal}
							active={terminal.terminalId === activeId}
							onSelect={() => setActiveTerminal(tabId, terminal.terminalId)}
							onClose={() => void closeTerminal(tabId, terminal.terminalId)}
						/>
					))}
				<button
					type="button"
					aria-label={t("terminal.new")}
					title={t("terminal.new")}
					disabled={!sidecarUp || opening}
					onClick={() => void startShell()}
					className="omp-pressable ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-text) disabled:pointer-events-none disabled:opacity-40"
				>
					<Plus size={15} />
				</button>
			</div>
			{active?.kind === "session" && active.running ? (
				<SessionNotice terminal={active} />
			) : (
				active?.kind !== "shell" &&
				active?.running && (
					<p className="shrink-0 border-b border-(--omp-border-muted) bg-(--omp-accent-dim) px-3 py-1.5 text-omp-xs text-(--omp-text)">
						{t(active.kind === "command" ? "terminal.agentWaiting" : "terminal.agentBackground")}
					</p>
				)
			)}
			{error && (
				<p className="shrink-0 border-b border-(--omp-border-muted) bg-(--omp-error-dim) px-3 py-1.5 text-omp-xs text-(--omp-error)">
					{t("terminal.openFailed", { error })}
				</p>
			)}
			{active ? (
				<div className="omp-terminal-viewport min-h-0 flex-1 bg-(--omp-code-bg) py-1.5 pl-2" ref={containerRef} />
			) : (
				<div className="min-h-0 flex-1 overflow-auto">
					<PanelEmpty
						icon={SquareTerminal}
						title={sidecarUp ? t("terminal.emptyTitle") : t("terminal.unavailableTitle")}
						hint={sidecarUp ? t("terminal.emptyHint") : t("terminal.unavailableHint")}
						action={
							sidecarUp ? (
								<Button size="sm" variant="secondary" onClick={() => void startShell()} disabled={opening}>
									{t("terminal.new")}
								</Button>
							) : undefined
						}
					/>
				</div>
			)}
		</div>
	);
}
