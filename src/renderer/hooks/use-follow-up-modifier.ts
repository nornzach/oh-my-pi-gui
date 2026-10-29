import { useEffect, useState } from "react";
import { isFollowUpSend } from "../lib/keymap";

/**
 * Whether the follow-up modifier is held right now (`isFollowUpSend`), while
 * `active`. Every key event re-reads the modifier flags, so a release anywhere
 * in the window clears it; leaving the window clears it too, since that
 * release is never seen.
 */
export function useFollowUpModifierHeld(active: boolean): boolean {
	const [held, setHeld] = useState(false);
	useEffect(() => {
		if (!active) {
			setHeld(false);
			return;
		}
		const sync = (event: KeyboardEvent) => setHeld(isFollowUpSend(event));
		const release = () => setHeld(false);
		window.addEventListener("keydown", sync, true);
		window.addEventListener("keyup", sync, true);
		window.addEventListener("blur", release);
		return () => {
			window.removeEventListener("keydown", sync, true);
			window.removeEventListener("keyup", sync, true);
			window.removeEventListener("blur", release);
		};
	}, [active]);
	return held;
}
