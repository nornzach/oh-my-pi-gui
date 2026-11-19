/**
 * Workspace-directory flows (TUI /dirs /add-dir /remove-dir /move parity)
 * shared by the WorkspaceDirsDialog and the command-registry picker/window
 * affordances. Every mutation toasts the server truth: refusals (primary
 * removal, missing path, busy while streaming) surface the agent's error
 * message, successes confirm and — for move, which re-scopes the whole
 * session cwd — rehydrate session state.
 */

import { createSessionRpcClient } from "../../shared/rpc-client";
import type { RpcResponse, RpcWorkspaceDirectoriesResult, RpcWorkspaceDirectory } from "../../shared/rpc-types";
import { hydrateSession, hydrateTabSession } from "../hooks/use-rpc-events";
import { type SessionStore, useSessionStore } from "../stores/session";
import { focusedRuntimeTabId, sessionRuntime, sessionRuntimeStore } from "../stores/session-runtime-context";
import { toast } from "../stores/toast";
import { describeError } from "./errors";
import { translate } from "./i18n";

export type { RpcWorkspaceDirectory };

/** Native directory picker (Electron openDirectory); undefined when cancelled. */
export async function pickWorkspaceDirectory(): Promise<string | undefined> {
	const paths = await window.omp.system.showOpenDialog(undefined, { directory: true });
	return paths?.[0];
}

function directoriesOf(response: RpcResponse): RpcWorkspaceDirectory[] {
	if (!response.success) return [];
	return (response.data as RpcWorkspaceDirectoriesResult | undefined)?.directories ?? [];
}

/** add_directory; returns the post-add list, or null on refusal (error toast shown). */
export async function addWorkspaceDirectory(path: string): Promise<RpcWorkspaceDirectory[] | null> {
	const response = await window.omp.rpc.addDirectory(path);
	if (!response.success) {
		toast({ variant: "error", title: translate("workspaceDirs.add"), message: response.error });
		return null;
	}
	toast({ variant: "success", message: translate("workspaceDirs.added", { path }) });
	return directoriesOf(response);
}

/** remove_directory; returns the post-removal list, or null on refusal (error toast shown). */
export async function removeWorkspaceDirectory(path: string): Promise<RpcWorkspaceDirectory[] | null> {
	const response = await window.omp.rpc.removeDirectory(path);
	if (!response.success) {
		toast({ variant: "error", title: translate("workspaceDirs.remove"), message: response.error });
		return null;
	}
	toast({ variant: "success", message: translate("workspaceDirs.removed", { path }) });
	return directoriesOf(response);
}

/**
 * move_session (TUI /move): relocates the session file's cwd association,
 * then rehydrates session state (title bar, context, composer cwd) from the
 * server truth. Returns whether the move happened.
 */
export async function pickAndMoveSession(tabId = focusedRuntimeTabId()): Promise<boolean> {
	const runtime = sessionRuntime(tabId);
	const store = tabId ? sessionRuntimeStore<SessionStore>(tabId, "session") : useSessionStore;
	const sessionId = store?.getState().sessionId;
	if (!store || (tabId && !runtime)) return false;
	try {
		const path = await pickWorkspaceDirectory();
		const state = store.getState();
		if (
			!path ||
			path === state.cwd ||
			sessionId !== state.sessionId ||
			(tabId ? sessionRuntime(tabId) !== runtime : focusedRuntimeTabId() !== null)
		)
			return false;
		if (
			state.collab?.readOnly ||
			state.status !== "ready" ||
			state.isStreaming ||
			state.isCompacting ||
			state.isBackgroundCompacting
		) {
			toast({
				variant: "warning",
				message: translate(
					state.collab?.readOnly
						? "collab.readOnlyInput"
						: state.status !== "ready"
							? "sidecar.notResponding"
							: "workspaceDirs.busy",
				),
			});
			return false;
		}
		const rpc = runtime ? createSessionRpcClient(runtime.command) : window.omp.rpc;
		const response = await rpc.moveSession(path);
		if (!response.success) throw new Error(response.error);
		const cwd = (response.data as { cwd?: string } | undefined)?.cwd ?? path;
		if (tabId) await hydrateTabSession(tabId);
		else await hydrateSession();
		toast({ variant: "success", message: translate("workspaceDirs.moved", { path: cwd }) });
		return true;
	} catch (cause) {
		toast({ variant: "error", title: translate("workspaceDirs.move"), message: describeError(cause) });
		return false;
	}
}
