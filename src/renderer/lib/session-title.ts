import type { SessionInfo } from "../../shared/ipc-types";

/** One display-title contract shared by the sidebar and top tab strip. */
export function sessionDisplayTitle(
	session: Pick<SessionInfo, "title" | "firstMessage" | "subagent">,
	untitled: string,
): string {
	const first = session.firstMessage.trim();
	return session.title?.trim() || (session.subagent ? assignmentHeadline(first) : first) || untitled;
}

/** Sections of the agent's task format, the ones that say best what a task is first. */
const HEADLINE_SECTIONS = ["change", "target", "goal"];

/**
 * A delegated assignment in one line. Assignments are markdown written for the
 * agent (`# Target`, `# Change`, `# Acceptance`), and a compact row only has
 * room for what the task is, not for its scaffolding.
 */
export function assignmentHeadline(assignment: string): string {
	const sections = new Map<string, string>();
	let section = "";
	let first = "";
	for (const raw of assignment.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		const heading = /^#{1,6}\s+(.+)$/.exec(line)?.[1];
		if (heading) {
			section = heading.replace(/[:：]\s*$/, "").toLowerCase();
			first ||= heading;
			continue;
		}
		const body = line.replace(/^(?:[-*+]|\d+\.)\s+/, "");
		first ||= body;
		if (section && !sections.has(section)) sections.set(section, body);
	}
	for (const name of HEADLINE_SECTIONS) {
		const body = sections.get(name);
		if (body) return body;
	}
	return first;
}

/** True once a session has user-visible conversation content. */
export function sessionHasContent(session: Pick<SessionInfo, "title" | "firstMessage" | "messageCount">): boolean {
	return session.messageCount > 0 || Boolean(session.title?.trim() || session.firstMessage.trim());
}
