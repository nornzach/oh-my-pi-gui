/**
 * Contracts for the cache that bounds the session index's memory. The failure
 * modes it defends: a byte ceiling that is really an entry ceiling (search text
 * is capped per file, so N entries could be N × the read cap), stale generations
 * of one file piling up because the key carried the signature, and a signature
 * match that returns text from a different generation of the file.
 */
import { describe, expect, it } from "vitest";
import { StampedLru } from "./session-cache";

describe("StampedLru (entry-count budget)", () => {
	it("keeps one slot per key instead of a slot per generation", () => {
		const cache = new StampedLru<string>(8);
		cache.set("/s/a.jsonl", "1:10", "first read");
		cache.set("/s/a.jsonl", "2:20", "second read");
		// The old key included the signature, so every re-read added an entry that
		// nothing could reach and invalidation had to scan for.
		expect(cache.size).toBe(1);
		expect(cache.used).toBe(1);
		expect(cache.get("/s/a.jsonl", "2:20")).toBe("second read");
		expect(cache.get("/s/a.jsonl", "1:10")).toBeNull();
	});

	it("evicts the oldest slot once the budget is full", () => {
		const cache = new StampedLru<string>(2);
		cache.set("a", "s", "A");
		cache.set("b", "s", "B");
		expect(cache.get("c", "s")).toBeNull();
		cache.set("c", "s", "C");
		expect(cache.get("a", "s")).toBeNull();
		expect(cache.get("b", "s")).toBe("B");
		expect(cache.get("c", "s")).toBe("C");
	});
});

describe("StampedLru (byte budget)", () => {
	const bytes = (value: string) => value.length;

	it("counts what it holds rather than how many things it holds", () => {
		const cache = new StampedLru<string>(100, bytes);
		cache.set("a", "s", "x".repeat(60));
		cache.set("b", "s", "y".repeat(60));
		expect(cache.used).toBeLessThanOrEqual(100);
		// Inserting b evicted a: an entry-count ceiling would have kept both.
		expect(cache.get("a", "s")).toBeNull();
		expect(cache.get("b", "s")).toHaveLength(60);
	});

	it("drops an entry that cannot fit even in an empty cache", () => {
		const cache = new StampedLru<string>(10, bytes);
		cache.set("big", "s", "x".repeat(50));
		expect(cache.size).toBe(0);
		expect(cache.used).toBe(0);
		// The room the oversize entry did not take is still usable.
		cache.set("small", "s", "ok");
		expect(cache.get("small", "s")).toBe("ok");
	});

	it("refuses a value stored at another signature", () => {
		const cache = new StampedLru<string>(100, bytes);
		cache.set("f", "11:4", "abcd");
		// Same length, new mtime: the file was rewritten, so the old text is wrong.
		expect(cache.get("f", "22:4")).toBeNull();
		expect(cache.get("f", "11:4")).toBe("abcd");
	});

	it("releases the weight of a deleted key", () => {
		const cache = new StampedLru<string>(100, bytes);
		cache.set("f", "s", "x".repeat(90));
		expect(cache.used).toBe(90);
		cache.delete("f");
		expect(cache.used).toBe(0);
		cache.set("g", "s", "x".repeat(90));
		expect(cache.get("g", "s")).toHaveLength(90);
	});

	it("clears everything without leaking weight", () => {
		const cache = new StampedLru<string>(100, bytes);
		cache.set("f", "s", "abc");
		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.used).toBe(0);
	});
});
