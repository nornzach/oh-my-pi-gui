/**
 * Pure helpers for splitting sidebar navigation entries between the always-visible
 * primary list and the "More" overflow menu (#67).
 */

export const DEFAULT_PINNED_NAV_IDS: readonly string[] = [
	"commands",
	"search",
	"agents",
	"memory",
	"plugins",
	"pull-requests",
	"scheduled-tasks",
];

function normalizedBase(current: readonly string[] | null, validIds: ReadonlySet<string>): string[] {
	const source = current ?? DEFAULT_PINNED_NAV_IDS;
	const seen = new Set<string>();
	const result: string[] = [];
	for (const id of source) {
		if (!validIds.has(id) || seen.has(id)) continue;
		seen.add(id);
		result.push(id);
	}
	return result;
}

/** Partition `allItems` into pinned (`primary`) and overflow (`secondary`) lists. */
export function resolveSidebarNavigation<T extends { id: string }>(
	allItems: readonly T[],
	pinnedIds: readonly string[] | null,
): { primary: T[]; secondary: T[] } {
	const byId = new Map(allItems.map(item => [item.id, item] as const));
	const validIds = new Set(byId.keys());
	const effective = normalizedBase(pinnedIds, validIds);
	const pinnedSet = new Set(effective);
	const primary = effective.map(id => byId.get(id)!);
	const secondary = allItems.filter(item => !pinnedSet.has(item.id));
	return { primary, secondary };
}

/**
 * Pin `id` into the primary navigation list, or move an already-pinned item
 * before `targetId` (appending at the end when `targetId` is omitted or absent).
 */
export function pinNavItemId(
	current: readonly string[] | null,
	id: string,
	validIds: ReadonlySet<string>,
	targetId?: string,
): string[] {
	const base = normalizedBase(current, validIds);
	if (!validIds.has(id)) return base;
	if (targetId === id) return base;
	const without = base.filter(entry => entry !== id);
	if (targetId !== undefined) {
		const targetIndex = without.indexOf(targetId);
		if (targetIndex >= 0) {
			without.splice(targetIndex, 0, id);
			return without;
		}
	}
	without.push(id);
	return without;
}

/** Remove `id` from the primary navigation list so it moves back into "More". */
export function unpinNavItemId(current: readonly string[] | null, id: string, validIds: ReadonlySet<string>): string[] {
	return normalizedBase(current, validIds).filter(entry => entry !== id);
}
