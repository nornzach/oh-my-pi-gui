/**
 * Pool of per-tab sidecar processes.
 *
 * Each TAB owns one SidecarManager; a window holds N tabs. There is no tab
 * cap — a tab's process is spawned only once the tab is shown (deferStart),
 * so idle tabs cost nothing. The pool wires each sidecar's events to its
 * owning window, and releases the sidecar (listeners first, then dispose) when its
 * tab closes or its window closes.
 *
 * Event routing: the full event channels (events batch, status, subagent,
 * live, commands, config, prompt result, command output, session info,
 * extension ui/error, host tool/uri) forward from at most two VISIBLE tabs.
 * One of them is focused for untargeted commands. Every tab (visible or
 * background) additionally pushes the light TAB_STATUS channel, so background
 * tabs report status flips and session title/id changes.
 *
 * F-OWN (double-attach guard): `#sessionOwners` maps a session file to the
 * tab/window attached to it, registered at acquire (spawn-with-sessionPath),
 * from the RPC passthrough (switch_session success / get_state — the only
 * main-observable carriers of the file path), and dropped on release or when
 * session_info_update reports a sessionId change (the cached file is stale;
 * the renderer's hydrate re-registers the current one).
 *
 * F-UI-ORIGIN (response routing): extension_ui / host_tool / host_uri
 * requests raised by a tab are recorded by request id → owning entry, so a
 * renderer response routes back to the sidecar that RAISED the request even
 * after the user switched to another tab (sidecarForWindow would misroute
 * it to the newly active sidecar, which never saw the request).
 */
import type { BrowserWindow } from "electron";
import {
	IPC_EVENTS,
	type IpcSessionOwner,
	type IpcTabGroup,
	type IpcTabInfo,
	type IpcTabRetry,
	type IpcTabStatusPayload,
	type IpcTabWorktree,
} from "../shared/ipc-types";
import {
	type AgentMessage,
	type AgentSessionEvent,
	type AvailableCommand,
	BLOCKING_UI_METHODS,
	type CommandOutputFrame,
	type ConfigUpdateFrame,
	type ExtensionErrorFrame,
	type ExtensionUIRequest,
	type HostToolCallRequest,
	type HostUriRequest,
	type ModelCatalogUpdateFrame,
	type PromptResultFrame,
	type RpcBtwFrame,
	type RpcCommand,
	type RpcDictationFrame,
	type RpcLiveFrame,
	type RpcResponse,
	type RpcTerminalFrame,
	type SessionInfoUpdateFrame,
	type SessionSettledFrame,
	type SidecarStatus,
	type SidecarStatusPayload,
	type SubagentFrame,
} from "../shared/rpc-types";
import type { WindowTabFact } from "./quit-guard";
import type { SidecarManager } from "./sidecar";
import { nextSnowflake } from "./snowflake";
import { type PersistedTabDescriptor, type PersistedTabLayout, TAB_LAYOUT_VERSION } from "./tab-layout";

export type SidecarFactory = (cwd: string, kind: "agent" | "chat", fresh: boolean) => SidecarManager;

function forwardToWindow(win: BrowserWindow, channel: string, data: unknown): void {
	if (!win.isDestroyed()) win.webContents.send(channel, data);
}

interface PoolEntry {
	sidecar: SidecarManager;
	tabId: string;
	win: BrowserWindow;
	/** win.webContents.id, cached at acquire — safe to read after the window is destroyed. */
	winId: number;
	/** Session kind: "agent" (default) or "chat" (tool-free). Immutable; set at acquire. */
	kind: "agent" | "chat";
	/** Untargeted startup tab; disposed when the user opens an explicit tab. */
	placeholder: boolean;
	/**
	 * Git-worktree binding (plan/20). Immutable, set at acquire from the spawn
	 * payload; surfaced via tabStatusPayload so the chip and close flow know
	 * this tab owns a ~/.omp/wt checkout.
	 */
	worktree?: IpcTabWorktree;
	/** Last status this tab's sidecar reported (TAB_STATUS / GET_TABS). */
	status: SidecarStatus;
	/** Agent run in flight (agent_start seen, no agent_end yet) — synthesized "running". */
	running: boolean;
	/** Prompt yielded while background work can still wake the session. */
	awaitingSessionSettled: boolean;
	/** Automatic transcript compaction state once observed — true blocks session mutation. */
	compacting?: boolean;
	manualCompaction?: "foreground" | "background" | null;
	/**
	 * Outcome a background tab's chip must show without full events: an
	 * auto-retry in flight, or a last run that ended in a provider error.
	 * Cleared when the next run starts.
	 */
	attention?: "retrying" | "failed";
	/** The error behind `attention: "failed"`, for the background-failure notice. */
	attentionDetail?: string;
	/** An outcome was sent at least once, so its clearing must be sent too. */
	attentionShown?: boolean;
	/** The auto-retry in flight, so a tab shown mid-saga renders its retry row. */
	retry?: IpcTabRetry;
	/** Session meta cached from session_info_update (TAB_STATUS / GET_TABS). */
	sessionId?: string;
	/**
	 * Session meta cached from session_info_update — or, for a tab restored from
	 * the layout that has not been spawned yet, seeded from the persisted title
	 * so its chip has something better than a folder name to show.
	 */
	title?: string | null;
	/**
	 * Session file this tab is attached to (F-OWN). Set at acquire when
	 * spawned with --session and maintained from the RPC passthrough via
	 * noteSessionFile; the reverse key of #sessionOwners.
	 */
	sessionFile?: string;
	/**
	 * Detaches the full-channel forwarders. Null while the tab is background
	 * (nothing wired); set exactly once per active stint so switches move
	 * listeners without duplicating them.
	 */
	detachFull: (() => void) | null;
}

function entryHasWork(entry: PoolEntry): boolean {
	return entry.running || entry.compacting === true || entry.manualCompaction != null;
}

/** An idle sidecar booted ahead of the next tab in `cwd` (gui#29). */
interface WarmSpare {
	cwd: string;
	sidecar: SidecarManager;
	/** Removes the pool's own spare-tracking listener. */
	detach: () => void;
}

export class SidecarPool {
	#entries = new Set<PoolEntry>();
	#byTabId = new Map<string, PoolEntry>();
	/** Window (webContents.id) → active tab. The first acquired tab defaults active. */
	#activeByWindow = new Map<number, string>();
	/** Window → the one or two tabs whose full event streams are rendered. */
	#visibleByWindow = new Map<number, Set<string>>();
	/** Window → its split pairs (gui#30): each pair is shown whenever either tab is. */
	#groupsByWindow = new Map<number, IpcTabGroup[]>();
	/** Session file → owning tab/window (F-OWN double-attach guard). */
	#sessionOwners = new Map<string, IpcSessionOwner>();
	/**
	 * Pending renderer-facing request id → entry that raised it (F-UI-ORIGIN).
	 * Registered when a tab forwards an extension_ui / host_tool / host_uri
	 * request to its window; a response routes back to that exact sidecar even
	 * after the window's active tab moved on. Entries drop on the (final)
	 * response or when the owning entry is released.
	 */
	#requestOwners = new Map<string, PoolEntry>();
	readonly #factory: SidecarFactory;
	/** Suppress partial snapshots while a saved layout is being reconstructed. */
	#restoringWindows = new Set<number>();
	/**
	 * Warm spare (gui#29). Opening a session used to cold-start an omp process
	 * for its tab — seconds on a fast Mac, tens of seconds on slow Windows
	 * hosts — while switching a running process onto a session takes well
	 * under a second. So once an agent tab is up, one idle process is booted in
	 * its workspace, and the next agent tab started there adopts it instead of
	 * spawning (`#ensureStarted`). Never a tab: it holds no slot in the tab
	 * maps, the layout, or the quit guard's inventory.
	 */
	#spare: WarmSpare | null = null;
	#spareTimer: NodeJS.Timeout | null = null;
	/**
	 * How long after an agent tab comes up its workspace's spare boots, so the
	 * spare does not compete with that tab's own startup and hydrate. Null (the
	 * default) disables spares; main sets it at startup.
	 */
	warmSpareDelayMs: number | null = null;
	/**
	 * Host-tool dispatch needs the main-process executor (ipc.ts), which the
	 * pool cannot import without a cycle. Set once at startup; the pool routes
	 * each sidecar's hostToolCall through it with the owning window. Returns
	 * true when the tool was answered inline (GUI-registered) — the pool only
	 * tracks request ids for renderer-forwarded calls (F-UI-ORIGIN).
	 */
	hostToolExecutor: ((sidecar: SidecarManager, request: HostToolCallRequest, win: BrowserWindow) => boolean) | null =
		null;
	/**
	 * Main-process answerer for UI requests no window should see (an approval
	 * prompt for a host tool that asks the user itself). True when answered.
	 */
	uiResponder: ((sidecar: SidecarManager, request: ExtensionUIRequest) => boolean) | null = null;
	/** Main-process persistence hook. The primary window installs this at startup. */
	onWindowTabsChanged: ((win: BrowserWindow, layout: PersistedTabLayout | null) => void) | null = null;
	/**
	 * Main-process services bound to a tab's sidecar process (the browser panel
	 * host): `ready` on every boot or restart, `down` whenever it stops serving,
	 * `released` once the tab is gone for good.
	 */
	sidecarLifecycle: {
		ready(tab: { tabId: string; kind: "agent" | "chat"; sidecar: SidecarManager; win: BrowserWindow }): void;
		down(tabId: string): void;
		released(tabId: string): void;
	} | null = null;

	constructor(factory: SidecarFactory) {
		this.#factory = factory;
	}

	get size(): number {
		return this.#entries.size;
	}

	/**
	 * Spawn + bind a sidecar for `cwd` to `win` as a tab. Returns null when the
	 * sidecar could not be created. There is no tab cap: restored and
	 * background tabs are deferred, so only tabs someone has shown hold a
	 * process. `tabId` defaults to a fresh snowflake (the window's initial sidecar
	 * is minted here too); `sessionPath` resumes that session on first start.
	 * `kind` defaults to "agent"; "chat" spawns a tool-free conversation.
	 * The first tab of a window becomes its active tab; later tabs start in
	 * the background (light TAB_STATUS wiring only). Removes the entry when
	 * the window closes.
	 *
	 * `deferStart` creates the tab WITHOUT spawning its process and without
	 * claiming the window's active slot: a sidecar holds ~200 MB of private
	 * memory, so a restored layout must not pay for tabs nobody has looked at.
	 * The spawn happens in `#wireFull`, i.e. the first time the tab is
	 * rendered — `#syncFullWiring` is the single point that knows a tab became
	 * visible.
	 */
	acquire(
		cwd: string,
		win: BrowserWindow,
		tabId: string = nextSnowflake(),
		sessionPath?: string,
		kind: "agent" | "chat" = "agent",
		worktree?: IpcTabWorktree,
		fresh = false,
		placeholder = false,
		deferStart = false,
		title?: string,
	): SidecarManager | null {
		try {
			const sidecar = this.#factory(cwd, kind, fresh);
			const entry: PoolEntry = {
				sidecar,
				tabId,
				win,
				winId: win.webContents.id,
				kind,
				placeholder,
				worktree,
				status: sidecar.status,
				running: false,
				awaitingSessionSettled: false,
				detachFull: null,
			};
			if (title) entry.title = title;
			this.#wireLight(entry);
			this.#entries.add(entry);
			this.#byTabId.set(tabId, entry);
			// F-OWN: a spawn-with-sessionPath attaches immediately — register the
			// owner before any duplicate attach can slip past the IPC guard. A
			// deferred tab registers too: it owns that file the moment it exists,
			// which is what makes "open this session elsewhere" refuse-or-focus.
			if (sessionPath) this.#registerSessionFile(entry, sessionPath);
			if (!deferStart && !this.#activeByWindow.has(entry.winId)) {
				this.#activeByWindow.set(entry.winId, entry.tabId);
				this.#visibleByWindow.set(entry.winId, new Set([entry.tabId]));
				this.#syncFullWiring(entry.winId);
			}

			win.once("closed", () => {
				this.#releaseEntry(entry);
			});

			if (!deferStart) this.#ensureStarted(entry);
			this.#notifyWindowTabsChanged(win);
			// Starting may have swapped in the warm spare.
			return entry.sidecar;
		} catch {
			return null;
		}
	}

	/**
	 * Spawn a tab's sidecar unless one is already under way or it has already
	 * run. A fresh sidecar with a session to resume goes through restart():
	 * kill() is a no-op on a not-yet-spawned manager, so this is a plain
	 * start() carrying --session. Safe to call on every visibility change —
	 * `status` leaves "asleep" synchronously inside start(), so a second call
	 * can never double-spawn.
	 *
	 * A warm spare for the tab's workspace replaces the never-spawned manager
	 * instead: only the light wiring was ever attached to it (full wiring
	 * attaches after this returns), so the swap re-wires that alone.
	 */
	#ensureStarted(entry: PoolEntry): void {
		if (entry.sidecar.status !== "asleep") return;
		const spare = this.#takeSpare(entry);
		if (spare) {
			const asleep = entry.sidecar;
			asleep.removeAllListeners();
			asleep.dispose();
			entry.sidecar = spare;
			this.#wireLight(entry);
			spare.adopt(entry.sessionFile);
			return;
		}
		const sessionPath = entry.sessionFile;
		if (sessionPath) entry.sidecar.restart(undefined, sessionPath);
		else entry.sidecar.start();
	}

	/** The spare `entry` can adopt, removed from the pool; null when there is none. */
	#takeSpare(entry: PoolEntry): SidecarManager | null {
		const spare = this.#spare;
		// Chat tabs run a different argv; a worktree tab's checkout is not the spare's.
		if (!spare || entry.kind !== "agent" || entry.worktree) return null;
		// A spare still booting is worth taking: the part of its boot already
		// done is time the tab does not wait again.
		const status = spare.sidecar.status;
		if (spare.cwd !== entry.sidecar.cwd || (status !== "starting" && status !== "ready")) return null;
		this.#spare = null;
		spare.detach();
		return spare.sidecar;
	}

	/** Boot a spare for `cwd` after `warmSpareDelayMs`, unless one is already warm there. */
	#scheduleSpare(cwd: string): void {
		const delay = this.warmSpareDelayMs;
		if (delay === null || this.#spare?.cwd === cwd) return;
		if (this.#spareTimer) clearTimeout(this.#spareTimer);
		this.#spareTimer = setTimeout(() => {
			this.#spareTimer = null;
			this.#bootSpare(cwd);
		}, delay);
	}

	#bootSpare(cwd: string): void {
		this.#dropSpare();
		let sidecar: SidecarManager;
		try {
			sidecar = this.#factory(cwd, "agent", true);
		} catch {
			return;
		}
		// Booting or idle are the only useful states. A spare that crashed or
		// failed its health check is dropped, never crash-looped in the background.
		const onStatus = ({ status }: SidecarStatusPayload): void => {
			if (status !== "starting" && status !== "ready" && this.#spare?.sidecar === sidecar) this.#dropSpare();
		};
		sidecar.on("status", onStatus);
		this.#spare = { cwd, sidecar, detach: () => sidecar.off("status", onStatus) };
		sidecar.prewarm();
	}

	/** Cancel a pending spare boot and drop the spare. */
	#discardSpare(): void {
		if (this.#spareTimer) clearTimeout(this.#spareTimer);
		this.#spareTimer = null;
		this.#dropSpare();
	}

	#dropSpare(): void {
		const spare = this.#spare;
		if (!spare) return;
		this.#spare = null;
		spare.sidecar.removeAllListeners();
		spare.sidecar.dispose();
	}

	/**
	 * Replace the spare with one booted under current settings. A spare booted
	 * before a settings, proxy, or launch-profile change would hand the next tab
	 * the old ones (a stale default model, above all), which a cold start never
	 * does.
	 */
	refreshSpare(): void {
		const cwd = this.#spare?.cwd;
		this.#dropSpare();
		if (cwd) this.#scheduleSpare(cwd);
	}

	/** Per-tab light wiring, attached for the entry's whole life: TAB_STATUS pushes. */
	#wireLight(entry: PoolEntry): void {
		const { sidecar, win } = entry;
		sidecar.on("status", (payload: SidecarStatusPayload) => {
			const wasReady = entry.status === "ready";
			entry.status = payload.status;
			if (payload.status === "ready") {
				this.sidecarLifecycle?.ready({ tabId: entry.tabId, kind: entry.kind, sidecar, win });
				if (entry.kind === "agent" && !entry.worktree) this.#scheduleSpare(sidecar.cwd);
			} else if (wasReady) {
				this.sidecarLifecycle?.down(entry.tabId);
			}
			// A restart/exit kills any in-flight run along with the process.
			if (payload.status !== "ready") {
				entry.running = false;
				entry.awaitingSessionSettled = false;
				entry.compacting = undefined;
				if (entry.manualCompaction !== undefined) entry.manualCompaction = null;
				entry.retry = undefined;
				if (entry.attention === "retrying") entry.attention = undefined;
				// Pending request-id routes belong to the dead process — the
				// renderer cleared its dialog queue too, so a late response has
				// no owner left. Drop them rather than write a stray
				// extension_ui_response into the fresh process's stdin.
				for (const [id, owner] of this.#requestOwners) {
					if (owner === entry) this.#requestOwners.delete(id);
				}
			}
			forwardToWindow(win, IPC_EVENTS.TAB_STATUS, tabStatusPayload(entry));
		});
		// Terminal output must reach the renderer for background tabs too: a
		// panel shown later continues from the frames, not a gap.
		sidecar.on("terminalFrame", (frame: RpcTerminalFrame) => {
			forwardToWindow(win, IPC_EVENTS.TERMINAL_FRAME, { tabId: entry.tabId, frame });
		});
		// Settings are read at boot; the spare must not keep the ones a tab just changed.
		sidecar.on("configUpdate", () => {
			this.refreshSpare();
		});
		sidecar.on("sessionInfoUpdate", (frame: SessionInfoUpdateFrame) => {
			if (frame.title !== undefined) entry.title = frame.title;
			if (typeof frame.sessionId === "string") {
				const previousId = entry.sessionId;
				entry.sessionId = frame.sessionId;
				// F-OWN: the session under this tab changed (switch / new session
				// / crash-restart) — the cached file→owner mapping is stale. The
				// first attach (previousId undefined) keeps the acquire-time
				// registration; the renderer's hydrate (get_state) re-registers
				// the current file after a real change.
				if (previousId !== undefined && previousId !== frame.sessionId) this.#unregisterSessionFile(entry);
			}
			// Session meta changes ride the light channel too, so a background
			// tab's title/id updates without waiting for a status flip.
			forwardToWindow(win, IPC_EVENTS.TAB_STATUS, tabStatusPayload(entry));
		});
		const setRunning = (running: boolean): void => {
			const wasBusy = entryHasWork(entry);
			entry.running = running;
			const busy = entryHasWork(entry);
			if (busy !== wasBusy) forwardToWindow(win, IPC_EVENTS.TAB_STATUS, tabStatusPayload(entry));
		};
		sidecar.on("promptResult", (frame: PromptResultFrame) => {
			if (typeof frame.sessionSettled !== "boolean") return;
			entry.awaitingSessionSettled = !frame.sessionSettled;
			setRunning(!frame.sessionSettled);
		});
		sidecar.on("sessionSettled", (_frame: SessionSettledFrame) => {
			entry.awaitingSessionSettled = false;
			setRunning(false);
		});
		// Agent-end means one run yielded; upstream prompt/session-settled frames
		// keep background async work represented as running until it is quiet.
		sidecar.on("events", (events: AgentSessionEvent[]) => {
			const wasBusy = entryHasWork(entry);
			const wasPlaceholder = entry.placeholder;
			const wasAttention = entry.attention;
			const wasRetry = entry.retry;
			const wasManualCompaction = entry.manualCompaction;
			// plan_proposal blocks the agent on a host decision — it must reach
			// the renderer even while this tab's full stream is parked, or the
			// dialog can never appear and the turn waits forever. Visible tabs
			// already get it inside their normal events batch.
			const parkedProposals: AgentSessionEvent[] = [];
			for (const event of events) {
				if (event.type === "agent_start") {
					entry.running = true;
					entry.placeholder = false;
					// An auto-retry re-enters through agent_start; only a run outside a
					// retry saga starts with a clean slate. The saga ends on auto_retry_end
					// (the "retrying" mark), but its wait is over: the retry row hands over
					// to the live run, as the TUI's loader does.
					if (entry.attention !== "retrying") {
						entry.attention = undefined;
						entry.attentionDetail = undefined;
					}
					entry.retry = undefined;
				} else if (event.type === "agent_end") {
					if (!entry.awaitingSessionSettled) entry.running = false;
					if (event.isTerminal !== false && entry.attention !== "retrying") settleAttention(entry, event.messages);
				} else if (event.type === "auto_retry_start") {
					entry.attention = "retrying";
					entry.retry = {
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
						delayMs: event.delayMs,
						errorMessage: event.errorMessage,
						startedAt: Date.now(),
					};
				} else if (event.type === "auto_retry_end") {
					entry.attention = event.success ? undefined : "failed";
					entry.attentionDetail = event.success ? undefined : event.finalError;
					entry.retry = undefined;
				} else if (event.type === "auto_compaction_start") entry.compacting = true;
				else if (event.type === "auto_compaction_end") entry.compacting = false;
				else if (event.type === "manual_compaction_start") {
					entry.manualCompaction = event.mode === "handoff" ? "background" : "foreground";
				} else if (event.type === "manual_compaction_end") {
					entry.manualCompaction = null;
					entry.compacting ??= false;
				}
				if (event.type === "plan_proposal" && !entry.detachFull) parkedProposals.push(event);
			}
			if (parkedProposals.length > 0) {
				forwardToWindow(win, IPC_EVENTS.EVENTS_BATCH, { tabId: entry.tabId, payload: parkedProposals });
			}
			const busy = entryHasWork(entry);
			if (
				busy !== wasBusy ||
				entry.placeholder !== wasPlaceholder ||
				entry.attention !== wasAttention ||
				entry.retry !== wasRetry ||
				entry.manualCompaction !== wasManualCompaction
			) {
				forwardToWindow(win, IPC_EVENTS.TAB_STATUS, tabStatusPayload(entry));
			}
			if (entry.placeholder !== wasPlaceholder) this.#notifyWindowTabsChanged(win);
		});
		// Request/response channels live on the light wiring: a sidecar parked
		// in a background tab still emits these, and an emitted request with no
		// listener is DROPPED — the agent would block on a reply to a dialog
		// the renderer never saw. The renderer queues by owning tabId, so the
		// request resurfaces with the tab (or in the global dialog surface).
		sidecar.on("extensionUi", (request: ExtensionUIRequest) => {
			if (this.uiResponder?.(sidecar, request)) return;
			// Only response-bearing requests need an origin route. Fire-and-forget
			// UI updates never reply, so retaining them here leaks the owning tab.
			if (BLOCKING_UI_METHODS[request.method]) this.#requestOwners.set(request.id, entry);
			forwardToWindow(win, IPC_EVENTS.EXTENSION_UI, { tabId: entry.tabId, request });
		});
		sidecar.on("hostToolCall", (request: HostToolCallRequest) => {
			// Answered-inline tools never reach the renderer, so only forwarded
			// calls need id → origin tracking for the result/update route.
			const answeredInline = this.hostToolExecutor ? this.hostToolExecutor(sidecar, request, win) : true;
			if (!answeredInline) this.#requestOwners.set(request.id, entry);
		});
		sidecar.on("hostUriRequest", (request: HostUriRequest) => {
			this.#requestOwners.set(request.id, entry);
			forwardToWindow(win, IPC_EVENTS.HOST_URI_REQUEST, { request });
		});
	}

	/**
	 * Full-channel wiring, attached only while the tab is visible in its window
	 * tab. Idempotent: an already-wired entry is left untouched, so a repeated
	 * setActiveTab cannot stack duplicate listeners.
	 *
	 * Being wired IS being shown, so this is where a deferred tab's process
	 * gets spawned — the one moment the pool knows the user can see it.
	 */
	#wireFull(entry: PoolEntry): void {
		if (entry.detachFull) return;
		this.#ensureStarted(entry);
		const { sidecar, win } = entry;
		const removers: (() => void)[] = [];
		const forwardActive = <T>(channel: string, payload: T): void => {
			forwardToWindow(win, channel, { tabId: entry.tabId, payload });
		};
		const wire = <T>(event: string, listener: (payload: T) => void): void => {
			sidecar.on(event, listener);
			removers.push(() => {
				sidecar.off(event, listener);
			});
		};
		wire("events", (events: AgentSessionEvent[]) => {
			forwardActive(IPC_EVENTS.EVENTS_BATCH, events);
		});
		wire("status", (payload: SidecarStatusPayload) => {
			forwardActive(IPC_EVENTS.SIDECAR_STATUS, { ...payload, cwd: sidecar.cwd });
		});
		wire("subagentFrame", (frame: SubagentFrame) => {
			forwardActive(IPC_EVENTS.SUBAGENT_FRAME, frame);
		});
		wire("liveFrame", (frame: RpcLiveFrame) => {
			forwardActive(IPC_EVENTS.LIVE_FRAME, frame);
		});
		wire("dictationFrame", (frame: RpcDictationFrame) => {
			forwardActive(IPC_EVENTS.DICTATION_FRAME, frame);
		});
		wire("btwFrame", (frame: RpcBtwFrame) => {
			forwardActive(IPC_EVENTS.BTW_FRAME, frame);
		});
		wire("modelCatalogUpdate", (frame: ModelCatalogUpdateFrame) => {
			forwardActive(IPC_EVENTS.MODEL_CATALOG_UPDATE, frame);
		});
		wire("commandsUpdate", (commands: AvailableCommand[]) => {
			forwardActive(IPC_EVENTS.COMMANDS_UPDATE, commands);
		});
		wire("configUpdate", (payload: ConfigUpdateFrame) => {
			forwardActive(IPC_EVENTS.CONFIG_UPDATE, payload);
		});
		wire("promptResult", (frame: PromptResultFrame) => {
			forwardActive(IPC_EVENTS.PROMPT_RESULT, frame);
		});
		wire("commandOutput", (frame: CommandOutputFrame) => {
			forwardActive(IPC_EVENTS.COMMAND_OUTPUT, frame);
		});
		wire("sessionInfoUpdate", (frame: SessionInfoUpdateFrame) => {
			forwardActive(IPC_EVENTS.SESSION_INFO_UPDATE, frame);
		});
		wire("extensionError", (frame: ExtensionErrorFrame) => {
			forwardActive(IPC_EVENTS.EXTENSION_ERROR, frame);
		});
		entry.detachFull = () => {
			entry.detachFull = null;
			for (const remove of removers) remove();
		};
	}

	#syncFullWiring(winId: number): void {
		const visible = this.#visibleByWindow.get(winId) ?? new Set<string>();
		for (const entry of this.#entries) {
			if (entry.winId !== winId) continue;
			if (visible.has(entry.tabId)) this.#wireFull(entry);
			else entry.detachFull?.();
		}
	}

	/**
	 * Release a tab: listeners first, then dispose (a stale forwarder surviving
	 * into a sidecar.restart() would push events at a destroyed window). When
	 * the active tab goes away, the oldest surviving tab of the window takes
	 * over (the renderer may override with SET_ACTIVE_TAB); releasing the last
	 * tab leaves the window tab-less, back to its initial no-sidecar state.
	 */
	#releaseEntry(entry: PoolEntry): void {
		if (!this.#entries.delete(entry)) return;
		this.#byTabId.delete(entry.tabId);
		this.#unregisterSessionFile(entry);
		// Drop pending request-id routes pointing at the released entry — a
		// late renderer response must fall back, never write to a dead sidecar.
		for (const [id, owner] of this.#requestOwners) {
			if (owner === entry) this.#requestOwners.delete(id);
		}
		entry.sidecar.removeAllListeners();
		entry.sidecar.dispose();
		this.sidecarLifecycle?.released(entry.tabId);
		const visible = this.#visibleByWindow.get(entry.winId);
		visible?.delete(entry.tabId);
		// A closed tab dissolves its pair; the partner stays as a single tab.
		const groups = this.#groupsByWindow.get(entry.winId)?.filter(group => !groupHas(group, entry.tabId)) ?? [];
		if (groups.length > 0) this.#groupsByWindow.set(entry.winId, groups);
		else this.#groupsByWindow.delete(entry.winId);
		// No tab left anywhere (a macOS app idling in the dock): nothing to be warm for.
		if (this.#entries.size === 0) this.#discardSpare();
		if (![...this.#entries].some(candidate => candidate.winId === entry.winId)) {
			this.#activeByWindow.delete(entry.winId);
			this.#visibleByWindow.delete(entry.winId);
			this.#groupsByWindow.delete(entry.winId);
			return;
		}
		if (this.#activeByWindow.get(entry.winId) !== entry.tabId) {
			this.#syncFullWiring(entry.winId);
			return;
		}
		this.#activeByWindow.delete(entry.winId);
		// During window teardown every entry self-releases; activating a sibling
		// whose window is already gone would wire forwarders for nothing.
		if (entry.win.isDestroyed()) return;
		const candidates = [...this.#entries].filter(candidate => candidate.winId === entry.winId);
		const candidate = candidates.find(item => visible?.has(item.tabId)) ?? candidates[0];
		if (!candidate) {
			this.#visibleByWindow.delete(entry.winId);
			return;
		}
		if (!visible || visible.size === 0) this.#visibleByWindow.set(entry.winId, new Set([candidate.tabId]));
		this.#activeByWindow.set(entry.winId, candidate.tabId);
		this.#syncFullWiring(entry.winId);
	}

	/** The window's active entry (first entry as a fallback, e.g. mid-teardown). */
	entryForWindow(win: BrowserWindow): PoolEntry | undefined {
		const active = this.#byTabId.get(this.#activeByWindow.get(win.webContents.id) ?? "");
		if (active && active.win === win) return active;
		for (const entry of this.#entries) {
			if (entry.win === win) return entry;
		}
		return undefined;
	}

	/** Resolves via the ACTIVE tab, so every existing ipc.ts handler keeps working unchanged. */
	sidecarForWindow(win: BrowserWindow): SidecarManager | null {
		return this.entryForWindow(win)?.sidecar ?? null;
	}

	/** The sidecar of one specific tab, scoped to the window that owns it. */
	sidecarForTab(win: BrowserWindow, tabId: string): SidecarManager | null {
		const entry = this.#byTabId.get(tabId);
		return entry && entry.win === win ? entry.sidecar : null;
	}

	/** Send a command to the idle tab attached to `sessionPath`. */
	async commandForIdleSession(sessionPath: string, command: RpcCommand): Promise<RpcResponse | null> {
		const owner = this.#sessionOwners.get(sessionPath);
		const entry = owner ? this.#byTabId.get(owner.tabId) : undefined;
		if (!entry || entryHasWork(entry) || entry.status !== "ready") return null;
		const client = entry.sidecar.rpcClient;
		return client ? await client.command(command) : null;
	}

	/** Make `tabId` the window's active tab (moves full event forwarding). False when unknown/foreign. */
	setActiveTab(win: BrowserWindow, tabId: string): boolean {
		return this.setTabView(win, tabId, [tabId]);
	}

	/**
	 * Atomically focus one tab and wire full streams for one or two visible
	 * tabs. Two visible tabs must be one of the window's split pairs; `groups`
	 * replaces those pairs, and leaving it out keeps them.
	 */
	setTabView(
		win: BrowserWindow,
		focusedTabId: string,
		visibleTabIds: readonly string[],
		groups?: readonly IpcTabGroup[],
	): boolean {
		const ids = [...new Set(visibleTabIds)];
		if (ids.length < 1 || ids.length > 2 || !ids.includes(focusedTabId)) return false;
		for (const tabId of ids) {
			const entry = this.#byTabId.get(tabId);
			if (!entry || entry.win !== win) return false;
		}
		const winId = win.webContents.id;
		const nextGroups = groups ? this.#ownGroups(win, groups) : (this.#groupsByWindow.get(winId) ?? []);
		if (ids.length === 2 && !nextGroups.some(group => ids.every(tabId => groupHas(group, tabId)))) return false;
		this.#activeByWindow.set(winId, focusedTabId);
		this.#visibleByWindow.set(winId, new Set(ids));
		if (nextGroups.length > 0) this.#groupsByWindow.set(winId, nextGroups);
		else this.#groupsByWindow.delete(winId);
		this.#syncFullWiring(winId);
		this.#notifyWindowTabsChanged(win);
		return true;
	}

	/** The valid pairs of `groups`: two distinct tabs of `win`, each in one pair at most. */
	#ownGroups(win: BrowserWindow, groups: readonly IpcTabGroup[]): IpcTabGroup[] {
		const paired = new Set<string>();
		const valid: IpcTabGroup[] = [];
		for (const group of groups) {
			if (!group) continue;
			const { axis, firstTabId, secondTabId, ratio } = group;
			if (
				(axis !== "columns" && axis !== "rows") ||
				typeof ratio !== "number" ||
				!Number.isFinite(ratio) ||
				firstTabId === secondTabId ||
				paired.has(firstTabId) ||
				paired.has(secondTabId) ||
				this.#byTabId.get(firstTabId)?.win !== win ||
				this.#byTabId.get(secondTabId)?.win !== win
			)
				continue;
			paired.add(firstTabId);
			paired.add(secondTabId);
			valid.push({ axis, firstTabId, secondTabId, ratio: Math.min(0.8, Math.max(0.2, ratio)) });
		}
		return valid;
	}

	/**
	 * Put the window's tabs in the strip's order, so GET_TABS and the saved
	 * layout follow a drag. Tabs the list leaves out keep their order after it.
	 */
	setTabOrder(win: BrowserWindow, tabIds: readonly string[]): boolean {
		const own = [...this.#entries].filter(entry => entry.win === win);
		if (own.length === 0) return false;
		const rank = new Map(tabIds.map((tabId, index) => [tabId, index]));
		const ordered = own.toSorted(
			(a, b) => (rank.get(a.tabId) ?? tabIds.length) - (rank.get(b.tabId) ?? tabIds.length),
		);
		if (ordered.every((entry, index) => entry === own[index])) return true;
		for (const entry of own) this.#entries.delete(entry);
		for (const entry of ordered) this.#entries.add(entry);
		this.#notifyWindowTabsChanged(win);
		return true;
	}

	/** Release one tab's sidecar. False when the tab is unknown. */
	releaseTab(tabId: string): boolean {
		const entry = this.#byTabId.get(tabId);
		if (!entry) return false;
		this.#releaseEntry(entry);
		this.#notifyWindowTabsChanged(entry.win);
		return true;
	}

	/**
	 * The tab/window currently attached to `sessionPath`, null when free
	 * (F-OWN). SPAWN_TAB and SESSION_OPEN_NEW_WINDOW consult this before
	 * spawning a second sidecar for the same file.
	 */
	sessionOwner(sessionPath: string): IpcSessionOwner | null {
		return this.#sessionOwners.get(sessionPath) ?? null;
	}

	/**
	 * Whether the owner tab of `sessionPath` has a process holding that session
	 * in memory. `asleep` (restored but never shown), `exited` and `error` have
	 * no process at all, so the file on disk is the entire session: a delete or
	 * rename must go to the filesystem instead of a `drop_session` /
	 * `set_session_name` with nobody to answer it — which `commandForIdleSession`
	 * would refuse as if a run were in flight. `starting` counts as live: that
	 * spawn is about to read the file.
	 */
	sessionOwnerIsLive(sessionPath: string): boolean {
		const owner = this.#sessionOwners.get(sessionPath);
		const entry = owner ? this.#byTabId.get(owner.tabId) : undefined;
		if (!entry) return false;
		return entry.status !== "asleep" && entry.status !== "exited" && entry.status !== "error";
	}

	/**
	 * The owner BLOCKING `tabId`'s attach to `sessionPath` — the file's current
	 * owner when it is a different tab, else null (unowned, or owned by the
	 * issuer itself, which re-attaches freely). An untracked issuer (null
	 * tabId) is blocked by any owner: refusing is the safe direction there.
	 * F-OWN's refuse-or-focus decision point for the switch_session passthrough.
	 */
	foreignSessionOwner(tabId: string | null, sessionPath: string): IpcSessionOwner | null {
		const owner = this.#sessionOwners.get(sessionPath);
		if (!owner || owner.tabId === tabId) return null;
		return owner;
	}

	/** The tab a sidecar serves: its id, kind and current session file. */
	tabForSidecar(
		sidecar: SidecarManager,
	): { tabId: string; kind: "agent" | "chat"; sessionFile: string | null } | null {
		for (const entry of this.#byTabId.values()) {
			if (entry.sidecar === sidecar)
				return { tabId: entry.tabId, kind: entry.kind, sessionFile: entry.sessionFile ?? null };
		}
		return null;
	}

	/**
	 * Record the session file a tab's sidecar is attached to. ipc.ts reports
	 * this from the RPC passthrough (switch_session success, get_state — the
	 * only main-observable carriers of the file path; session_info_update
	 * itself carries just the id). Null unregisters (fresh unsaved session).
	 */
	noteSessionFile(tabId: string, sessionFile: string | null): void {
		const entry = this.#byTabId.get(tabId);
		if (!entry) return;
		const previous = entry.sessionFile;
		if (sessionFile) this.#registerSessionFile(entry, sessionFile);
		else this.#unregisterSessionFile(entry);
		if (entry.sessionFile !== previous) {
			forwardToWindow(entry.win, IPC_EVENTS.TAB_STATUS, tabStatusPayload(entry));
			this.#notifyWindowTabsChanged(entry.win);
		}
	}

	/**
	 * Re-root a tab to its live session's cwd. `switch_session` re-roots the
	 * agent with no main-observable event, so the chip and every `sidecar.cwd`
	 * consumer stay frozen at the spawn cwd until this is called — the RPC
	 * passthrough reports the post-switch cwd (get_state) here. Pushes
	 * TAB_STATUS when the cwd changed so the renderer's chip tracks the move.
	 * Returns true when the cwd changed (ipc.ts gates the window-record sync).
	 */
	adoptSessionCwd(tabId: string, cwd: string): boolean {
		const entry = this.#byTabId.get(tabId);
		if (!entry || !cwd) return false;
		if (!entry.sidecar.adoptCwd(cwd)) return false;
		forwardToWindow(entry.win, IPC_EVENTS.TAB_STATUS, tabStatusPayload(entry));
		this.#notifyWindowTabsChanged(entry.win);
		return true;
	}

	/**
	 * Route a renderer side-channel response to the sidecar that RAISED the
	 * request (F-UI-ORIGIN), tracked by request id at forward time — not the
	 * window's active tab, which may have changed while the dialog was open.
	 * `final` unregisters the id (extension_ui/host_tool/host_uri RESULTS are
	 * single-shot; a host_tool UPDATE is not, the result follows). False when
	 * the id is unknown — the caller falls back to the active tab's sidecar.
	 */
	routeSideChannel(id: string, frame: object, final: boolean): boolean {
		const entry = this.#requestOwners.get(id);
		if (!entry) return false;
		if (final) this.#requestOwners.delete(id);
		entry.sidecar.sendSideChannel(frame);
		return true;
	}

	/** Register sessionFile → owner, moving the entry off any previous file. */
	#registerSessionFile(entry: PoolEntry, sessionFile: string): void {
		if (entry.sessionFile !== sessionFile) this.#unregisterSessionFile(entry);
		entry.sessionFile = sessionFile;
		this.#sessionOwners.set(sessionFile, { tabId: entry.tabId, winId: entry.winId });
	}

	/** Drop the entry's file→owner mapping when it still points at this entry. */
	#unregisterSessionFile(entry: PoolEntry): void {
		if (entry.sessionFile === undefined) return;
		// Another tab may have re-registered the same file since — only the
		// current owner may clear the mapping.
		if (this.#sessionOwners.get(entry.sessionFile)?.tabId === entry.tabId) {
			this.#sessionOwners.delete(entry.sessionFile);
		}
		entry.sessionFile = undefined;
	}

	/** The window's active tab id (null when the window has no tabs). */
	activeTabForWindow(win: BrowserWindow): string | null {
		return this.#activeByWindow.get(win.webContents.id) ?? null;
	}

	/** The window's tabs in acquisition order (GET_TABS boot reconciliation). */
	tabsForWindow(win: BrowserWindow): IpcTabInfo[] {
		const tabs: IpcTabInfo[] = [];
		const activeTabId = this.#activeByWindow.get(win.webContents.id);
		const visibleTabIds = this.#visibleByWindow.get(win.webContents.id);
		const groups = this.#groupsByWindow.get(win.webContents.id) ?? [];
		for (const entry of this.#entries) {
			if (entry.win !== win) continue;
			const tab = tabStatusPayload(entry);
			if (entry.tabId === activeTabId) tab.active = true;
			if (visibleTabIds?.has(entry.tabId)) tab.visible = true;
			const group = groups.find(candidate => groupHas(candidate, entry.tabId));
			if (group) {
				const first = group.firstTabId === entry.tabId;
				tab.group = {
					axis: group.axis,
					index: first ? 0 : 1,
					ratio: group.ratio,
					partnerTabId: first ? group.secondTabId : group.firstTabId,
				};
			}
			tabs.push(tab);
		}
		return tabs;
	}

	/** What every live tab is doing right now — the ⌘Q guard's inventory. */
	tabInventory(): WindowTabFact[] {
		return [...this.#entries].map(entry => ({
			windowId: entry.winId,
			tabId: entry.tabId,
			inFlight: entryHasWork(entry),
		}));
	}

	/** Serializable layout for the window, excluding transient run/status data. */
	tabLayoutForWindow(win: BrowserWindow): PersistedTabLayout | null {
		const entries = [...this.#entries].filter(entry => entry.win === win);
		if (entries.length === 0) return null;
		const activeTabId = this.#activeByWindow.get(win.webContents.id);
		const activeIndex = Math.max(
			0,
			entries.findIndex(entry => entry.tabId === activeTabId),
		);
		const groups = (this.#groupsByWindow.get(win.webContents.id) ?? []).flatMap(group => {
			const firstIndex = entries.findIndex(entry => entry.tabId === group.firstTabId);
			const secondIndex = entries.findIndex(entry => entry.tabId === group.secondTabId);
			return firstIndex >= 0 && secondIndex >= 0
				? [{ axis: group.axis, firstIndex, secondIndex, ratio: group.ratio }]
				: [];
		});
		return {
			version: TAB_LAYOUT_VERSION,
			activeIndex,
			tabs: entries.map(entry => {
				const descriptor: PersistedTabDescriptor = { cwd: entry.sidecar.cwd, kind: entry.kind };
				if (entry.sessionFile) descriptor.sessionPath = entry.sessionFile;
				if (entry.worktree) descriptor.worktree = entry.worktree;
				if (entry.placeholder) descriptor.placeholder = true;
				// Written even when the live title is null, so a cleared title
				// cannot survive as a stale one until the tab is spawned again.
				if (entry.title !== undefined) descriptor.title = entry.title ?? undefined;
				return descriptor;
			}),
			...(groups.length > 0 ? { groups } : {}),
		};
	}

	/**
	 * Recreate saved tabs with fresh runtime ids, then restore their active
	 * index. Every tab is acquired with `deferStart`: only the panes the view
	 * ends up showing get a process, so a restored ten-tab session costs one
	 * sidecar instead of ten.
	 */
	restoreLayout(win: BrowserWindow, layout: PersistedTabLayout): number {
		const winId = win.webContents.id;
		this.#restoringWindows.add(winId);
		let restoredCount = 0;
		let firstRestoredTabId: string | undefined;
		let activeRestoredTabId: string | undefined;
		const restoredTabIds: string[] = [];
		try {
			for (const [index, tab] of layout.tabs.entries()) {
				const tabId = nextSnowflake();
				const sidecar = this.acquire(
					tab.cwd,
					win,
					tabId,
					tab.sessionPath,
					tab.kind,
					tab.worktree,
					!tab.sessionPath,
					tab.placeholder === true,
					true,
					tab.title,
				);
				if (!sidecar) continue;
				restoredCount++;
				restoredTabIds[index] = tabId;
				firstRestoredTabId ??= tabId;
				if (index === layout.activeIndex) activeRestoredTabId = tabId;
			}
			const activeTabId = activeRestoredTabId ?? firstRestoredTabId;
			if (activeTabId) {
				// A pair loses its place when either tab failed to come back.
				const groups = (layout.groups ?? []).flatMap(group => {
					const firstTabId = restoredTabIds[group.firstIndex];
					const secondTabId = restoredTabIds[group.secondIndex];
					return firstTabId && secondTabId
						? [{ axis: group.axis, firstTabId, secondTabId, ratio: group.ratio }]
						: [];
				});
				// Routing the view is what spawns the shown tabs: the active tab,
				// with its partner when it is one of a pair.
				const shown = groups.find(group => groupHas(group, activeTabId));
				this.setTabView(win, activeTabId, shown ? [shown.firstTabId, shown.secondTabId] : [activeTabId], groups);
			}
		} finally {
			this.#restoringWindows.delete(winId);
		}
		this.#notifyWindowTabsChanged(win);
		return restoredCount;
	}

	#notifyWindowTabsChanged(win: BrowserWindow): void {
		if (!this.onWindowTabsChanged || this.#restoringWindows.has(win.webContents.id)) return;
		this.onWindowTabsChanged(win, this.tabLayoutForWindow(win));
	}

	disposeAll(): void {
		this.#discardSpare();
		for (const entry of this.#entries) {
			entry.sidecar.removeAllListeners();
			entry.sidecar.dispose();
			this.sidecarLifecycle?.released(entry.tabId);
		}
		this.#entries.clear();
		this.#byTabId.clear();
		this.#activeByWindow.clear();
		this.#visibleByWindow.clear();
		this.#groupsByWindow.clear();
		this.#sessionOwners.clear();
		this.#requestOwners.clear();
		this.#restoringWindows.clear();
	}
}

function groupHas(group: IpcTabGroup, tabId: string): boolean {
	return group.firstTabId === tabId || group.secondTabId === tabId;
}

/** A terminal agent_end decides the run's outcome from its final assistant reply. */
function settleAttention(entry: PoolEntry, messages: AgentMessage[] | undefined): void {
	const last = messages?.findLast(message => message.role === "assistant");
	if (last?.stopReason === "error") {
		entry.attention = "failed";
		entry.attentionDetail = typeof last.errorMessage === "string" ? last.errorMessage : entry.attentionDetail;
	} else if (entry.attention === "retrying" || last) {
		// A settled run that did not fail: any retry saga ended in its favor.
		entry.attention = undefined;
		entry.attentionDetail = undefined;
	}
}

/** TAB_STATUS push / GET_TABS item: full tab snapshot incl. cached session meta. */
function tabStatusPayload(entry: PoolEntry): IpcTabStatusPayload {
	const payload: IpcTabStatusPayload = {
		tabId: entry.tabId,
		cwd: entry.sidecar.cwd,
		kind: entry.kind,
		placeholder: entry.placeholder,
		sessionPath: entry.sessionFile ?? null,
		// "running" only makes sense on a live connection — a restarting sidecar
		// reports its connection state even with a dead in-flight run.
		status: entry.running && entry.status === "ready" ? "running" : entry.status,
	};
	if (entry.manualCompaction !== undefined) payload.backgroundCompacting = entry.manualCompaction === "background";
	if (entry.compacting !== undefined || entry.manualCompaction !== undefined) {
		payload.compacting = entry.compacting === true || entry.manualCompaction === "foreground";
	}
	if (entry.sessionId !== undefined) payload.sessionId = entry.sessionId;
	if (entry.title !== undefined) payload.title = entry.title;
	if (entry.worktree !== undefined) payload.worktree = entry.worktree;
	// Once a tab has had an outcome to show, keep sending it (null = cleared)
	// so the chip drops a stale retry/failure mark.
	if (entry.attention !== undefined || entry.attentionDetail !== undefined || entry.attentionShown) {
		entry.attentionShown = true;
		payload.attention = entry.attention ?? null;
		payload.retry = entry.retry ?? null;
	}
	if (entry.attentionDetail !== undefined) payload.attentionDetail = entry.attentionDetail;
	return payload;
}
