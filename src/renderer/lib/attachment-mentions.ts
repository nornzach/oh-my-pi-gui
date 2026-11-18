/** Find the trailing file references used by the composer. The original text
 * stays on the message for copy, editing and Core's file ingestion. */
export function splitAttachmentMentions(text: string): { body: string; paths: string[] } {
	const mentions = Array.from(text.matchAll(/(?:^|\s)(@(?:"([^"]+)"|'([^']+)'|([^\s@]+)))/g));
	const paths: string[] = [];
	let end = text.trimEnd().length;
	for (const match of mentions.reverse()) {
		const token = match[1];
		const path = match[2] ?? match[3] ?? match[4];
		const start = match.index + match[0].length - token.length;
		if (start + token.length !== end || !path || !isLocalAttachment(path, match[4] === undefined)) break;
		paths.unshift(path);
		end = text.slice(0, start).trimEnd().length;
	}
	return { body: paths.length === 0 ? text : text.slice(0, end), paths: [...new Set(paths)] };
}

function isLocalAttachment(path: string, quoted: boolean): boolean {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false;
	return quoted || /[\\/]/.test(path) || /\.[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(path);
}
