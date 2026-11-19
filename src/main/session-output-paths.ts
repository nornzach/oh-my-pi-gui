import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IpcResolvedPath } from "../shared/ipc-types";
import { resolveWithin } from "./workspace-paths";

/** Mirrors Core 19 local-root.ts for Windows paths that would exceed MAX_PATH. */
async function shortWindowsLocalRoot(sessionFile: string): Promise<string | null> {
	const handle = await fs.open(sessionFile, "r");
	try {
		const bytes = Buffer.alloc(64 * 1024);
		const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
		const firstLine = bytes.subarray(0, bytesRead).toString("utf8").split("\n")[0];
		const header: { type?: unknown; id?: unknown } = JSON.parse(firstLine);
		if (header.type !== "session" || typeof header.id !== "string" || !header.id) return null;
		const id = header.id.replace(/[^a-zA-Z0-9_.-]/g, "_");
		if (!id || id === "." || id === "..") return null;
		return path.join(os.tmpdir(), "omp-local", id);
	} finally {
		await handle.close();
	}
}

/** Read-only lookup in the calling tab's session; never accepts a renderer-supplied root. */
export async function resolveSessionOutputPath(
	target: string,
	sessionFile: string | null,
	platform: NodeJS.Platform = process.platform,
): Promise<IpcResolvedPath | null> {
	if (!sessionFile?.endsWith(".jsonl")) return null;
	const sessionRoot = sessionFile.slice(0, -".jsonl".length);
	try {
		const needsShortRoot =
			/^local:\/\//i.test(target) && platform === "win32" && path.resolve(sessionRoot, "local").length >= 180;
		const shortRoot = needsShortRoot ? await shortWindowsLocalRoot(sessionFile) : null;
		if (needsShortRoot && !shortRoot) return null;
		const physicalRoot = shortRoot ?? sessionRoot;
		const root = await fs.realpath(physicalRoot);
		const sessionParent = await fs.realpath(path.dirname(physicalRoot));
		if (root !== path.join(sessionParent, path.basename(physicalRoot))) return null;
		let base = root;
		let relative: string;
		const legacy = /^artifact:\/\/(\d+)$/i.exec(target);
		if (legacy) {
			const files = (await fs.readdir(root)).filter(name => name.startsWith(`${legacy[1]}.`));
			if (files.length !== 1) return null;
			relative = files[0];
		} else {
			if (!/^local:\/\//i.test(target)) return null;
			relative = decodeURIComponent(target.slice("local://".length));
			// Validate before URL/path normalization can erase traversal or authority syntax.
			if (
				!relative ||
				/[\\\x00-\x1f\x7f:?#]/.test(relative) ||
				relative.split("/").some(part => !part || part === "." || part === "..")
			)
				return null;
			base = shortRoot ? root : await fs.realpath(path.join(root, "local"));
			if (!resolveWithin(root, base) || (!shortRoot && base === root)) return null;
		}
		const candidate = resolveWithin(base, relative);
		if (!candidate) return null;
		const absolutePath = await fs.realpath(candidate);
		if (!resolveWithin(base, absolutePath) || absolutePath === base) return null;
		if (!(await fs.stat(absolutePath)).isFile()) return null;
		return { absolutePath, kind: "file" };
	} catch {
		return null;
	}
}
