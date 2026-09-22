/**
 * True when this key event belongs to an in-progress IME composition, so the
 * keystroke belongs to the input method (committing "客服" with Enter, paging
 * candidates with the arrows) and not to the handler below it.
 *
 * React does not proxy `isComposing` onto its synthetic keyboard event, so the
 * composer and dialog handlers read it from `nativeEvent`; document-level
 * listeners get the native event itself. `keyCode === 229` is the legacy
 * `Process` signal some platforms fire instead.
 *
 * Escape keeps its meaning on the legacy path only: there every key reports 229,
 * so the code cannot identify Escape, and swallowing Escape would trap the user
 * in the overlay. While composition is live the IME itself owns Escape and
 * cancels its candidate window, so the dialog stays open — the rule every
 * editor overlay follows.
 */
export function isImeKeyEvent(event: {
	key: string;
	keyCode?: number;
	isComposing?: boolean;
	nativeEvent?: { isComposing?: boolean };
}): boolean {
	const composing = event.nativeEvent?.isComposing ?? event.isComposing ?? false;
	return composing || (event.keyCode === 229 && event.key !== "Escape");
}
