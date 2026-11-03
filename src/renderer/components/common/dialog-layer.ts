// DOM order is not a reliable overlay order: some dialogs render in-place and
// others portal to document.body. Track mount/open order explicitly so an
// overlay opened from Settings owns Escape even when Settings is later in DOM.
const dialogLayers: HTMLElement[] = [];

/**
 * The one z-index tier every blocking dialog overlay shares. App surfaces
 * (Settings, PR Center) sit at z-50, floaters at z-70…z-100; a same-z surface
 * portaled to body after a dialog paints over it and makes the prompt
 * invisible and unclickable — dialogs must outrank all of them. Floaters open
 * while a dialog is up end up under its backdrop, which is correct: the modal
 * owns the interaction, and the floater's outside-pointerdown listener still
 * fires through the document.
 */
export const DIALOG_OVERLAY_Z = "z-[120]";

// Where each dialog sends focus back to when it closes.
const restoreTargets = new WeakMap<HTMLElement, HTMLElement | null>();

/**
 * Records and returns where a dialog opening now sends focus back to. One
 * dialog that hands over to another (a picker opening an editor, and back)
 * closes in the same commit, so focus still sits on a control inside the
 * closing one, which is about to go: take that dialog's own target instead.
 */
export function handOffRestoreTarget(dialog: HTMLElement | null, active: HTMLElement | null): HTMLElement | null {
	let target = active;
	for (let hops = 0; hops < 8 && target; hops++) {
		let owner: HTMLElement | null = target;
		while (owner && !restoreTargets.has(owner)) owner = owner.parentElement;
		if (!owner || dialogLayers.includes(owner)) break;
		target = restoreTargets.get(owner) ?? null;
	}
	if (dialog) restoreTargets.set(dialog, target);
	return target;
}

/** Register a visible dialog as the newest interaction layer. */
export function registerDialogLayer(dialog: HTMLElement | null): () => void {
	if (!dialog) return () => {};
	const existing = dialogLayers.lastIndexOf(dialog);
	if (existing >= 0) dialogLayers.splice(existing, 1);
	dialogLayers.push(dialog);
	return () => {
		const index = dialogLayers.lastIndexOf(dialog);
		if (index >= 0) dialogLayers.splice(index, 1);
	};
}

/** Whether this dialog is the most recently opened visible interaction layer. */
export function isTopmostDialog(dialog: HTMLElement | null): boolean {
	if (!dialog) return false;
	let registeredTop: HTMLElement | undefined;
	for (let index = dialogLayers.length - 1; index >= 0; index--) {
		const candidate = dialogLayers[index];
		// React removes a portal before running its effect cleanup. Keep the
		// queried layer long enough for that cleanup to decide whether focus
		// should return to its trigger.
		if (!candidate.isConnected && candidate !== dialog) {
			dialogLayers.splice(index, 1);
			continue;
		}
		registeredTop = candidate;
		break;
	}
	const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
	const domTop = dialogs[dialogs.length - 1];
	// A legacy/custom dialog that has not adopted registration still covers
	// registered layers when it is appended above them.
	if (domTop && !dialogLayers.includes(domTop)) return domTop === dialog;
	if (registeredTop) return registeredTop === dialog;
	return domTop === dialog;
}
