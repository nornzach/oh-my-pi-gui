/**
 * Large-paste bookkeeping for the composer, mirroring the TUI editor
 * (`packages/tui/src/components/editor.ts`). The draft text carries compact
 * `[Paste #N, …]` markers; the full blob lives here in memory and is
 * substituted back in at submit time.
 *
 * Two independent thresholds (do NOT merge them):
 * - marker collapse: > 10 lines OR > 1000 chars — pasted text collapses to a marker
 * - menu popup:      `paste.largeMenuThreshold` (default 100) LINES — offers the
 *                    wrap/inline choice; 0 disables the menu but markers still apply
 */

export interface PasteBlob {
	id: number;
	content: string;
	lineCount: number;
	charCount: number;
}

export function isMarkerSized(text: string): boolean {
	return text.split("\n").length > 10 || text.length > 1000;
}

export function shouldOfferPasteMenu(lineCount: number, threshold: number): boolean {
	return threshold > 0 && lineCount >= threshold;
}

/** Wrap content as an attachment block (TUI `wrapPasteInAttachmentBlock`). */
export function wrapPasteInAttachmentBlock(content: string): string {
	return `<attachment>\n${content}\n</attachment>`;
}

export function pasteMarkerText(id: number, content: string): string {
	const lineCount = content.split("\n").length;
	return lineCount > 10 ? `[Paste #${id}, +${lineCount} lines]` : `[Paste #${id}, ${content.length} chars]`;
}

const blobs = new Map<number, PasteBlob>();
let pasteCounter = 0;

export function storePaste(content: string): PasteBlob {
	const blob: PasteBlob = {
		id: ++pasteCounter,
		content,
		lineCount: content.split("\n").length,
		charCount: content.length,
	};
	blobs.set(blob.id, blob);
	return blob;
}

export function dropPaste(id: number): void {
	blobs.delete(id);
}

export function clearPastes(): void {
	blobs.clear();
}

// Accept markers with edited-away suffixes so the agent receives the paste text.
const MARKER_RE = /\[Paste #(\d+)(?:, (?:\+\d+ lines|\d+ chars))?\]/g;

/** Substitute every known marker back to its full content (submit-time). */
export function expandPasteMarkers(draft: string): string {
	return draft.replace(MARKER_RE, (marker, idText: string) => {
		const blob = blobs.get(Number(idText));
		return blob ? blob.content : marker;
	});
}

export function referencedPasteIds(draft: string): number[] {
	const ids: number[] = [];
	for (const match of draft.matchAll(MARKER_RE)) {
		const id = Number(match[1]);
		if (blobs.has(id)) ids.push(id);
	}
	return ids;
}

/** Remove only blobs consumed by one composer draft. Other tabs can hold their
 * own paste markers at the same time, so successful submit must not clear the
 * process-wide store. */
export function dropReferencedPastes(draft: string): void {
	for (const id of referencedPasteIds(draft)) blobs.delete(id);
}
