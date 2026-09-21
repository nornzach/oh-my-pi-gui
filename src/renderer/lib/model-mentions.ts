/**
 * Client-side projection of the upstream model-mention syntax
 * (packages/tui/src/prompt/model-mention-syntax.ts). Submitted `^selector`
 * delegations are persisted on the user message as `<model agent="m1"
 * name="…"/>` tags; unconverted `^provider/id` tokens can also appear in
 * echoed drafts. The transcript renders these as atomic delegation chips
 * instead of leaking raw tags / selectors into the markdown body.
 */

/** Submitted mention tag; groups are agent pseudonym and display name. Consumes one following space. */
const MODEL_MENTION_TAG_RE = /<model agent="(m\d+)" name="([^"]*)"\/>[ ]?/g;
/** Whitespace-delimited `^selector` token; groups are delimiter and selector. */
const MODEL_MENTION_RE = /(^|\s)\^([^\s^]+)(?=\s|$)/g;

export interface ModelMentionChip {
	/** Agent pseudonym (m1, m2, …) when the mention was registered. */
	agent?: string;
	/** Catalog display name carried by the submitted tag. */
	name?: string;
	/** Canonical selector for unconverted `^provider/id` tokens. */
	selector?: string;
}

export interface ExtractedMentions {
	chips: ModelMentionChip[];
	/** The message text with mention tags / selectors removed for display. */
	body: string;
}

/** Split a user message into delegation chips and a clean display body. */
export function extractModelMentions(text: string): ExtractedMentions {
	const chips: ModelMentionChip[] = [];

	MODEL_MENTION_TAG_RE.lastIndex = 0;
	let body = text.replace(MODEL_MENTION_TAG_RE, (_tag, agent: string, name: string) => {
		chips.push({ agent, name });
		return "";
	});

	MODEL_MENTION_RE.lastIndex = 0;
	body = body.replace(MODEL_MENTION_RE, (match, delimiter: string, selector: string) => {
		// Only treat it as a delegation when it is a provider-qualified selector
		// or an already-registered pseudonym; stray carets stay in the body.
		if (!selector.includes("/") && !/^m\d+$/.test(selector)) return match;
		chips.push({ selector });
		// Preserve a newline delimiter (never merge lines); a space/tab delimiter
		// is dropped so the token's trailing space becomes the single separator.
		return delimiter === "\n" ? "\n" : "";
	});

	return { chips, body: body.replace(/[ \t]+\n/g, "\n").trim() };
}
