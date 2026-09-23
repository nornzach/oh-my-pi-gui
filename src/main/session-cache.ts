/**
 * The stamped LRU behind both session-index caches.
 *
 * Entries key by path and carry the `mtime:size` signature they were read at, so
 * re-reading a changed file replaces its slot instead of adding a second one, and
 * invalidation is a single delete per watcher event rather than a scan over every
 * cached key. Capacity is a caller-chosen weight: entry count for parsed headers,
 * bytes for cached search text.
 */

interface Stamped<V> {
	signature: string;
	value: V;
}

export class StampedLru<V> {
	#entries = new Map<string, Stamped<V>>();
	#used = 0;
	readonly #capacity: number;
	readonly #sizeOf: (value: V) => number;

	constructor(capacity: number, sizeOf?: (value: V) => number) {
		this.#capacity = capacity;
		this.#sizeOf = sizeOf ?? (() => 1);
	}

	/** Cached value for `key`, or null when absent or read at a different signature. */
	get(key: string, signature: string): V | null {
		const entry = this.#entries.get(key);
		if (!entry || entry.signature !== signature) return null;
		// Re-insert so this entry becomes the most recently used.
		this.#entries.delete(key);
		this.#entries.set(key, entry);
		return entry.value;
	}

	set(key: string, signature: string, value: V): void {
		this.delete(key);
		const weight = this.#sizeOf(value);
		// An entry that alone exceeds the budget is not kept: caching it would make
		// the ceiling a lie, and evicting everything else to fit it is worse.
		if (weight > this.#capacity) return;
		this.#used += weight;
		this.#entries.set(key, { signature, value });
		while (this.#used > this.#capacity && this.#entries.size > 1) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) break;
			this.delete(oldest);
		}
	}

	delete(key: string): void {
		const entry = this.#entries.get(key);
		if (!entry) return;
		this.#used -= this.#sizeOf(entry.value);
		this.#entries.delete(key);
	}

	clear(): void {
		this.#entries.clear();
		this.#used = 0;
	}

	get size(): number {
		return this.#entries.size;
	}

	/** Weight currently held, in the unit the capacity was given in. */
	get used(): number {
		return this.#used;
	}
}
