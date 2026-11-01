/**
 * The in-app notification list for scheduled runs: every notice the scheduler
 * raises (the task's notify setting decides which), newest first, kept with its
 * read state in scheduler.db so every window and the next launch agree on what
 * is still unread.
 */

import type { TaskNotice } from "../../shared/scheduler-types";

/** Oldest notices fall off past this many. */
export const MAX_NOTICES = 50;

/** `notice` on top of `notices`, keeping the newest {@link MAX_NOTICES}. */
export function addNotice(notices: readonly TaskNotice[], notice: TaskNotice): TaskNotice[] {
	return [notice, ...notices].slice(0, MAX_NOTICES);
}

/** Mark the notices with these ids read, or every notice when `ids` is omitted. */
export function markNoticesRead(notices: readonly TaskNotice[], ids?: readonly string[]): TaskNotice[] {
	const wanted = ids ? new Set(ids) : null;
	return notices.map(notice =>
		!notice.read && (!wanted || wanted.has(notice.id)) ? { ...notice, read: true } : notice,
	);
}

const TONES = new Set<TaskNotice["tone"]>(["done", "review", "failed"]);

/** The stored list, without entries a crash or an older build left malformed. */
export function parseNotices(raw: string | null): TaskNotice[] {
	if (!raw) return [];
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(value)) return [];
	return value
		.filter((entry): entry is TaskNotice => {
			if (typeof entry !== "object" || entry === null) return false;
			const notice = entry as Partial<TaskNotice>;
			return (
				typeof notice.id === "string" &&
				typeof notice.title === "string" &&
				typeof notice.body === "string" &&
				typeof notice.createdAt === "number" &&
				typeof notice.read === "boolean" &&
				TONES.has(notice.tone as TaskNotice["tone"]) &&
				typeof notice.target === "object" &&
				notice.target !== null
			);
		})
		.slice(0, MAX_NOTICES);
}
