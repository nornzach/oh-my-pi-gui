import { describe, expect, it } from "vitest";
import {
	type ApplicationResourceIdentity,
	applicationResourcesChanged,
	RENDERER_RECOVERY_COOLDOWN_MS,
	shouldReloadRenderer,
	shouldRestartForChangedResources,
} from "./renderer-recovery";

const launchIdentity: ApplicationResourceIdentity = {
	device: 1,
	inode: 100,
	size: 10_000,
	modifiedAt: 1_000,
};

describe("renderer crash recovery", () => {
	it("reloads an abnormal renderer exit after a stable interval", () => {
		expect(shouldReloadRenderer("crashed", 1_000, 1_000 + RENDERER_RECOVERY_COOLDOWN_MS)).toBe(true);
		expect(shouldReloadRenderer("oom", 0, RENDERER_RECOVERY_COOLDOWN_MS)).toBe(true);
	});

	it("does not reload clean exits or repeat a crash loop inside the cooldown", () => {
		expect(shouldReloadRenderer("clean-exit", 0, RENDERER_RECOVERY_COOLDOWN_MS)).toBe(false);
		expect(shouldReloadRenderer("crashed", 10_000, 10_001)).toBe(false);
	});

	it("restarts instead of reloading when the packaged resource archive changed", () => {
		expect(applicationResourcesChanged(launchIdentity, { ...launchIdentity })).toBe(false);
		expect(applicationResourcesChanged(launchIdentity, { ...launchIdentity, inode: 101 })).toBe(true);
		expect(applicationResourcesChanged(launchIdentity, { ...launchIdentity, size: 10_001 })).toBe(true);
		expect(applicationResourcesChanged(launchIdentity, { ...launchIdentity, modifiedAt: 1_001 })).toBe(true);
		expect(applicationResourcesChanged(launchIdentity, null)).toBe(true);
	});

	it("does not infer resource drift when no packaged archive existed at launch", () => {
		expect(applicationResourcesChanged(null, launchIdentity)).toBe(false);
		expect(applicationResourcesChanged(null, null)).toBe(false);
	});

	it("restarts only for failures that mean the shell is unrecoverable", () => {
		// Routine renderer noise must never relaunch the app and drop every
		// running agent with it.
		expect(shouldRestartForChangedResources({ kind: "console-error" })).toBe(false);
		expect(shouldRestartForChangedResources({ kind: "main-frame-navigation" })).toBe(false);
		// A subframe that failed to load is recoverable; the app shell is not.
		expect(shouldRestartForChangedResources({ kind: "load-failure", mainFrame: false })).toBe(false);
		expect(shouldRestartForChangedResources({ kind: "load-failure", mainFrame: true })).toBe(true);
		// A clean renderer exit is already handled by reload, not by a restart.
		expect(shouldRestartForChangedResources({ kind: "process-gone", reloadable: false })).toBe(false);
		expect(shouldRestartForChangedResources({ kind: "process-gone", reloadable: true })).toBe(true);
	});
});
