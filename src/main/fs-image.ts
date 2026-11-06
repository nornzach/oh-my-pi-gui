/**
 * Reads a file for display in an <img>. The file must sniff as a real image
 * type and fit under a size cap, whatever its name says.
 */
import { promises as fsp } from "node:fs";
import type { IpcFsReadImageResult } from "../shared/ipc-types";

export const FS_IMAGE_MAX_BYTES = 25_000_000;
const SNIFF_BYTES = 512;

function sniffImageMime(header: Buffer): string | null {
	if (header.length >= 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
		return "image/png";
	}
	if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
	if (header.length >= 6 && header.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
	if (header.length >= 6 && header.subarray(0, 6).toString("ascii") === "GIF87a") return "image/gif";
	if (
		header.length >= 12 &&
		header.subarray(0, 4).toString("ascii") === "RIFF" &&
		header.subarray(8, 12).toString("ascii") === "WEBP"
	) {
		return "image/webp";
	}
	if (header.length >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp") {
		const brand = header.subarray(8, 12).toString("ascii");
		if (brand === "avif" || brand === "avis") return "image/avif";
	}
	if (header.length >= 2 && header[0] === 0x42 && header[1] === 0x4d) return "image/bmp";
	if (header.length >= 4 && header[0] === 0x00 && header[1] === 0x00 && header[2] === 0x01 && header[3] === 0x00) {
		return "image/x-icon";
	}
	// SVG is text: only when it actually opens as SVG, which design tools often
	// do after an XML prolog, a comment or a doctype. Loaded through <img> it
	// renders in secure static mode (no script execution).
	const text = header.toString("utf8").trimStart().slice(0, SNIFF_BYTES).toLowerCase();
	if (text.startsWith("<svg")) return "image/svg+xml";
	if (/^<(?:\?xml|!--|!doctype\s+svg)/.test(text) && text.includes("<svg")) return "image/svg+xml";
	return null;
}

/** Throws what the file system throws (missing file, no permission). */
export async function readImageFile(abs: string): Promise<IpcFsReadImageResult> {
	const stat = await fsp.stat(abs);
	const refused = { ok: false, dataUrl: null, size: stat.size };
	if (!stat.isFile()) return { ...refused, mime: null, error: "Not a file" };
	const handle = await fsp.open(abs, "r");
	try {
		const header = Buffer.alloc(SNIFF_BYTES);
		const { bytesRead } = await handle.read(header, 0, SNIFF_BYTES, 0);
		const mime = sniffImageMime(header.subarray(0, bytesRead));
		// Type before size: a large file that isn't an image is not a large image.
		if (!mime) return { ...refused, mime: null, error: "Not a supported image" };
		if (stat.size > FS_IMAGE_MAX_BYTES) return { ...refused, mime, tooLarge: true, error: "Image too large" };
		const body = Buffer.alloc(stat.size);
		const { bytesRead: length } = await handle.read(body, 0, stat.size, 0);
		return { ok: true, dataUrl: `data:${mime};base64,${body.toString("base64", 0, length)}`, mime, size: stat.size };
	} finally {
		await handle.close();
	}
}
