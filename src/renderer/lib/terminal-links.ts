/**
 * Web addresses in terminal output are links: a dev server's
 * "Local: http://localhost:5173/" opens in the tab's browser panel like any
 * other link (⌘/Ctrl-click: the system browser). Addresses that soft-wrap
 * across rows stay one link, and end where CJK prose takes over, as they do
 * in rendered replies (`bareAddressEnd`).
 */
import type { IBufferCell, ILink, ILinkHandler, Terminal } from "@xterm/xterm";
import { bareAddressEnd, trimAddress } from "./link-targets";
import { openLink } from "./open-link";

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>`]+/gi;

export interface TextLink {
	/** Start index in the text. */
	start: number;
	/** End index (exclusive). */
	end: number;
	url: string;
}

/** Web addresses in a line of terminal text. */
export function findTextLinks(text: string): TextLink[] {
	const links: TextLink[] = [];
	for (const match of text.matchAll(URL_PATTERN)) {
		const url = trimAddress(match[0].slice(0, bareAddressEnd(match[0], text[match.index - 1])));
		if (url.length <= "https://".length) continue;
		links.push({ start: match.index, end: match.index + url.length, url });
	}
	return links;
}

interface LogicalLine {
	text: string;
	/** Buffer cell (1-based x, y) of each UTF-16 unit of `text`. */
	cells: Array<{ x: number; y: number }>;
}

/** The logical line holding buffer row `row` (0-based): its soft-wrapped rows joined, wide cells mapped. */
function logicalLine(term: Terminal, row: number): LogicalLine {
	const buffer = term.buffer.active;
	let first = row;
	while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
	let last = row;
	while (buffer.getLine(last + 1)?.isWrapped) last++;
	const line: LogicalLine = { text: "", cells: [] };
	let cell: IBufferCell | undefined;
	for (let y = first; y <= last; y++) {
		const bufferLine = buffer.getLine(y);
		if (!bufferLine) break;
		for (let x = 0; x < bufferLine.length; x++) {
			cell = bufferLine.getCell(x, cell);
			if (!cell) break;
			// The second half of a wide character.
			if (cell.getWidth() === 0) continue;
			const chars = cell.getChars() || " ";
			for (let unit = 0; unit < chars.length; unit++) line.cells.push({ x: x + 1, y: y + 1 });
			line.text += chars;
		}
	}
	return line;
}

/** Make web addresses in `term` clickable, OSC 8 hyperlinks included. */
export function registerTerminalLinks(term: Terminal): void {
	term.registerLinkProvider({
		provideLinks(row, callback) {
			const line = logicalLine(term, row - 1);
			const links: ILink[] = [];
			for (const link of findTextLinks(line.text)) {
				const start = line.cells[link.start];
				const end = line.cells[link.end - 1];
				if (!start || !end || start.y > row || end.y < row) continue;
				links.push({
					range: { start, end },
					text: link.url,
					activate: (event, text) => openLink(text, event),
				});
			}
			callback(links.length > 0 ? links : undefined);
		},
	});
}

/** `linkHandler` option: OSC 8 hyperlinks open like any other link instead of a confirm prompt. */
export const terminalLinkHandler: ILinkHandler = {
	activate: (event, text) => openLink(text, event),
	allowNonHttpProtocols: false,
};
