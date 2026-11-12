/**
 * Command palette ranking. Matches are tiered by where and how the query hits,
 * so a command whose title starts with the query always outranks one that
 * only spells it out letter by letter or mentions it in its description:
 *
 *   exact title > title prefix > title word prefix > title/alias substring >
 *   description substring > title/alias subsequence (denser first)
 *
 * Within a tier the command's own label or name beats an alias, then the
 * shorter title wins: "set" puts Settings above Providers (alias "setup").
 *
 * Descriptions take part only through literal substrings; a subsequence spread
 * across a sentence matches almost anything and buried real hits.
 */

import { fuzzyScore } from "./session-search";

export interface RankableCommand {
	name: string;
	label: string;
	description?: string;
	aliases?: readonly string[];
}

const TIER = {
	exact: 6000,
	prefix: 5000,
	wordPrefix: 4000,
	substring: 3000,
	description: 2000,
	subsequence: 0,
} as const;

/** Tie-break inside a tier: own label/name first, then shorter titles (stays below the next tier). */
const OWN_TITLE_BONUS = 500;

function titleTier(query: string, title: string): number | null {
	const text = title.toLowerCase();
	if (text === query) return TIER.exact;
	if (text.startsWith(query)) return TIER.prefix;
	if (text.split(/[\s/_.:-]+/).some(word => word.startsWith(query))) return TIER.wordPrefix;
	if (text.includes(query)) return TIER.substring;
	return null;
}

/** Higher is better; null means the command does not match. An empty query matches everything equally. */
export function scoreCommand(rawQuery: string, command: RankableCommand): number | null {
	const query = rawQuery.trim().toLowerCase();
	if (query.length === 0) return 0;
	const aliases = command.aliases ?? [];
	const titles = [command.label, command.name, ...aliases];
	let best: number | null = null;
	for (const [index, title] of titles.entries()) {
		const tier = titleTier(query, title);
		if (tier === null) continue;
		const own = index < 2 ? OWN_TITLE_BONUS : 0;
		best = Math.max(best ?? 0, tier + own + Math.max(0, OWN_TITLE_BONUS - 1 - title.length));
	}
	if (best !== null) return best;
	if (command.description?.toLowerCase().includes(query)) return TIER.description;
	for (const title of titles) {
		const score = fuzzyScore(query, title);
		if (score !== null) best = Math.max(best ?? TIER.subsequence, TIER.subsequence + score);
	}
	return best;
}
