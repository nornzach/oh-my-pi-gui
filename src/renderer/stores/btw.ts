/**
 * Side-question store: the GUI's view of this session's `/btw` topics.
 *
 * `get_btw_history` is the only snapshot source; `btw_delta` / `btw_record`
 * frames stream while a question runs. The TUI and the GUI share the same
 * session-local history, so a topic started in either host is visible here.
 * The modal (`BtwDialog`) and the drawer panel (`BtwPanel`) read this one
 * store, which keeps a question started in either surface visible in both.
 */
import { createStore } from "zustand/vanilla";
import { type BtwHistoryRecord, type BtwHistoryTurn, getBtwLatestTurn, type RpcBtwFrame } from "../../shared/rpc-types";
import { activeTabCommand, createScopedStoreHook, type TabCommand } from "./session-runtime-context";

export interface BtwStore {
	/** Newest first, exactly as the sidecar returns them. */
	records: BtwHistoryRecord[];
	selectedId: string | null;
	/** Record completed in this process; `btw_branch` only promotes that one. */
	branchableId: string | null;
	/** A `btw` request is starting (the answer streams after it resolves). */
	pending: boolean;
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
	select: (id: string | null) => void;
	ask: (question: string, recordId?: string) => Promise<BtwHistoryRecord>;
	cancel: (recordId: string) => Promise<void>;
	branch: () => Promise<{ cancelled?: boolean }>;
	/** Send topic `recordId`'s steering prompt to the main session; false when the session refused it. */
	inject: (recordId: string) => Promise<{ sent: boolean; reason?: string }>;
	applyFrame: (frame: RpcBtwFrame) => void;
	reset: () => void;
}

function patchLatestTurn(record: BtwHistoryRecord, patch: Partial<BtwHistoryTurn>): BtwHistoryRecord {
	const followUps = record.followUps;
	if (!followUps || followUps.length === 0) return { ...record, ...patch };
	const last = followUps.length - 1;
	return {
		...record,
		followUps: [...followUps.slice(0, last), { ...followUps[last]!, ...patch }],
	};
}

/** Replace a record in place; a new topic goes to the front (newest-first list). */
function upsertRecord(records: readonly BtwHistoryRecord[], record: BtwHistoryRecord): BtwHistoryRecord[] {
	const index = records.findIndex(candidate => candidate.id === record.id);
	if (index === -1) return [record, ...records];
	const next = records.slice();
	next[index] = record;
	return next;
}

/**
 * Reconcile a snapshot or a late `btw` response with the live record.
 * - A newer turn (follow-up) is authoritative even when the local turn is done.
 * - For the same turn, a terminal state beats a stale `running` snapshot, and
 *   while both are running the fresher answer keeps the tokens already streamed.
 */
function mergeRecord(local: BtwHistoryRecord | undefined, incoming: BtwHistoryRecord): BtwHistoryRecord {
	if (!local) return incoming;
	const localLatest = getBtwLatestTurn(local);
	const incomingLatest = getBtwLatestTurn(incoming);
	if (incomingLatest.createdAt !== localLatest.createdAt) {
		return incomingLatest.createdAt > localLatest.createdAt ? incoming : local;
	}
	const localRunning = localLatest.status === "running";
	const incomingRunning = incomingLatest.status === "running";
	if (!localRunning && incomingRunning) return local;
	if (localRunning && !incomingRunning) return incoming;
	return localLatest.updatedAt > incomingLatest.updatedAt ? local : incoming;
}

const INITIAL = {
	records: [] as BtwHistoryRecord[],
	selectedId: null as string | null,
	branchableId: null as string | null,
	pending: false,
	loading: false,
	error: null as string | null,
};

export function createBtwStore(command: TabCommand = activeTabCommand) {
	/** Invalidates stale `get_btw_history` responses inside this tab runtime. */
	let refreshVersion = 0;
	return createStore<BtwStore>()((set, get) => ({
		...INITIAL,
		refresh: async () => {
			const version = ++refreshVersion;
			set({ loading: true, error: null });
			try {
				const response = await command({ type: "get_btw_history" }, 30_000);
				if (version !== refreshVersion) return;
				if (!response.success) throw new Error(response.error);
				const records = (response.data as { records?: BtwHistoryRecord[] } | undefined)?.records;
				if (!Array.isArray(records)) throw new Error("Malformed /btw history response");
				set(state => {
					const local = new Map(state.records.map(record => [record.id, record]));
					const merged = records.map(record => mergeRecord(local.get(record.id), record));
					// A topic started or finished while the snapshot was read can be
					// missing from it. Keep the local copy instead of blanking the
					// drawer / losing the answer the user just watched.
					const incoming = new Set(records.map(record => record.id));
					for (const record of local.values()) {
						if (!incoming.has(record.id)) merged.push(record);
					}
					merged.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
					return {
						records: merged,
						loading: false,
						error: null,
						selectedId: merged.some(record => record.id === state.selectedId)
							? state.selectedId
							: (merged[0]?.id ?? null),
						branchableId:
							state.branchableId && merged.some(record => record.id === state.branchableId)
								? state.branchableId
								: null,
					};
				});
			} catch (cause) {
				if (version === refreshVersion) set({ loading: false, error: String(cause) });
			}
		},
		select: id => set({ selectedId: id }),
		ask: async (question, recordId) => {
			if (get().pending) throw new Error("A side question is already starting");
			set({ pending: true });
			try {
				const response = await command({ type: "btw", question, ...(recordId ? { recordId } : {}) }, 120_000);
				if (!response.success) throw new Error(response.error);
				const record = (response.data as { record?: BtwHistoryRecord } | undefined)?.record;
				if (!record) throw new Error("Malformed /btw response");
				const existing = get().records.find(candidate => candidate.id === record.id);
				const next = existing ? mergeRecord(existing, record) : record;
				set(state => ({
					records: upsertRecord(state.records, next),
					selectedId: next.id,
					branchableId: null,
					pending: false,
				}));
				return next;
			} catch (cause) {
				set({ pending: false });
				throw cause;
			}
		},
		cancel: async recordId => {
			const response = await command({ type: "btw_cancel", recordId });
			if (!response.success) throw new Error(response.error);
			const data = (response.data ?? {}) as { cancelled?: boolean };
			// The sidecar already settled (or the id no longer matches): re-read the
			// history so a stale local `running` state cannot disable the composers.
			if (data.cancelled === false) await get().refresh();
		},
		branch: async () => {
			const response = await command({ type: "btw_branch" });
			if (!response.success) throw new Error(response.error);
			const data = (response.data ?? {}) as { cancelled?: boolean };
			if (data.cancelled !== true) set({ branchableId: null });
			return data;
		},
		inject: async recordId => {
			const response = await command({ type: "btw_inject", recordId });
			if (!response.success) throw new Error(response.error);
			return (response.data ?? { sent: false }) as { sent: boolean; reason?: string };
		},
		applyFrame: frame => {
			if (frame.type === "btw_delta") {
				set(state => {
					const index = state.records.findIndex(record => record.id === frame.recordId);
					if (index === -1) return state;
					const record = state.records[index]!;
					const latest = getBtwLatestTurn(record);
					if (latest.status !== "running") return state;
					const patched = patchLatestTurn(record, {
						answer: latest.answer + frame.delta,
						updatedAt: Date.now(),
					});
					const records = state.records.slice();
					records[index] = patched;
					return { records };
				});
				return;
			}
			const record = frame.record;
			const latest = getBtwLatestTurn(record);
			set(state => ({
				records: upsertRecord(state.records, record),
				branchableId:
					latest.status === "complete" ? record.id : state.branchableId === record.id ? null : state.branchableId,
			}));
		},
		reset: () => {
			refreshVersion += 1;
			set({ ...INITIAL });
		},
	}));
}

const defaultBtwStore = createBtwStore();
export const useBtwStore = createScopedStoreHook("btw", defaultBtwStore);
