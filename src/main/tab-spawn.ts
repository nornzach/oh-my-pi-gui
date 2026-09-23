/**
 * SPAWN_TAB decision logic, extracted from ipc.ts so the refusal contracts
 * are directly testable without an Electron runtime. The handler stays a
 * thin shell: BrowserWindow lookup + this call.
 *
 * Two refusal codes, mirroring the F-OWN shape:
 * - `owned` — the session file is already attached to a tab (double-attach).
 * - `kind-mismatch` — the payload's requested kind disagrees with the file's
 *   stamped kind (I3: reject, never degrade). When the payload omits `kind`,
 *   the file's kind wins instead of refusing.
 */
import type { BrowserWindow } from "electron";
import type { IpcSpawnTabPayload, IpcSpawnTabResult, SessionKind } from "../shared/ipc-types";
import type { SessionIndex } from "./session-index";
import type { SidecarPool } from "./sidecar-pool";
import { nextSnowflake } from "./snowflake";

export type SpawnTabDeps = {
	sidecarPool: Pick<SidecarPool, "sessionOwner" | "atCap" | "acquire">;
	sessionIndex: Pick<SessionIndex, "kindFor">;
	/** Caller's cwd resolution (ipc.ts's cwdFor, falling back to the app's initial cwd). */
	fallbackCwd: () => string;
	/** GUI-owned Work workspace, created on demand. */
	defaultWorkspace: () => string;
};

export async function spawnTabForWindow(
	deps: SpawnTabDeps,
	win: BrowserWindow,
	payload: IpcSpawnTabPayload,
): Promise<IpcSpawnTabResult | null> {
	const sessionPath =
		typeof payload?.sessionPath === "string" && payload.sessionPath ? payload.sessionPath : undefined;
	let kind: SessionKind = payload?.kind === "chat" ? "chat" : "agent";
	if (sessionPath) {
		// F-OWN first: a live owner wins over every other consideration.
		const owner = deps.sidecarPool.sessionOwner(sessionPath);
		if (owner) return { tabId: null, ownerTabId: owner.tabId, ownerWinId: owner.winId, refusal: "owned" };
		// F-KIND: the file's stamped kind is authoritative. Refuse a mismatched
		// explicit request; defer to the file when the payload omits kind.
		const fileKind = await deps.sessionIndex.kindFor(sessionPath);
		if (payload?.kind !== undefined && fileKind !== kind) {
			return { tabId: null, refusal: "kind-mismatch" };
		}
		kind = fileKind;
	}
	if (deps.sidecarPool.atCap) return null;
	const cwd = payload.defaultWorkspace
		? deps.defaultWorkspace()
		: typeof payload?.cwd === "string" && payload.cwd.length > 0
			? payload.cwd
			: deps.fallbackCwd();
	const tabId = nextSnowflake();
	// A no-path tab is an explicit New Tab action. It must start empty even
	// when the CLI's persistent autoResume setting is enabled for the project.
	return deps.sidecarPool.acquire(cwd, win, tabId, sessionPath, kind, payload?.worktree, !sessionPath)
		? payload.defaultWorkspace
			? { tabId, cwd }
			: { tabId }
		: null;
}
