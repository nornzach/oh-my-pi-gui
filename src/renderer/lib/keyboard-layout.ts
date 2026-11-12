/**
 * Shortcuts follow the letter the keyboard layout types, not the key's position
 * on a US keyboard (#49): this window reads the layout map, uses it for every
 * chord it records or matches, and tells the main process, which places the
 * system-wide shortcut and reads built-in browser keystrokes by the same map.
 */
import { keyboardLayoutFrom, setKeyboardLayout } from "../../shared/chord";

/** Chromium's Keyboard Map API; not in TypeScript's DOM lib. */
interface LayoutMapKeyboard {
	getLayoutMap(): Promise<Iterable<readonly [string, string]>>;
}

let reported = "";
let reading: Promise<void> | null = null;

/** Re-read the layout now; concurrent calls share one read. */
export function refreshKeyboardLayout(): Promise<void> {
	reading ??= readLayout().finally(() => {
		reading = null;
	});
	return reading;
}

async function readLayout(): Promise<void> {
	const keyboard = (navigator as Navigator & { keyboard?: LayoutMapKeyboard }).keyboard;
	if (typeof keyboard?.getLayoutMap !== "function") return;
	try {
		const layout = keyboardLayoutFrom(await keyboard.getLayoutMap());
		setKeyboardLayout(layout);
		const signature = JSON.stringify(layout);
		if (signature === reported) return;
		reported = signature;
		await window.omp.prefs.setKeyboardLayout(layout);
	} catch {
		// No layout map: chords keep their US-layout key positions.
	}
}

export function startKeyboardLayoutSync(): void {
	void refreshKeyboardLayout();
	window.addEventListener("focus", () => void refreshKeyboardLayout());
	// Switching input source inside the app fires no event, so a modified keystroke
	// re-reads it; that keystroke itself still matches under the previous layout.
	window.addEventListener(
		"keydown",
		event => {
			if (event.metaKey || event.ctrlKey || event.altKey) void refreshKeyboardLayout();
		},
		true,
	);
}
