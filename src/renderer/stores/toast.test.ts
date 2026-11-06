import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useToastStore } from "./toast";

beforeEach(() => useToastStore.setState({ toasts: [] }));
afterEach(() => useToastStore.setState({ toasts: [] }));

describe("failure toasts", () => {
	it("show a readable sentence instead of the failure's raw text", () => {
		useToastStore.getState().push({ variant: "error", message: "getaddrinfo ENOTFOUND no-such-host.invalid" });
		expect(useToastStore.getState().toasts[0].message).toContain("Couldn't find no-such-host.invalid");
	});

	it("merge failures that read the same even when their raw text differs", () => {
		useToastStore
			.getState()
			.push({ variant: "warning", message: "ECONNRESET: The socket connection was closed unexpectedly." });
		useToastStore.getState().push({ variant: "warning", message: "socket hang up" });
		expect(useToastStore.getState().toasts).toHaveLength(1);
		expect(useToastStore.getState().toasts[0].count).toBe(2);
	});

	it("leave other toasts as written", () => {
		useToastStore.getState().push({ variant: "info", message: "404 files indexed" });
		expect(useToastStore.getState().toasts[0].message).toBe("404 files indexed");
	});
});

describe("toast dedupe", () => {
	it("coalesces an identical visible notice and refreshes its lifetime", () => {
		const firstId = useToastStore.getState().push({
			variant: "warning",
			title: "compaction",
			message: "Compaction paused",
			durationMs: 100,
		});
		const firstExpiry = useToastStore.getState().toasts[0].expiresAt;
		const secondId = useToastStore.getState().push({
			variant: "warning",
			title: "compaction",
			message: "Compaction paused",
			durationMs: 500,
		});

		const toasts = useToastStore.getState().toasts;
		expect(secondId).toBe(firstId);
		expect(toasts).toHaveLength(1);
		expect(toasts[0]).toMatchObject({ count: 2, message: "Compaction paused" });
		expect(toasts[0].expiresAt).toBeGreaterThan(firstExpiry);
	});

	it("keeps notices with different messages distinct", () => {
		useToastStore.getState().push({ variant: "warning", title: "compaction", message: "First warning" });
		useToastStore.getState().push({ variant: "warning", title: "compaction", message: "Second warning" });

		expect(useToastStore.getState().toasts).toHaveLength(2);
	});
});
