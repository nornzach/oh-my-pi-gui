import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import type { FileEditFailure, IpcFsEditResult } from "../shared/ipc-types";
import { resolveWithin, toAbsolutePath } from "./workspace-paths";

const MAX_EDIT_BYTES = 2_000_000;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const saving = new Set<string>();

class EditError extends Error {
	constructor(readonly reason: FileEditFailure) {
		super(reason);
	}
}

function failure(error: unknown): IpcFsEditResult {
	if (error instanceof EditError) return { ok: false, reason: error.reason };
	return { ok: false, reason: "io", detail: error instanceof Error ? error.message : String(error) };
}

async function editablePath(cwd: string | null, target: string): Promise<string> {
	if (!cwd || typeof target !== "string" || !target.trim()) throw new EditError("outside");
	const resolved = toAbsolutePath(target, cwd);
	if ("error" in resolved) throw new EditError("outside");
	const [root, file] = await Promise.all([fs.realpath(cwd), fs.realpath(resolved.path)]);
	if (!resolveWithin(root, file) || file === root) throw new EditError("outside");
	return file;
}

function revisionFor(bytes: Buffer, identity: { dev: number; ino: number }): string {
	return `${identity.dev}:${identity.ino}:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readSnapshot(file: string) {
	const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.nlink > 1) throw new EditError("readOnly");
		if (before.size > MAX_EDIT_BYTES) throw new EditError("tooLarge");
		const buffer = Buffer.alloc(before.size + 1);
		let size = 0;
		while (size < buffer.length) {
			const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
			if (bytesRead === 0) break;
			size += bytesRead;
		}
		const after = await handle.stat();
		if (size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			throw new EditError("changed");
		}
		const bytes = buffer.subarray(0, size);
		if (bytes.includes(0)) throw new EditError("notText");
		let raw: string;
		try {
			raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			throw new EditError("notText");
		}
		const withoutCrlf = raw.replaceAll("\r\n", "");
		const crlf = raw.includes("\r\n");
		if (withoutCrlf.includes("\r") || (crlf && withoutCrlf.includes("\n"))) throw new EditError("notText");
		await fs.access(file, constants.W_OK).catch(() => {
			throw new EditError("readOnly");
		});
		return {
			content: raw.replaceAll("\r\n", "\n"),
			revision: revisionFor(bytes, before),
			mode: before.mode & 0o777,
			crlf,
			bom: bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM),
		};
	} finally {
		await handle.close();
	}
}

export async function openWorkspaceEdit(cwd: string | null, target: string): Promise<IpcFsEditResult> {
	try {
		const snapshot = await readSnapshot(await editablePath(cwd, target));
		return { ok: true, content: snapshot.content, revision: snapshot.revision };
	} catch (error) {
		return failure(error);
	}
}

export async function saveWorkspaceEdit(
	cwd: string | null,
	target: string,
	revision: string,
	content: string,
): Promise<IpcFsEditResult> {
	try {
		if (typeof content !== "string" || /[\u0000\r]/.test(content)) throw new EditError("notText");
		if (Buffer.byteLength(content) > MAX_EDIT_BYTES) throw new EditError("tooLarge");
		const file = await editablePath(cwd, target);
		if (saving.has(file)) throw new EditError("changed");
		saving.add(file);
		const temp = path.join(path.dirname(file), `.omp-edit-${randomUUID()}.tmp`);
		try {
			const original = await readSnapshot(file);
			if (original.revision !== revision) throw new EditError("changed");
			if (original.content === content) return { ok: true, content, revision };
			const bytes = Buffer.from(original.crlf ? content.replaceAll("\n", "\r\n") : content, "utf8");
			const encoded = original.bom ? Buffer.concat([UTF8_BOM, bytes]) : bytes;
			if (encoded.length > MAX_EDIT_BYTES) throw new EditError("tooLarge");
			const handle = await fs.open(temp, "wx", 0o600);
			let nextRevision: string;
			try {
				await handle.writeFile(encoded);
				await handle.chmod(original.mode);
				await handle.sync();
				nextRevision = revisionFor(encoded, await handle.stat());
			} finally {
				await handle.close();
			}
			if ((await editablePath(cwd, target)) !== file || (await readSnapshot(file)).revision !== revision) {
				throw new EditError("changed");
			}
			await fs.rename(temp, file);
			return { ok: true, content, revision: nextRevision };
		} finally {
			await fs.rm(temp, { force: true }).catch(() => {});
			saving.delete(file);
		}
	} catch (error) {
		return failure(error);
	}
}
