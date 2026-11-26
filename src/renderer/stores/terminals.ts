/**
 * Sidecar-hosted terminals, per tab: the list the Terminal panel shows and one
 * xterm per terminal. The xterms outlive the panel — closing the drawer or
 * switching tabs keeps the scrollback and the running program — so they live
 * here, not in a component.
 *
 * Output arrives as TERMINAL_FRAME pushes for every tab, visible or not. A
 * window that missed a terminal's opening (it reloaded) adopts it from the
 * sidecar's snapshot instead, and `seq` keeps the snapshot and the live frames
 * from printing anything twice.
 */
import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { create } from "zustand";
import type {
	RpcCommand,
	RpcResponse,
	RpcTerminalFrame,
	RpcTerminalInfo,
	RpcTerminalOutputFrame,
	RpcTerminalSnapshot,
} from "../../shared/rpc-types";
import { translate } from "../lib/i18n";
import { registerTerminalLinks, terminalLinkHandler } from "../lib/terminal-links";
import { unseenOutput } from "../lib/terminal-output";

export interface TabTerminals {
	terminals: RpcTerminalInfo[];
	activeId: string | null;
}

interface TerminalsStore {
	byTab: Record<string, TabTerminals>;
	/** The last terminal that asked to be shown: an agent command waiting on the user. */
	reveal: { tabId: string; terminalId: string; nonce: number } | null;
}

export const useTerminalsStore = create<TerminalsStore>()(() => ({ byTab: {}, reveal: null }));

const EMPTY: TabTerminals = { terminals: [], activeId: null };

export function useTabTerminals(tabId: string | null): TabTerminals {
	return useTerminalsStore(state => (tabId ? (state.byTab[tabId] ?? EMPTY) : EMPTY));
}

function updateTab(tabId: string, update: (current: TabTerminals) => TabTerminals): void {
	useTerminalsStore.setState(state => ({ byTab: { ...state.byTab, [tabId]: update(state.byTab[tabId] ?? EMPTY) } }));
}

function upsertInfo(tabId: string, info: RpcTerminalInfo, activate: boolean): void {
	updateTab(tabId, current => {
		const index = current.terminals.findIndex(terminal => terminal.terminalId === info.terminalId);
		const terminals =
			index === -1
				? [...current.terminals, info]
				: current.terminals.map((terminal, i) => (i === index ? info : terminal));
		return { terminals, activeId: activate || current.activeId === null ? info.terminalId : current.activeId };
	});
}

function removeInfo(tabId: string, terminalId: string): void {
	updateTab(tabId, current => {
		const terminals = current.terminals.filter(terminal => terminal.terminalId !== terminalId);
		const activeId = current.activeId === terminalId ? (terminals.at(-1)?.terminalId ?? null) : current.activeId;
		return { terminals, activeId };
	});
}

export function setActiveTerminal(tabId: string, terminalId: string): void {
	updateTab(tabId, current => ({ ...current, activeId: terminalId }));
}

// ── xterm views ─────────────────────────────────────────────────────────────

export interface TerminalView {
	readonly term: Terminal;
	readonly fit: FitAddon;
	/** xterm's element; the panel moves it in and out of the document. */
	readonly host: HTMLDivElement;
	opened: boolean;
	/** Output written so far, as the sidecar counts it. */
	shownSeq: number;
	/** Live frames held while the snapshot loads; null once it has. */
	pending: RpcTerminalOutputFrame[] | null;
	exited: boolean;
}

const views = new Map<string, TerminalView>();

function viewKey(tabId: string, terminalId: string): string {
	return `${tabId}\u0000${terminalId}`;
}

function command(tabId: string, rpcCommand: RpcCommand): Promise<RpcResponse> {
	return window.omp.rpc.commandForTab(tabId, rpcCommand);
}

/** xterm colors from the active GUI theme (custom properties resolve to plain colors). */
export function terminalTheme(): ITheme {
	const styles = getComputedStyle(document.documentElement);
	const color = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
	return {
		background: color("--omp-code-bg", "#181818"),
		foreground: color("--omp-text", "#ececec"),
		cursor: color("--omp-accent", "#5aa9ff"),
		cursorAccent: color("--omp-code-bg", "#181818"),
		selectionBackground: color("--omp-accent-glow", "rgba(90, 169, 255, 0.25)"),
		black: color("--omp-ansi-black", "#6b6b6b"),
		red: color("--omp-ansi-red", "#f38b82"),
		green: color("--omp-ansi-green", "#6fcf97"),
		yellow: color("--omp-ansi-yellow", "#e8b75f"),
		blue: color("--omp-ansi-blue", "#79b8ff"),
		magenta: color("--omp-ansi-magenta", "#f2b880"),
		cyan: color("--omp-ansi-cyan", "#d2a8ff"),
		white: color("--omp-ansi-white", "#c5c5c5"),
		brightBlack: color("--omp-ansi-bright-black", "#8f8f8f"),
		brightRed: color("--omp-ansi-bright-red", "#f38b82"),
		brightGreen: color("--omp-ansi-bright-green", "#6fcf97"),
		brightYellow: color("--omp-ansi-bright-yellow", "#e8b75f"),
		brightBlue: color("--omp-ansi-bright-blue", "#79b8ff"),
		brightMagenta: color("--omp-ansi-bright-magenta", "#f2b880"),
		brightCyan: color("--omp-ansi-bright-cyan", "#d2a8ff"),
		brightWhite: color("--omp-ansi-bright-white", "#ececec"),
	};
}

/** Re-theme every terminal (the GUI switched between light and dark). */
export function applyTerminalTheme(): void {
	const theme = terminalTheme();
	for (const view of views.values()) view.term.options.theme = theme;
}

export function applyTerminalFontFamily(fontFamily: string): void {
	const resolved = fontFamily || "monospace";
	for (const view of views.values()) view.term.options.fontFamily = resolved;
}

function createView(tabId: string, info: RpcTerminalInfo): TerminalView {
	const styles = getComputedStyle(document.documentElement);
	const term = new Terminal({
		cols: info.cols,
		rows: info.rows,
		fontFamily: styles.getPropertyValue("--font-mono").trim() || "monospace",
		fontSize: 12,
		lineHeight: 1.15,
		cursorBlink: true,
		scrollback: 10_000,
		theme: terminalTheme(),
		linkHandler: terminalLinkHandler,
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	registerTerminalLinks(term);
	const host = document.createElement("div");
	host.className = "omp-terminal-host";
	const view: TerminalView = { term, fit, host, opened: false, shownSeq: 0, pending: null, exited: !info.running };
	const { terminalId } = info;
	const send = (data: string): void => {
		if (!view.exited) void command(tabId, { type: "terminal_input", terminalId, data }).catch(() => {});
	};
	term.onData(send);
	term.onBinary(send);
	term.onResize(({ cols, rows }) => {
		if (!view.exited) void command(tabId, { type: "terminal_resize", terminalId, cols, rows }).catch(() => {});
	});
	views.set(viewKey(tabId, terminalId), view);
	return view;
}

export function terminalView(tabId: string, terminalId: string): TerminalView | undefined {
	return views.get(viewKey(tabId, terminalId));
}

function disposeView(tabId: string, terminalId: string): void {
	const key = viewKey(tabId, terminalId);
	const view = views.get(key);
	if (!view) return;
	views.delete(key);
	view.host.remove();
	view.term.dispose();
}

function writeOutput(view: TerminalView, frame: RpcTerminalOutputFrame): void {
	const text = unseenOutput(view.shownSeq, frame);
	view.shownSeq = Math.max(view.shownSeq, frame.seq);
	if (text) view.term.write(text);
}

function markExited(tabId: string, terminalId: string, exitCode: number | undefined): void {
	const view = views.get(viewKey(tabId, terminalId));
	if (view && !view.exited) {
		view.exited = true;
		const notice =
			exitCode === undefined
				? translate("terminal.exited")
				: translate("terminal.exitedWithCode", { code: exitCode });
		view.term.write(`\r\n\x1b[2m${notice}\x1b[0m\r\n`);
	}
	const info = useTerminalsStore.getState().byTab[tabId]?.terminals.find(t => t.terminalId === terminalId);
	if (info) upsertInfo(tabId, { ...info, running: false, ...(exitCode === undefined ? {} : { exitCode }) }, false);
}

// ── frames and commands ─────────────────────────────────────────────────────

export function handleTerminalFrame(tabId: string, frame: RpcTerminalFrame): void {
	switch (frame.type) {
		case "terminal_opened": {
			const { terminal } = frame;
			if (!views.has(viewKey(tabId, terminal.terminalId))) createView(tabId, terminal);
			upsertInfo(tabId, terminal, frame.reveal === true);
			if (frame.reveal) {
				useTerminalsStore.setState({ reveal: { tabId, terminalId: terminal.terminalId, nonce: Date.now() } });
			}
			return;
		}
		case "terminal_output": {
			const view = views.get(viewKey(tabId, frame.terminalId));
			// A terminal this window never saw open: its snapshot includes this frame.
			if (!view) void syncTerminals(tabId);
			else if (view.pending) view.pending.push(frame);
			else writeOutput(view, frame);
			return;
		}
		case "terminal_exit":
			markExited(tabId, frame.terminalId, frame.exitCode);
			return;
		case "terminal_closed":
			disposeView(tabId, frame.terminalId);
			removeInfo(tabId, frame.terminalId);
			return;
	}
}

async function adoptTerminal(tabId: string, info: RpcTerminalInfo): Promise<void> {
	const view = createView(tabId, info);
	view.pending = [];
	try {
		const response = await command(tabId, { type: "terminal_snapshot", terminalId: info.terminalId });
		if (response.success && views.get(viewKey(tabId, info.terminalId)) === view) {
			const snapshot = response.data as RpcTerminalSnapshot;
			view.term.write(snapshot.data);
			view.shownSeq = snapshot.seq;
		}
	} catch {
		// Without a snapshot the view starts from the next live frame.
	}
	const pending = view.pending ?? [];
	view.pending = null;
	for (const frame of pending) writeOutput(view, frame);
}

const syncing = new Map<string, Promise<void>>();

/**
 * Reconcile a tab's terminals with its sidecar: adopt the ones this window has
 * not seen and drop the ones that are gone (a restarted sidecar has none).
 */
export function syncTerminals(tabId: string): Promise<void> {
	const inFlight = syncing.get(tabId);
	if (inFlight) return inFlight;
	const run = (async () => {
		let terminals: RpcTerminalInfo[];
		try {
			const response = await command(tabId, { type: "terminal_list" });
			if (!response.success) return;
			terminals = (response.data as { terminals?: RpcTerminalInfo[] } | undefined)?.terminals ?? [];
		} catch {
			return;
		}
		const live = new Set(terminals.map(terminal => terminal.terminalId));
		for (const terminal of useTerminalsStore.getState().byTab[tabId]?.terminals ?? []) {
			if (live.has(terminal.terminalId)) continue;
			disposeView(tabId, terminal.terminalId);
			removeInfo(tabId, terminal.terminalId);
		}
		for (const terminal of terminals) {
			if (!views.has(viewKey(tabId, terminal.terminalId))) void adoptTerminal(tabId, terminal);
			upsertInfo(tabId, terminal, false);
		}
	})().finally(() => syncing.delete(tabId));
	syncing.set(tabId, run);
	return run;
}

/** Start a login shell in the tab's workspace and show it. */
export async function openTerminal(tabId: string, size?: { cols: number; rows: number }): Promise<string | null> {
	const response = await command(tabId, { type: "terminal_open", ...(size ?? {}) });
	if (!response.success) throw new Error(response.error);
	const info = response.data as RpcTerminalInfo;
	if (!views.has(viewKey(tabId, info.terminalId))) createView(tabId, info);
	upsertInfo(tabId, info, true);
	return info.terminalId;
}

/** Close a terminal (kills a running program); its `terminal_closed` frame removes it. */
export async function closeTerminal(tabId: string, terminalId: string): Promise<void> {
	const response = await command(tabId, { type: "terminal_close", terminalId }).catch(() => null);
	// Already gone on the sidecar's side: drop the stale entry here.
	if (!response?.success) {
		disposeView(tabId, terminalId);
		removeInfo(tabId, terminalId);
	}
}

/** The tab closed: its sidecar and terminals are gone. */
export function forgetTabTerminals(tabId: string): void {
	for (const terminal of useTerminalsStore.getState().byTab[tabId]?.terminals ?? []) {
		disposeView(tabId, terminal.terminalId);
	}
	useTerminalsStore.setState(state => {
		const { [tabId]: _removed, ...byTab } = state.byTab;
		return { byTab };
	});
}
