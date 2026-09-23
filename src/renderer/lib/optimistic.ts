/**
 * Shared optimistic-write commit: apply the new value, attempt to persist it,
 * and put the old value back when the write failed.
 *
 * A renderer that writes through an RPC is optimistic by construction — the
 * UI changes before the server agrees. Without this helper every failed
 * persist left the interface displaying a state that was never stored: the
 * pin stayed on the row, the todo stayed checked, the queue lane stayed
 * reordered, until the next reload contradicted the user.
 *
 * Rollback is guarded by value identity so a write that the server (or a
 * newer user action) already superseded is never unwound, and a chain of
 * overlapping optimistic values is unwound transitively to the last real one.
 */

/** Maps a failed optimistic value to its predecessor. Server-written values
 *  never enter this map, so walking it terminates at the last authoritative
 *  snapshot even when several mutations failed before any of them settled. */
const predecessors = new WeakMap<object, object>();

function isTrackable(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

function rollbackBase<Value>(optimistic: Value, previous: Value): Value {
	if (!isTrackable(optimistic)) return previous;
	let current: object = optimistic;
	let parent = predecessors.get(current);
	while (parent && parent !== current) {
		current = parent;
		parent = predecessors.get(current);
	}
	return (current === optimistic ? previous : current) as Value;
}

export interface OptimisticTarget<State extends object> {
	getState: () => State;
	setState: (partial: Partial<State>) => void;
}

export interface OptimisticWrite<State extends object> {
	/** The store holding the slice — resolved by the caller, which knows which
	 *  tab/session runtime it belongs to. */
	store: OptimisticTarget<State>;
	/** Derive the new values from the live state. Returning unchanged values
	 *  skips the write and the persist entirely. */
	mutate: (state: State) => Partial<State>;
	/** The call that must succeed for the change to be real. */
	persist: () => Promise<{ success: boolean; error?: string }>;
	/** Report the failure to the user — a toast, inline, whatever the surface has. */
	onFailure: (message: string) => void;
	/** Optional authoritative re-read after the rollback. */
	resync?: () => Promise<unknown>;
}

const UNKNOWN_FAILURE = "Persistence call failed";

export async function optimisticWrite<State extends object>({
	store,
	mutate,
	persist,
	onFailure,
	resync,
}: OptimisticWrite<State>): Promise<void> {
	const before = store.getState();
	const patch = mutate(before);
	const state = before as Record<string, unknown>;
	const next: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
		if (state[key] !== value) next[key] = value;
	}
	if (Object.keys(next).length === 0) return;
	store.setState(next as Partial<State>);
	// Stores may canonicalise what they are handed (todo re-normalises every
	// phase list), so the identity that lands is not always the one `mutate`
	// returned. Capture what the store actually holds and guard on that.
	const applied: Record<string, unknown> = {};
	for (const key of Object.keys(next)) applied[key] = store.getState()[key as keyof State];

	let failure: string | undefined;
	try {
		const response = await persist();
		if (response.success) return;
		failure = response.error;
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause);
	}

	const rollback: Record<string, unknown> = {};
	for (const key of Object.keys(next)) {
		const value = applied[key];
		const previous = state[key];
		// WeakMap keys and chain links must both be objects; a primitive slice
		// (a flag, a count) just restores its previous value.
		if (isTrackable(value) && isTrackable(previous)) predecessors.set(value, previous);
		// Only unwind a value nobody has replaced in the meantime.
		if (store.getState()[key as keyof State] === value) rollback[key] = rollbackBase(value, previous);
	}
	if (Object.keys(rollback).length > 0) store.setState(rollback as Partial<State>);
	onFailure(failure ?? UNKNOWN_FAILURE);
	await resync?.();
}
