import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	hasStableMacSigningIdentity,
	installerPartialPath,
	planInstallerTransfer,
	selectMacInstaller,
	settleIncompleteUpdateCheck,
	sha512FileBase64,
	sweepInstallerPartials,
} from "./updater-state";

describe("update check terminal state", () => {
	it("does not leave a completed manual check spinning forever", () => {
		expect(settleIncompleteUpdateCheck({ state: "checking" }, true)).toEqual({
			state: "error",
			message: "Update check completed without a result.",
		});
	});

	it("keeps real updater terminal states intact and makes background misses silent", () => {
		const available = { state: "available", version: "0.7.2", mode: "automatic" } as const;
		expect(settleIncompleteUpdateCheck(available, true)).toBe(available);
		expect(settleIncompleteUpdateCheck({ state: "checking" }, false)).toEqual({ state: "idle" });
	});
});

describe("manual macOS installer selection", () => {
	const files = [
		{ url: "omp-0.8.4-arm64-mac.zip", sha512: "arm-zip" },
		{ url: "omp-0.8.4-arm64.dmg", sha512: "arm-dmg", size: 120 },
		{ url: "https://example.test/omp-0.8.4-mac.zip", sha512: "x64-zip" },
		{ url: "https://example.test/omp-0.8.4.dmg", sha512: "x64-dmg", size: 140 },
	];

	it("selects the exact DMG for each supported architecture", () => {
		expect(selectMacInstaller(files, "0.8.4", "arm64")).toEqual({
			name: "omp-0.8.4-arm64.dmg",
			sha512: "arm-dmg",
			size: 120,
		});
		expect(selectMacInstaller(files, "0.8.4", "x64")).toEqual({
			name: "omp-0.8.4.dmg",
			sha512: "x64-dmg",
			size: 140,
		});
	});

	it("rejects ZIPs and installers for a different release", () => {
		expect(selectMacInstaller(files, "0.8.5", "arm64")).toBeUndefined();
		expect(
			selectMacInstaller(
				files.filter(file => file.url.endsWith(".zip")),
				"0.8.4",
				"x64",
			),
		).toBeUndefined();
	});
});

describe("macOS signing identity", () => {
	it("keeps Squirrel only for a certificate-backed stable identity", () => {
		expect(
			hasStableMacSigningIdentity(
				"Authority=Developer ID Application: Example Corp (TEAM123456)\nTeamIdentifier=TEAM123456",
			),
		).toBe(true);
		expect(hasStableMacSigningIdentity("Signature=adhoc\nTeamIdentifier=not set")).toBe(false);
		expect(hasStableMacSigningIdentity("TeamIdentifier=TEAM123456")).toBe(false);
	});
});

describe("manual installer transfer", () => {
	it("continues a partial only when the server answers for exactly the bytes it holds", () => {
		expect(planInstallerTransfer(500, { status: 206, contentRange: "bytes 500-999/1000" })).toEqual({
			offset: 500,
			append: true,
		});
	});

	it("rewrites from the top whenever appended bytes would corrupt the installer", () => {
		const restarts = [
			planInstallerTransfer(0, { status: 206, contentRange: "bytes 0-999/1000" }),
			planInstallerTransfer(500, { status: 200 }),
			planInstallerTransfer(500, { status: 206 }),
			planInstallerTransfer(500, { status: 206, contentRange: "bytes 0-999/1000" }),
		];
		for (const plan of restarts) expect(plan).toEqual({ offset: 0, append: false });
	});

	it("hashes every byte of an installer larger than its read buffer", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-installer-"));
		try {
			for (const size of [1024 * 1024 + 7, 2 * 1024 * 1024]) {
				const bytes = new Uint8Array(size);
				for (let index = 0; index < size; index += 1) bytes[index] = index % 251;
				const file = path.join(dir, `blob-${size}`);
				fs.writeFileSync(file, bytes);
				expect(await sha512FileBase64(file)).toBe(createHash("sha512").update(bytes).digest("base64"));
			}
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("installer debris sweep", () => {
	const ENTRIES = [
		"omp-0.9.7.dmg.download-4242",
		"omp-0.9.8.dmg.download-99",
		"omp-0.9.8.dmg.partial",
		"omp-0.9.7 (1).dmg.partial",
		"holiday.dmg.partial",
		"notes.partial",
		"install-omp.dmg.download-1",
		"omp-0.9.9-arm64.dmg",
	];
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-downloads-"));
		for (const name of ENTRIES) fs.writeFileSync(path.join(dir, name), "x");
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("clears PID-keyed orphans that no restart could ever continue", async () => {
		expect((await sweepInstallerPartials(dir)).sort()).toEqual([
			"omp-0.9.7.dmg.download-4242",
			"omp-0.9.8.dmg.download-99",
		]);
	});

	it("keeps every current-name partial while nothing is downloading", async () => {
		await sweepInstallerPartials(dir);
		expect(fs.existsSync(path.join(dir, "omp-0.9.8.dmg.partial"))).toBe(true);
	});

	it("drops a superseded release's partial once the current download names its own", async () => {
		const active = installerPartialPath(path.join(dir, "omp-0.9.9-arm64.dmg"));
		fs.writeFileSync(active, "x");
		const removed = await sweepInstallerPartials(dir, active);
		expect(removed.sort()).toEqual([
			"omp-0.9.7 (1).dmg.partial",
			"omp-0.9.7.dmg.download-4242",
			"omp-0.9.8.dmg.download-99",
			"omp-0.9.8.dmg.partial",
		]);
		expect(fs.existsSync(active)).toBe(true);
	});

	it("leaves files the updater never wrote where they are", async () => {
		const active = installerPartialPath(path.join(dir, "omp-0.9.9-arm64.dmg"));
		await sweepInstallerPartials(dir, active);
		await sweepInstallerPartials(dir);
		for (const name of [
			"holiday.dmg.partial",
			"notes.partial",
			"install-omp.dmg.download-1",
			"omp-0.9.9-arm64.dmg",
		]) {
			expect(fs.existsSync(path.join(dir, name)), name).toBe(true);
		}
	});

	it("says nothing when the downloads directory doesn't exist yet", async () => {
		expect(await sweepInstallerPartials(path.join(dir, "absent"))).toEqual([]);
	});
});
