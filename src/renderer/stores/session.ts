import type { VirtualItem } from "@tanstack/react-virtual";
import { createStore } from "zustand/vanilla";
import type {
	ContextUsage,
	RpcCollabState,
	RpcLoopModeState,
	RpcSessionState,
	SidecarStatus,
} from "../../shared/rpc-types";
import { createScopedStoreHook } from "./session-runtime-context";

export interface TranscriptView {
	sessionId: string;
	pinned: boolean;
	preCompactionOpen: boolean;
	expandedProcessKeys: Set<string>;
	scrollOffset: number;
	anchorKey?: string;
	anchorOffset: number;
	measurements: VirtualItem[];
}

export interface SessionStore {
	collab: RpcCollabState | null;
	switchPending: { fromId: string; toId: string } | null;
	setSwitchPending: (pending: { fromId: string; toId: string } | null) => void;
	/** Live event revision; a delayed snapshot cannot overwrite a newer lifecycle transition. */
	eventVersion: number;
	transcriptView: TranscriptView | null;
	saveTranscriptView: (view: TranscriptView) => void;
	/** Bumped when the transcript must snap back to the live edge (the user just
	 * sent a message). Per-tab stores, so a tab switch can't strand another pane. */
	transcriptPinNonce: number;
	pinTranscriptToBottom: () => void;
	sessionId: string;
	sessionName: string | null;
	sessionFile: string | null;
	cwd: string;
	isStreaming: boolean;
	isCompacting: boolean;
	/** Client clock (Date.now()) of the current turn_start while no assistant
	 * message has begun streaming — drives the chat's pending-model indicator
	 * so a stalled provider request is visibly alive instead of dead air. */
	awaitingModelSince: number | null;
	/** Live auto-retry window (auto_retry_start → auto_retry_end): drives the
	 * inline retry row with a live countdown. `startedAt` is the client clock
	 * at event time so the countdown survives re-renders. */
	retryInfo: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string; startedAt: number } | null;
	/** Live auto-compaction window (auto_compaction_start → auto_compaction_end):
	 * carries the TUI loader's reason/action text for the inline status row. */
	compactionInfo: { reason: "threshold" | "overflow" | "idle" | "incomplete"; action: string } | null;
	status: SidecarStatus;
	contextUsage: ContextUsage | null;
	/** Bumped every time a get_state snapshot actually carries fresh context
	 * usage. Cost displays pace their refetch on this instead of on message
	 * appends, so spend that arrives without a new transcript entry (subagent
	 * billing, another window on the same session) still gets picked up. */
	statsPulse: number;
	messageCount: number;
	queuedMessageCount: number;
	planModeEnabled: boolean;
	/** Whether a prewalk model switch is armed and waiting for the first edit/write. */
	prewalkArmed: boolean;
	agentsPaused: boolean;
	agentsPausedAt: number | null;
	goal: { objective?: string } | null;
	goalState: { status?: string } | null;
	/** Live loop-mode state: loop_mode_update frames, hydrated via get_loop_mode
	 * (not on the get_state wire). null = not yet fetched; chips treat as off. */
	loopMode: RpcLoopModeState | null;
	/** Vibe mode emits no event — hydrated via get_vibe_mode and mirrored when
	 * the Modes window toggles it. */
	vibeModeEnabled: boolean;
	setFromState: (state: RpcSessionState) => void;
	setStatus: (status: SidecarStatus, cwd: string) => void;
	reset: () => void;
}

const initialState = {
	collab: null as RpcCollabState | null,
	switchPending: null as { fromId: string; toId: string } | null,
	eventVersion: 0,
	transcriptView: null as TranscriptView | null,
	transcriptPinNonce: 0,
	sessionId: "",
	sessionName: null,
	sessionFile: null,
	cwd: "",
	isStreaming: false,
	isCompacting: false,
	awaitingModelSince: null,
	retryInfo: null,
	compactionInfo: null,
	status: "starting" as SidecarStatus,
	contextUsage: null,
	statsPulse: 0,
	messageCount: 0,
	queuedMessageCount: 0,
	planModeEnabled: false,
	prewalkArmed: false,
	agentsPaused: false,
	agentsPausedAt: null,
	goal: null,
	goalState: null,
	loopMode: null,
	vibeModeEnabled: false,
};

export const createSessionStore = () =>
	createStore<SessionStore>()(set => ({
		...initialState,
		setSwitchPending: switchPending => set({ switchPending }),
		saveTranscriptView: transcriptView => set({ transcriptView }),
		pinTranscriptToBottom: () => set(state => ({ transcriptPinNonce: state.transcriptPinNonce + 1 })),
		setFromState: state =>
			set({
				sessionId: state.sessionId,
				collab: state.collab ?? null,
				// Sessions whose auto-title never ran carry an empty title slot on
				// disk; normalize "" to null so the TitleBar falls through to the
				// session-list title/first message instead of rendering blank.
				sessionName: state.sessionName || null,
				sessionFile: state.sessionFile ?? null,
				cwd: state.cwd,
				isStreaming: state.isStreaming,
				isCompacting: state.isCompacting,
				contextUsage: state.contextUsage ?? null,
				messageCount: state.messageCount,
				queuedMessageCount: state.queuedMessageCount,
				planModeEnabled: state.planModeEnabled ?? false,
				prewalkArmed: state.prewalkArmed ?? false,
				agentsPaused: state.agentsPaused ?? false,
				agentsPausedAt: state.agentsPausedAt ?? null,
			}),
		setStatus: (status, cwd) => set({ status, cwd }),
		reset: () => set(initialState),
	}));

const defaultSessionStore = createSessionStore();
export const useSessionStore = createScopedStoreHook("session", defaultSessionStore);
