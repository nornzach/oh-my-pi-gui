import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { UpdateStatus } from "../shared/ipc-types";

export interface MacInstallerAsset {
	name: string;
	sha512: string;
	size?: number;
}

interface ReleaseFile {
	url: string;
	sha512: string;
	size?: number;
}

export type MacInstallerArchitecture = "arm64" | "x64";

/** Select only the exact DMG produced for the running Mac architecture. */
export function selectMacInstaller(
	files: readonly ReleaseFile[],
	version: string,
	architecture: MacInstallerArchitecture,
): MacInstallerAsset | undefined {
	const expectedName = architecture === "arm64" ? `omp-${version}-arm64.dmg` : `omp-${version}.dmg`;
	for (const file of files) {
		let name = file.url;
		try {
			const pathname = new URL(file.url, "https://updates.invalid").pathname;
			name = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
		} catch {}
		if (name === expectedName) return { name: expectedName, sha512: file.sha512, size: file.size };
	}
	return undefined;
}

/**
 * A certificate-backed signature has both an authority chain and a team.
 * Ad-hoc signatures explicitly report `Signature=adhoc` and no team.
 */
export function hasStableMacSigningIdentity(codesignDetails: string): boolean {
	if (/^\s*Signature=adhoc\s*$/m.test(codesignDetails)) return false;
	if (/^\s*TeamIdentifier=not set\s*$/m.test(codesignDetails)) return false;
	return /^\s*Authority=.+$/m.test(codesignDetails) && /^\s*TeamIdentifier=(?!not set$).+$/m.test(codesignDetails);
}

/**
 * electron-updater may resolve without emitting an available/not-available
 * event (notably in unpackaged builds). Never leave the public state machine
 * stuck in `checking` after the request itself has finished.
 */
export function settleIncompleteUpdateCheck(
	status: UpdateStatus,
	manual: boolean,
	noResultMessage = "Update check completed without a result.",
): UpdateStatus {
	if (status.state !== "checking") return status;
	return manual ? { state: "error", message: noResultMessage } : { state: "idle" };
}

/* -------------------------------------------- macOS manual installer transfer */

const PARTIAL_SUFFIX = ".partial";
/**
 * Only names the updater itself could have written: `omp-<version>[-arm64][ (n)].dmg`
 * plus a partial suffix. Downloads is the user's directory, so anything else —
 * including a lookalike like `holiday.dmg.partial` — must survive the sweep.
 */
const INSTALLER_DEBRIS = /^omp-[\d.]+(?:-arm64)?(?: \(\d+\))?\.dmg(?:\.partial|\.download-\d+)$/;
const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * Deterministic name for the in-flight installer. The earlier PID-keyed temp
 * name could never be continued after a crash or quit, so every interrupted
 * download left an unresumable copy of a ~120 MB DMG behind in Downloads.
 */
export function installerPartialPath(destinationPath: string): string {
	return `${destinationPath}${PARTIAL_SUFFIX}`;
}

export interface InstallerTransferPlan {
	/** Bytes already on disk to keep. 0 restarts the transfer. */
	offset: number;
	/** True when the response continues the partial, so bytes append to it. */
	append: boolean;
}

/**
 * A `Range` request is only honored if the server answers 206 *and* starts
 * exactly where the local file ends. Anything else — a server that ignored the
 * header, one that answered for different bytes — means rewriting from the top,
 * because appending foreign bytes would produce an installer that then fails
 * hashing.
 */
export function planInstallerTransfer(
	existingBytes: number,
	response: { status: number; contentRange?: string },
): InstallerTransferPlan {
	if (existingBytes <= 0 || response.status !== 206) return { offset: 0, append: false };
	const match = /^bytes\s+(\d+)-/i.exec(response.contentRange ?? "");
	return Number(match?.[1]) === existingBytes ? { offset: existingBytes, append: true } : { offset: 0, append: false };
}

/** Stream a finished installer through SHA-512 without holding a DMG in memory. */
export async function sha512FileBase64(filePath: string): Promise<string> {
	const hash = createHash("sha512");
	const file = await fs.open(filePath, "r");
	const buffer = new Uint8Array(HASH_CHUNK_BYTES);
	try {
		let position = 0;
		for (;;) {
			const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
	} finally {
		await file.close();
	}
	return hash.digest("base64");
}

/**
 * Delete installer debris: PID-keyed partials written by older builds (never
 * resumable) and, once a fresh download names its own partial, `.partial` files
 * belonging to a superseded release. Without a current download there is no way
 * to tell a resumable partial from an abandoned one, so startup removes only
 * the old debris. Everything else in Downloads belongs to the user.
 */
export async function sweepInstallerPartials(directory: string, activePartial?: string): Promise<string[]> {
	const activeName = activePartial ? path.basename(activePartial) : undefined;
	const removed: string[] = [];
	let entries: string[];
	try {
		entries = await fs.readdir(directory);
	} catch {
		return removed;
	}
	for (const name of entries) {
		if (!INSTALLER_DEBRIS.test(name)) continue;
		if (name === activeName) continue;
		if (activeName === undefined && name.endsWith(PARTIAL_SUFFIX)) continue;
		try {
			await fs.rm(path.join(directory, name), { force: true });
			removed.push(name);
		} catch {
			/* still open by a racing transfer; the next launch retries */
		}
	}
	return removed;
}
