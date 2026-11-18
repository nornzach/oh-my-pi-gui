/** Only dirty state crosses IPC; draft contents remain in their renderer. */
const dirtyWindows = new Set<number>();

export function setWindowFileDrafts(windowId: number, dirty: boolean): void {
	if (dirty) dirtyWindows.add(windowId);
	else dirtyWindows.delete(windowId);
}

export function hasUnsavedFileDrafts(windowId?: number): boolean {
	return windowId === undefined ? dirtyWindows.size > 0 : dirtyWindows.has(windowId);
}
