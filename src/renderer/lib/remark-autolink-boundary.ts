import type { Nodes, Root } from "mdast";
import type {} from "micromark-extension-gfm-autolink-literal";
import {
	asciiAlpha,
	asciiAlphanumeric,
	asciiControl,
	markdownLineEndingOrSpace,
	unicodePunctuation,
	unicodeWhitespace,
} from "micromark-util-character";
import { codes } from "micromark-util-symbol";
import type { Code, Construct, Effects, Event, State, TokenizeContext } from "micromark-util-types";
import type {} from "remark-parse";
import type { Processor } from "unified";
import { bareAddressEnd, isAddressStop, isCjkScript, trimAddress } from "./link-targets";

/**
 * GFM literal autolinks (`http://…`, `www.…`) that end where CJK prose takes
 * over, by the rules beside `bareAddressEnd` in link-targets.ts, which the
 * terminal and tool-output linkifier shares. Upstream runs an address to the
 * next whitespace, so `运行于 **http://127.0.0.1:18091**，仅` linked
 * `…18091**，仅` and lost the bold.
 *
 * Fixing the link node afterwards cannot bring the bold back (the `**` is
 * already inside the link), so this disables upstream's `protocolAutolink` and
 * `wwwAutolink` constructs by name and registers ports of them
 * (micromark-extension-gfm-autolink-literal 2.1, MIT) that also stop at that
 * boundary. They emit upstream's token types, so
 * mdast-util-gfm-autolink-literal builds the link as before. Email literals are
 * untouched: their ASCII-only domain already stops at CJK text.
 *
 * Register after remark-gfm: GFM also links addresses micromark declined
 * (`官网：www.example.com，欢迎`) in an mdast transform, and the transform
 * added here trims those links after it runs.
 */
export function remarkAutolinkBoundary(this: Processor): void {
	const data = this.data();
	data.micromarkExtensions ??= [];
	data.micromarkExtensions.push({
		text: {
			[codes.uppercaseH]: protocolAutolink,
			[codes.lowercaseH]: protocolAutolink,
			[codes.uppercaseW]: wwwAutolink,
			[codes.lowercaseW]: wwwAutolink,
		},
		disable: { null: ["protocolAutolink", "wwwAutolink"] },
	});
	data.fromMarkdownExtensions ??= [];
	data.fromMarkdownExtensions.push({ transforms: [trimFallbackLinks] });
}

const protocolAutolink: Construct = {
	name: "boundedProtocolAutolink",
	tokenize: tokenizeProtocolAutolink,
	previous: previousProtocol,
};
const wwwAutolink: Construct = { name: "boundedWwwAutolink", tokenize: tokenizeWwwAutolink, previous: previousWww };
const wwwPrefix: Construct = { tokenize: tokenizeWwwPrefix, partial: true };

/** Punctuation GFM trims off the end of an address; `&…;` and `]` have rules of their own. */
const TRAILING: readonly Code[] = [
	codes.exclamationMark,
	codes.quotationMark,
	codes.apostrophe,
	codes.rightParenthesis,
	codes.asterisk,
	codes.comma,
	codes.dot,
	codes.colon,
	codes.semicolon,
	codes.questionMark,
	codes.underscore,
	codes.tilde,
];
const TRAIL_START: readonly Code[] = [...TRAILING, codes.ampersand, codes.lessThan, codes.rightSquareBracket];

/** Trailing `.`/`_` inside a host: a CJK character after it is a label (`example.中国`), not prose. */
const domainTrail = trail(() => false);

function tokenizeProtocolAutolink(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
	const self = this;
	const address = addressConstructs(self.previous);
	let buffer = "";
	let seen = false;
	return start;

	function start(code: Code): State | undefined {
		if (
			(code === codes.uppercaseH || code === codes.lowercaseH) &&
			previousProtocol.call(self, self.previous) &&
			!previousUnbalanced(self.events)
		) {
			effects.enter("literalAutolink");
			effects.enter("literalAutolinkHttp");
			buffer += String.fromCodePoint(code);
			effects.consume(code);
			return prefixInside;
		}
		return nok(code);
	}

	function prefixInside(code: Code): State | undefined {
		// `5` is the size of `https`.
		if (code !== null && asciiAlpha(code) && buffer.length < 5) {
			buffer += String.fromCodePoint(code);
			effects.consume(code);
			return prefixInside;
		}
		if (code === codes.colon) {
			const protocol = buffer.toLowerCase();
			if (protocol === "http" || protocol === "https") {
				effects.consume(code);
				return slashesInside;
			}
		}
		return nok(code);
	}

	function slashesInside(code: Code): State | undefined {
		if (code === codes.slash) {
			effects.consume(code);
			if (seen) return afterProtocol;
			seen = true;
			return slashesInside;
		}
		return nok(code);
	}

	function afterProtocol(code: Code): State | undefined {
		return code === codes.eof ||
			asciiControl(code) ||
			markdownLineEndingOrSpace(code) ||
			unicodeWhitespace(code) ||
			unicodePunctuation(code)
			? nok(code)
			: effects.attempt(address.domain, effects.attempt(address.path, after), nok)(code);
	}

	function after(code: Code): State | undefined {
		effects.exit("literalAutolinkHttp");
		effects.exit("literalAutolink");
		return ok(code);
	}
}

function tokenizeWwwAutolink(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
	const self = this;
	const address = addressConstructs(self.previous);
	return start;

	function start(code: Code): State | undefined {
		if (
			(code !== codes.uppercaseW && code !== codes.lowercaseW) ||
			!previousWww.call(self, self.previous) ||
			previousUnbalanced(self.events)
		) {
			return nok(code);
		}
		effects.enter("literalAutolink");
		effects.enter("literalAutolinkWww");
		// Check, not attempt: the `www.` is then parsed again as part of the domain.
		return effects.check(
			wwwPrefix,
			effects.attempt(address.domain, effects.attempt(address.path, after), nok),
			nok,
		)(code);
	}

	function after(code: Code): State | undefined {
		effects.exit("literalAutolinkWww");
		effects.exit("literalAutolink");
		return ok(code);
	}
}

function tokenizeWwwPrefix(effects: Effects, ok: State, nok: State): State {
	let size = 0;
	return inside;

	function inside(code: Code): State | undefined {
		if ((code === codes.uppercaseW || code === codes.lowercaseW) && size < 3) {
			size++;
			effects.consume(code);
			return inside;
		}
		if (code === codes.dot && size === 3) {
			effects.consume(code);
			return after;
		}
		return nok(code);
	}

	function after(code: Code): State | undefined {
		return code === codes.eof ? nok(code) : ok(code);
	}
}

/**
 * Domain and path constructs for one address. `before` is the character ahead
 * of it: after `*`, `_` or `~`, a run of two or more of that marker is the
 * closing delimiter and ends the address.
 */
function addressConstructs(before: Code): { domain: Construct; path: Construct } {
	const marker = before === codes.asterisk || before === codes.underscore || before === codes.tilde;
	const closer = marker ? before : undefined;
	const closing: Construct = { tokenize: tokenizeClosingRun, partial: true };
	return { domain: { tokenize: tokenizeDomain, partial: true }, path: { tokenize: tokenizePath, partial: true } };

	function tokenizeClosingRun(effects: Effects, ok: State, nok: State): State {
		let size = 0;
		return run;

		function run(code: Code): State | undefined {
			if (code === closer) {
				size++;
				effects.consume(code);
				return run;
			}
			return size >= 2 ? ok(code) : nok(code);
		}
	}

	function tokenizeDomain(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
		const self = this;
		let underscoreInLastSegment = false;
		let underscoreInLastLastSegment = false;
		let seen = false;
		return inside;

		function inside(code: Code): State | undefined {
			return code === closer ? effects.check(closing, after, unclosed)(code) : unclosed(code);
		}

		function unclosed(code: Code): State | undefined {
			// A `.` or `_` followed only by trailing punctuation and an end is not part of the domain.
			if (code === codes.dot || code === codes.underscore) {
				return effects.check(domainTrail, after, atPunctuation)(code);
			}
			if (
				code === codes.eof ||
				markdownLineEndingOrSpace(code) ||
				unicodeWhitespace(code) ||
				(code !== codes.dash && unicodePunctuation(code)) ||
				// CJK prose glued to an ASCII host: `example.com仅`, `localhost仅`.
				(isCjkScript(code) && asciiAlphanumeric(self.previous))
			) {
				return after(code);
			}
			seen = true;
			effects.consume(code);
			return inside;
		}

		function atPunctuation(code: Code): State | undefined {
			if (code === codes.underscore) {
				underscoreInLastSegment = true;
			} else {
				underscoreInLastLastSegment = underscoreInLastSegment;
				underscoreInLastSegment = false;
			}
			effects.consume(code);
			return inside;
		}

		function after(code: Code): State | undefined {
			return underscoreInLastLastSegment || underscoreInLastSegment || !seen ? nok(code) : ok(code);
		}
	}

	function tokenizePath(effects: Effects, ok: State): State {
		let sizeOpen = 0;
		let sizeClose = 0;
		// Until the first `/`, `?` or `#` the address is still beside its host
		// (a port), where any CJK character is prose.
		let afterHost = true;
		const pathTrail = trail(() => afterHost);
		return inside;

		function inside(code: Code): State | undefined {
			return code === closer ? effects.check(closing, ok, unclosed)(code) : unclosed(code);
		}

		function unclosed(code: Code): State | undefined {
			if (code === codes.leftParenthesis) {
				sizeOpen++;
				effects.consume(code);
				return inside;
			}
			// A `)` closing an earlier `(` belongs to the address: no trail check.
			if (code === codes.rightParenthesis && sizeClose < sizeOpen) return atPunctuation(code);
			if (TRAIL_START.includes(code)) return effects.check(pathTrail, ok, atPunctuation)(code);
			if (
				code === codes.eof ||
				markdownLineEndingOrSpace(code) ||
				unicodeWhitespace(code) ||
				isAddressStop(code) ||
				(afterHost && isCjkScript(code))
			) {
				return ok(code);
			}
			if (code === codes.slash || code === codes.numberSign) afterHost = false;
			effects.consume(code);
			return inside;
		}

		function atPunctuation(code: Code): State | undefined {
			if (code === codes.rightParenthesis) sizeClose++;
			if (code === codes.questionMark) afterHost = false;
			effects.consume(code);
			return inside;
		}
	}
}

/**
 * Trailing punctuation that ends the address: a run of it followed by
 * whitespace, `<`, CJK punctuation, or (while `cjkEnds()`) a CJK character.
 */
function trail(cjkEnds: () => boolean): Construct {
	return { tokenize: tokenizeTrail, partial: true };

	function tokenizeTrail(effects: Effects, ok: State, nok: State): State {
		return inside;

		function inside(code: Code): State | undefined {
			if (TRAILING.includes(code)) {
				effects.consume(code);
				return inside;
			}
			// `&`, letters, then `;` (a character reference) trails as a whole.
			if (code === codes.ampersand) {
				effects.consume(code);
				return referenceStart;
			}
			if (code === codes.rightSquareBracket) {
				effects.consume(code);
				return bracketAfter;
			}
			if (
				code === codes.lessThan ||
				code === codes.eof ||
				markdownLineEndingOrSpace(code) ||
				unicodeWhitespace(code) ||
				isAddressStop(code) ||
				(cjkEnds() && isCjkScript(code))
			) {
				return ok(code);
			}
			return nok(code);
		}

		// `]` before what could start a resource or reference ends the address.
		function bracketAfter(code: Code): State | undefined {
			if (
				code === codes.eof ||
				code === codes.leftParenthesis ||
				code === codes.leftSquareBracket ||
				markdownLineEndingOrSpace(code) ||
				unicodeWhitespace(code)
			) {
				return ok(code);
			}
			return inside(code);
		}

		function referenceStart(code: Code): State | undefined {
			return asciiAlpha(code) ? referenceInside(code) : nok(code);
		}

		function referenceInside(code: Code): State | undefined {
			if (code === codes.semicolon) {
				effects.consume(code);
				return inside;
			}
			if (asciiAlpha(code)) {
				effects.consume(code);
				return referenceInside;
			}
			return nok(code);
		}
	}
}

function previousWww(code: Code): boolean {
	return (
		code === codes.eof ||
		code === codes.leftParenthesis ||
		code === codes.asterisk ||
		code === codes.underscore ||
		code === codes.leftSquareBracket ||
		code === codes.rightSquareBracket ||
		code === codes.tilde ||
		markdownLineEndingOrSpace(code)
	);
}

function previousProtocol(code: Code): boolean {
	return !asciiAlpha(code);
}

/** Whether an unbalanced `[`/`![` precedes: no literal autolinks inside a pending label. */
function previousUnbalanced(events: Event[]): boolean {
	let index = events.length;
	let result = false;
	while (index--) {
		const token = events[index]?.[1];
		if (!token) continue;
		if ((token.type === "labelLink" || token.type === "labelImage") && !token._balanced) {
			result = true;
			break;
		}
		// Seen before with nothing unbalanced ahead of it: stop walking.
		if (token._gfmAutolinkLiteralWalkedInto) break;
	}
	const last = events.at(-1)?.[1];
	if (last && !result) last._gfmAutolinkLiteralWalkedInto = true;
	return result;
}

const ADDRESS_START = /^(?:https?:\/\/|www\.)/i;

/** GFM's mdast fallback links leave no position; cut them at the same boundary. */
function trimFallbackLinks(tree: Root): undefined {
	trimLinksIn(tree);
}

function trimLinksIn(node: Nodes): void {
	if (!("children" in node)) return;
	const children: Nodes[] = node.children;
	for (let index = 0; index < children.length; index++) {
		const child = children[index] as Nodes;
		if (child.type !== "link" || child.position) {
			trimLinksIn(child);
			continue;
		}
		const label = child.children[0];
		if (child.children.length !== 1 || label?.type !== "text" || !ADDRESS_START.test(label.value)) continue;
		const text = label.value;
		const end = trimAddress(text.slice(0, bareAddressEnd(text))).length;
		if (end === text.length || !child.url.endsWith(text)) continue;
		child.url = child.url.slice(0, child.url.length - text.length + end);
		label.value = text.slice(0, end);
		const next = children[index + 1];
		if (next?.type === "text") next.value = text.slice(end) + next.value;
		else children.splice(index + 1, 0, { type: "text", value: text.slice(end) });
	}
}
