/**
 * Pool of per-tab sidecar processes, bounded at a hard cap.
 *
 * Each TAB owns one SidecarManager; a window holds N tabs. The pool enforces
 * the concurrency cap atomically (a slot is reserved synchronously before the
 * async spawn, so N concurrent acquires cannot overshoot — and the cap now
 * counts tabs across all windows), wires each sidecar's events to its owning
 * window, and releases the sidecar (listeners first, then dispose) when its
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
	type IpcSetTabViewPayload,
	type IpcTabInfo,
	type IpcTabStatusPayload,
	type IpcTabWorktree,
} from "../shared/ipc-types";
import {
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
	type RpcCommand,
	type RpcLiveUpdateFrame,
	type RpcResponse,
	type SessionInfoUpdateFrame,
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
	/** Automatic transcript compaction state once observed — true blocks session mutation. */
	compacting?: boolean;
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

type WindowSplitView = NonNullable<IpcSetTabViewPayload["split"]>;

export class SidecarPool {
	#entries = new Set<PoolEntry>();
	#byTabId = new Map<string, PoolEntry>();
	/** Window (webContents.id) → active tab. The first acquired tab defaults active. */
	#activeByWindow = new Map<number, string>();
	/** Window → the one or two tabs whose full event streams are rendered. */
	#visibleByWindow = new Map<number, Set<string>>();
	/** Window → persisted order, axis, and ratio for its optional two-pane view. */
	#splitByWindow = new Map<number, WindowSplitView>();
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
	/**
	 * Synchronously-reserved spawn slots. An acquire claims one before the
	 * (synchronous-but-fragile) SidecarManager.start(), and releases it if the
	 * start throws. This is what makes the cap atomic: a concurrent acquire
	 * sees the reservation and is refused even before the child exists.
	 */
	#reserved = 0;
	readonly #max: number;
	readonly #factory: SidecarFactory;
	/** Suppress partial snapshots while a saved layout is being reconstructed. */
	#restoringWindows = new Set<number>();
	/**
	 * Host-tool dispatch needs the main-process executor (ipc.ts), which the
	 * pool cannot import without a cycle. Set once at startup; the pool routes
	 * each sidecar's hostToolCall through it with the owning window. Returns
	 * true when the tool was answered inline (GUI-registered) — the pool only
	 * tracks request ids for renderer-forwarded calls (F-UI-ORIGIN).
	 */
	hostToolExecutor: ((sidecar: SidecarManager, request: HostToolCallRequest, win: BrowserWindow) => boolean) | null =
		null;
	/** Main-process persistence hook. The primary window installs this at startup. */
	onWindowTabsChanged: ((win: BrowserWindow, layout: PersistedTabLayout | null) => void) | null = null;

	constructor(factory: SidecarFactory, max = 10) {
		this.#factory = factory;
		this.#max = max;
	}

	get size(): number {
		return this.#entries.size + this.#reserved;
	}

	/** True when the pool is full — single source of truth for the cap. */
	get atCap(): boolean {
		return this.size >= this.#max;
	}

	/**
	 * Spawn + bind a sidecar for `cwd` to `win` as a tab. Returns null at the
	 * cap. `tabId` defaults to a fresh snowflake (the window's initial sidecar
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
		if (this.atCap) return null;
		this.#reserved++;
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
			return sidecar;
		} catch {
			return null;
		} finally {
			// Release the synchronous reservation exactly once: on success the
			// slot is now the live entry; on failure the pool never held it.
			this.#reserved--;
		}
	}

	/**
	 * Spawn a tab's sidecar unless one is already under way or it has already
	 * run. A fresh sidecar with a session to resume goes through restart():
	 * kill() is a no-op on a not-yet-spawned manager, so this is a plain
	 * start() carrying --session. Safe to call on every visibility change —
	 * `status` leaves "asleep" synchronously inside start(), so a second call
	 * can never double-spawn.
	 */
	#ensureStarted(entry: PoolEntry): void {
		if (entry.sidecar.status !== "asleep") return;
		const sessionPath = entry.sessionFile;
		if (sessionPath) entry.sidecar.restart(undefined, sessionPath);
		else entry.sidecar.start();
	}

	/** Per-tab light wiring, attached for the entry's whole life: TAB_STATUS pushes. */
	#wireLight(entry: PoolEntry): void {
		const { sidecar, win } = entry;
		sidecar.on("status", (payload: SidecarStatusPayload) => {
			entry.status = payload.status;
			// A restart/exit kills any in-flight run along with the process.
			if (payload.status !== "ready") {
				entry.running = false;
				entry.compacting = undefined;
			}
			forwardToWindow(win, IPC_EVENTS.TAB_STATUS, tabStatusPayload(entry));
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
		// Run-state tracking works off the event stream (connection status never
		// re-fires at run end), so background tabs report running → ready too.
		sidecar.on("events", (events: AgentSessionEvent[]) => {
			const wasBusy = entry.running || entry.compacting === true;
			const wasPlaceholder = entry.placeholder;
			for (const event of events) {
				if (event.type === "agent_start") {
					entry.running = true;
					entry.placeholder = false;
				} else if (event.type === "agent_end") entry.running = false;
				else if (event.type === "auto_compaction_start") entry.compacting = true;
				else if (event.type === "auto_compaction_end") entry.compacting = false;
			}
			const busy = entry.running || entry.compacting === true;
			if (busy !== wasBusy || entry.placeholder !== wasPlaceholder) {
				forwardToWindow(win, IPC_EVENTS.TAB_STATUS, tabStatusPayload(entry));
			}
			if (entry.placeholder !== wasPlaceholder) this.#notifyWindowTabsChanged(win);
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
		wire("extensionUi", (request: ExtensionUIRequest) => {
			// Only response-bearing requests need an origin route. Fire-and-forget
			// UI updates never reply, so retaining them here leaks the owning tab.
			if (BLOCKING_UI_METHODS[request.method]) this.#requestOwners.set(request.id, entry);
			forwardToWindow(win, IPC_EVENTS.EXTENSION_UI, { tabId: entry.tabId, request });
		});
		wire("hostToolCall", (request: HostToolCallRequest) => {
			// Answered-inline tools never reach the renderer, so only forwarded
			// calls need id → origin tracking for the result/update route.
			const answeredInline = this.hostToolExecutor ? this.hostToolExecutor(sidecar, request, win) : true;
			if (!answeredInline) this.#requestOwners.set(request.id, entry);
		});
		wire("hostUriRequest", (request: HostUriRequest) => {
			this.#requestOwners.set(request.id, entry);
			forwardToWindow(win, IPC_EVENTS.HOST_URI_REQUEST, { request });
		});
		wire("subagentFrame", (frame: SubagentFrame) => {
			forwardActive(IPC_EVENTS.SUBAGENT_FRAME, frame);
		});
		wire("liveUpdate", (frame: RpcLiveUpdateFrame) => {
			forwardActive(IPC_EVENTS.LIVE_UPDATE, frame);
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
		const visible = this.#visibleByWindow.get(entry.winId);
		visible?.delete(entry.tabId);
		const split = this.#splitByWindow.get(entry.winId);
		if (split?.firstTabId === entry.tabId || split?.secondTabId === entry.tabId)
			this.#splitByWindow.delete(entry.winId);
		if (![...this.#entries].some(candidate => candidate.winId === entry.winId)) {
			this.#activeByWindow.delete(entry.winId);
			this.#visibleByWindow.delete(entry.winId);
			this.#splitByWindow.delete(entry.winId);
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
		if (!entry || entry.running || entry.compacting === true || entry.status !== "ready") return null;
		const client = entry.sidecar.rpcClient;
		return client ? await client.command(command) : null;
	}

	/** Make `tabId` the window's active tab (moves full event forwarding). False when unknown/foreign. */
	setActiveTab(win: BrowserWindow, tabId: string): boolean {
		return this.setTabView(win, tabId, [tabId]);
	}

	/** Atomically focus one tab and wire full streams for one or two visible tabs. */
	setTabView(
		win: BrowserWindow,
		focusedTabId: string,
		visibleTabIds: readonly string[],
		split?: IpcSetTabViewPayload["split"],
	): boolean {
		const ids = [...new Set(visibleTabIds)];
		if (ids.length < 1 || ids.length > 2 || !ids.includes(focusedTabId)) return false;
		if (
			split &&
			(ids.length !== 2 ||
				!ids.includes(split.firstTabId) ||
				!ids.includes(split.secondTabId) ||
				split.firstTabId === split.secondTabId ||
				(split.axis !== "columns" && split.axis !== "rows") ||
				!Number.isFinite(split.ratio))
		)
			return false;
		for (const tabId of ids) {
			const entry = this.#byTabId.get(tabId);
			if (!entry || entry.win !== win) return false;
		}
		const winId = win.webContents.id;
		this.#activeByWindow.set(winId, focusedTabId);
		this.#visibleByWindow.set(winId, new Set(ids));
		if (split) this.#splitByWindow.set(winId, { ...split, ratio: Math.min(0.8, Math.max(0.2, split.ratio)) });
		else this.#splitByWindow.delete(winId);
		this.#syncFullWiring(winId);
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
		const split = this.#splitByWindow.get(win.webContents.id);
		for (const entry of this.#entries) {
			if (entry.win !== win) continue;
			const tab = tabStatusPayload(entry);
			if (entry.tabId === activeTabId) tab.active = true;
			if (visibleTabIds?.has(entry.tabId)) tab.visible = true;
			if (split?.firstTabId === entry.tabId) tab.split = { axis: split.axis, index: 0, ratio: split.ratio };
			else if (split?.secondTabId === entry.tabId) tab.split = { axis: split.axis, index: 1, ratio: split.ratio };
			tabs.push(tab);
		}
		return tabs;
	}

	/** What every live tab is doing right now — the ⌘Q guard's inventory. */
	tabInventory(): WindowTabFact[] {
		return [...this.#entries].map(entry => ({
			windowId: entry.winId,
			tabId: entry.tabId,
			inFlight: entry.running || entry.compacting === true,
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
		const split = this.#splitByWindow.get(win.webContents.id);
		const firstIndex = split ? entries.findIndex(entry => entry.tabId === split.firstTabId) : -1;
		const secondIndex = split ? entries.findIndex(entry => entry.tabId === split.secondTabId) : -1;
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
			...(split && firstIndex >= 0 && secondIndex >= 0
				? { split: { axis: split.axis, firstIndex, secondIndex, ratio: split.ratio } }
				: {}),
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
				const firstTabId = layout.split ? restoredTabIds[layout.split.firstIndex] : undefined;
				const secondTabId = layout.split ? restoredTabIds[layout.split.secondIndex] : undefined;
				// Routing the view is what spawns the shown tabs, so a split whose
				// panes were both dropped still falls back to one visible tab.
				if (layout.split && firstTabId && secondTabId) {
					this.setTabView(win, activeTabId, [firstTabId, secondTabId], {
						axis: layout.split.axis,
						firstTabId,
						secondTabId,
						ratio: layout.split.ratio,
					});
				} else this.setTabView(win, activeTabId, [activeTabId]);
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
		for (const entry of this.#entries) {
			entry.sidecar.removeAllListeners();
			entry.sidecar.dispose();
		}
		this.#entries.clear();
		this.#byTabId.clear();
		this.#activeByWindow.clear();
		this.#visibleByWindow.clear();
		this.#splitByWindow.clear();
		this.#sessionOwners.clear();
		this.#requestOwners.clear();
		this.#restoringWindows.clear();
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
	if (entry.compacting !== undefined) payload.compacting = entry.compacting;
	if (entry.sessionId !== undefined) payload.sessionId = entry.sessionId;
	if (entry.title !== undefined) payload.title = entry.title;
	if (entry.worktree !== undefined) payload.worktree = entry.worktree;
	return payload;
}
