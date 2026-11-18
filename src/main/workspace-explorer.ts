import { promises as fs } from "node:fs";
import path from "node:path";
import type { FsTreeEntry } from "../shared/ipc-types";
import { resolveWithin } from "./workspace-paths";

type IsIgnored = (relativePath: string, directory: boolean) => boolean;

async function readEntries(
	root: string,
	directory: string,
	prefix: string,
	isIgnored: IsIgnored,
): Promise<FsTreeEntry[]> {
	const files: FsTreeEntry[] = [];
	const folders: FsTreeEntry[] = [];
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		let isDirectory = entry.isDirectory();
		const symlink = entry.isSymbolicLink();
		if (symlink) {
			const resolved = await fs.realpath(path.join(root, relative)).catch(() => null);
			if (!resolved || !resolveWithin(root, resolved)) continue;
			const stat = await fs.stat(resolved).catch(() => null);
			if (!stat?.isDirectory() && !stat?.isFile()) continue;
			isDirectory = stat.isDirectory();
		} else if (!isDirectory && !entry.isFile()) {
			continue;
		}
		if (isIgnored(relative, isDirectory)) continue;
		(isDirectory ? folders : files).push({
			name: entry.name,
			path: relative,
			kind: isDirectory ? "dir" : "file",
			...(symlink ? { symlink: true } : {}),
		});
	}
	const byName = (a: FsTreeEntry, b: FsTreeEntry) => a.name.localeCompare(b.name);
	return [...folders.sort(byName), ...files.sort(byName)];
}

export async function browseWorkspace(root: string, directory: string, isIgnored: IsIgnored): Promise<FsTreeEntry[]> {
	const canonicalRoot = await fs.realpath(root);
	const requested = resolveWithin(root, directory);
	if (!requested) throw new Error("Path escapes the workspace");
	const canonicalDir = await fs.realpath(requested);
	if (!resolveWithin(canonicalRoot, canonicalDir)) throw new Error("Path escapes the workspace");
	const prefix = path.relative(root, requested).split(path.sep).join("/");
	return readEntries(canonicalRoot, canonicalDir, prefix, isIgnored);
}

/** Search independently of what the renderer has expanded. Real directories are each visited once. */
export async function searchWorkspace(
	root: string,
	query: string,
	isIgnored: IsIgnored,
	signal?: AbortSignal,
): Promise<FsTreeEntry[]> {
	const canonicalRoot = await fs.realpath(root);
	const needle = query.normalize("NFC").toLocaleLowerCase();
	const folders = [""];
	const matches: FsTreeEntry[] = [];
	while (folders.length > 0) {
		signal?.throwIfAborted();
		const prefix = folders.pop() ?? "";
		const directory = path.join(canonicalRoot, prefix);
		if (prefix && (await fs.realpath(directory).catch(() => null)) !== directory) continue;
		const entries = await readEntries(canonicalRoot, directory, prefix, isIgnored).catch(error => {
			if (!prefix) throw error;
			return [];
		});
		for (const entry of entries) {
			if (entry.path.normalize("NFC").toLocaleLowerCase().includes(needle)) matches.push(entry);
			if (entry.kind === "dir" && !entry.symlink) folders.push(entry.path);
		}
	}
	return matches.sort((a, b) => a.path.localeCompare(b.path));
}
