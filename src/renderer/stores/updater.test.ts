/**
 * Updater store contract: the banner's dismissal is version-scoped — snoozing
 * v0.4.1 must not hide v0.4.2 — and it outlives the process, because a broken
 * update feed re-reports the same failure on every four-hour poll. Status itself
 * is replaced wholesale (the main process owns the machine).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDismissal, useUpdaterStore } from "./updater";

const globals = globalThis as Record<string, unknown>;
let storage: Record<string, string>;

beforeEach(() => {
	storage = {};
	globals.localStorage = {
		getItem: (key: string) => storage[key] ?? null,
		setItem: (key: string, value: string) => {
			storage[key] = value;
		},
		removeItem: (key: string) => {
			delete storage[key];
		},
	};
	useUpdaterStore.setState({ status: { state: "idle" }, dismissed: {} });
});

afterEach(() => {
	delete globals.localStorage;
	useUpdaterStore.setState({ status: { state: "idle" }, dismissed: {} });
});

describe("useUpdaterStore", () => {
	it("replaces status wholesale as the main-process machine advances", () => {
		const { setStatus } = useUpdaterStore.getState();
		setStatus({ state: "available", version: "0.4.1", mode: "automatic" });
		expect(useUpdaterStore.getState().status).toEqual({ state: "available", version: "0.4.1", mode: "automatic" });
		setStatus({
			state: "downloading",
			version: "0.4.1",
			mode: "automatic",
			percent: 42,
			bytesPerSecond: 1,
			transferred: 42,
			total: 100,
		});
		expect(useUpdaterStore.getState().status.state).toBe("downloading");
		setStatus({ state: "downloaded", version: "0.4.1", mode: "automatic" });
		expect(useUpdaterStore.getState().status).toEqual({ state: "downloaded", version: "0.4.1", mode: "automatic" });
	});

	it("dismisses per version: a newer version is not covered by an older dismissal", () => {
		const { dismiss, setStatus } = useUpdaterStore.getState();
		dismiss("0.4.1");
		expect(useUpdaterStore.getState().dismissed.version).toBe("0.4.1");
		// The banner hides only when dismissed.version === status.version; a newer
		// available version must compare unequal.
		setStatus({ state: "available", version: "0.4.2", mode: "manual" });
		expect(useUpdaterStore.getState().dismissed.version).not.toBe("0.4.2");
	});

	it("hands a dismissal to the next process through the same key it reads back", () => {
		const { dismiss, dismissError } = useUpdaterStore.getState();
		dismiss("0.4.1");
		expect(loadDismissal()).toEqual({ version: "0.4.1" });
		dismissError();
		expect(loadDismissal()).toEqual({ version: "0.4.1", error: true });
	});

	it("keeps a dismissed failure hidden while the same error keeps replaying", () => {
		const { dismissError, setStatus } = useUpdaterStore.getState();
		setStatus({ state: "checking" });
		dismissError();
		setStatus({ state: "error", message: "GitHub release feed unreachable.", showInBanner: true });
		expect(useUpdaterStore.getState().dismissed.error).toBe(true);
	});

	it("re-arms the failure banner once a check proves the updater works", () => {
		const { dismissError, setStatus } = useUpdaterStore.getState();
		dismissError();
		setStatus({ state: "not-available", version: "0.4.1" });
		expect(useUpdaterStore.getState().dismissed.error).toBeUndefined();
		expect(loadDismissal().error).toBeUndefined();
	});

	it("refuses a persisted blob it cannot trust", () => {
		useUpdaterStore.getState().dismiss("0.4.1");
		const key = Object.keys(storage)[0];
		storage[key] = "{ not json";
		expect(loadDismissal()).toEqual({});
		storage[key] = JSON.stringify({ version: 42, error: "yes" });
		expect(loadDismissal()).toEqual({});
	});
});
