import { execFile } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import {
	type DocumentPage,
	type DocumentPreviewResult,
	HTML_DOCUMENT,
	OFFICE_DOCUMENT,
} from "../shared/document-preview";

const run = promisify(execFile);
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_SHEETS = 32;
const MAX_THUMBNAIL_BYTES = 1024 * 1024;
const UNAVAILABLE: DocumentPreviewResult = { kind: "unavailable" };
const THUMBNAIL_FORMAT = /\.(pdf|md|markdown|txt|csv|tsv|png|jpe?g|webp|gif|tiff?|heic|svg)$/i;
const thumbnails = new Map<string, Promise<DocumentPreviewResult>>();
let runningThumbnails = 0;

async function readBounded(path: string, maxBytes: number): Promise<Buffer | null> {
	const file = await lstat(path).catch(() => null);
	if (!file?.isFile() || file.size > maxBytes) return null;
	return readFile(path);
}

async function readQuickLookDocument(directory: string): Promise<DocumentPreviewResult> {
	if (!(await lstat(directory).catch(() => null))?.isDirectory()) return UNAVAILABLE;
	const index = (await readBounded(join(directory, "Preview.html"), MAX_HTML_BYTES))?.toString("utf8");
	if (!index) return UNAVAILABLE;
	const sheets = new Map<string, string>();
	if (/<iframe\b/i.test(index)) {
		// Excel's Quick Look generator writes sheet names in the tab header
		// immediately before an empty navigation link.
		for (const [, tabLabel, file, linkLabel] of index.matchAll(
			/(?:<div\b[^>]*class="TabHeader"[^>]*>([^<]*)<\/div>\s*)?<a\b[^>]*href="(Attachment\d+\.html)"[^>]*>([^<]*)<\/a>/gi,
		)) {
			sheets.set(file, (tabLabel ?? linkLabel).trim());
		}
	}
	const files = sheets.size ? [...sheets.keys()].slice(0, MAX_SHEETS) : ["Preview.html"];
	let incomplete = sheets.size > MAX_SHEETS;
	const pages: DocumentPage[] = [];
	let remaining = MAX_HTML_BYTES;
	for (const file of files) {
		const buffer = await readBounded(join(directory, file), remaining);
		if (!buffer) {
			incomplete = true;
			continue;
		}
		remaining -= buffer.byteLength;
		let html = buffer.toString("utf8");
		for (const [tag, css] of html.matchAll(/(<link\b[^>]*href="(Attachment\d+\.css)"[^>]*>)/gi)) {
			const styles = await readBounded(join(directory, css), Math.min(128 * 1024, remaining));
			if (!styles) {
				incomplete = true;
				continue;
			}
			remaining -= styles.byteLength;
			html = html.replace(tag, () => `<style>${styles.toString("utf8")}</style>`);
		}
		for (const [attribute, image] of html.matchAll(/(src="(Attachment\d+\.(?:png|jpe?g|gif))")/gi)) {
			const bytes = await readBounded(join(directory, image), Math.min(512 * 1024, remaining));
			if (!bytes) {
				incomplete = true;
				continue;
			}
			remaining -= bytes.byteLength;
			const type = extname(image) === ".jpg" ? "jpeg" : extname(image).slice(1);
			html = html.replace(attribute, () => `src="data:image/${type};base64,${bytes.toString("base64")}"`);
		}
		pages.push({ label: sheets.get(file), html });
	}
	if (pages.length === 0) return UNAVAILABLE;
	return { kind: "document", pages, incomplete };
}

async function quickLook(path: string, thumbnail: boolean): Promise<DocumentPreviewResult> {
	const directory = await mkdtemp(join(tmpdir(), "omp-quicklook-"));
	try {
		const args = thumbnail ? ["-t", "-s", "360"] : ["-p"];
		await run("/usr/bin/qlmanage", [...args, "-o", directory, path], { timeout: 6500, maxBuffer: 128 * 1024 });
		if (!thumbnail) return await readQuickLookDocument(join(directory, `${basename(path)}.qlpreview`));
		const png = (await readdir(directory)).find(name => name.endsWith(".png"));
		const bytes = png ? await readBounded(join(directory, png), MAX_THUMBNAIL_BYTES) : null;
		return bytes ? { kind: "image", dataUrl: `data:image/png;base64,${bytes.toString("base64")}` } : UNAVAILABLE;
	} catch {
		return UNAVAILABLE;
	} finally {
		await rm(directory, { recursive: true, force: true }).catch(() => {});
	}
}

/** Local read-only preview via macOS Quick Look. Other hosts keep the
 * regular file viewer. Preview output lives in a private temporary directory. */
export async function readDocumentPreview(path: string, thumbnail: boolean): Promise<DocumentPreviewResult> {
	const office = OFFICE_DOCUMENT.test(path);
	if (
		process.platform !== "darwin" ||
		(!office && !(thumbnail && (HTML_DOCUMENT.test(path) || THUMBNAIL_FORMAT.test(path))))
	)
		return UNAVAILABLE;
	const file = await stat(path).catch(() => null);
	if (!file?.isFile() || file.size > MAX_FILE_BYTES) return UNAVAILABLE;
	if (!thumbnail) return quickLook(path, false);
	const key = `${path}\u0000${file.mtimeMs}\u0000${file.size}`;
	const cached = thumbnails.get(key);
	if (cached) return cached;
	if (runningThumbnails >= 8) return UNAVAILABLE;
	runningThumbnails++;
	const job = quickLook(path, true).finally(() => runningThumbnails--);
	if (thumbnails.size >= 32) {
		const oldest = thumbnails.keys().next().value;
		if (oldest) thumbnails.delete(oldest);
	}
	thumbnails.set(key, job);
	return job;
}
