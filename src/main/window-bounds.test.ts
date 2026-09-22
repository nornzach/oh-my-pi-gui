/**
 * restoreWithinDisplays contract: a saved geometry that names a display which is
 * gone must come back reachable, and one that is merely stretched across the
 * edge of a still-attached display must not move.
 */
import { describe, expect, it, test } from "vitest";
import { isReachable, type Rect, restoreWithinDisplays } from "./window-bounds";

const LAPTOP: Rect = { x: 0, y: 0, width: 1440, height: 900 };
const MONITOR: Rect = { x: 1440, y: 0, width: 2560, height: 1440 };

describe("window restore geometry", () => {
	test("recenters a window saved on a display that is no longer attached", () => {
		const saved: Rect = { x: 4200, y: 1600, width: 1200, height: 800 };
		const restored = restoreWithinDisplays(saved, [LAPTOP]);

		expect(restored).not.toEqual(saved);
		expect(isReachable(restored, [LAPTOP])).toBe(true);
		// Centered on the fallback display.
		expect(restored.x).toBe(Math.round((1440 - 1200) / 2));
		expect(restored.y).toBe(Math.round((900 - 800) / 2));
	});

	test("leaves a fully on-screen geometry untouched, position and size both", () => {
		const saved: Rect = { x: 120, y: 80, width: 1000, height: 700 };
		expect(restoreWithinDisplays(saved, [LAPTOP, MONITOR])).toEqual(saved);
	});

	it("keeps a window that hangs off one edge as long as its title bar is grabbable", () => {
		// 200px on screen at the right edge of the laptop, the rest off: still the
		// window the user left there, and it never resized on the way back.
		const stretched: Rect = { x: 1240, y: 40, width: 1200, height: 800 };
		expect(isReachable(stretched, [LAPTOP, MONITOR])).toBe(true);
		expect(restoreWithinDisplays(stretched, [LAPTOP, MONITOR])).toEqual(stretched);
	});

	it("fits a monitor-sized window to the only display left when recentering", () => {
		// The saved window spanned laptop + monitor; only the laptop remains, and
		// the monitor-sized rect is unreachable there.
		const wide: Rect = { x: 2600, y: 0, width: 2000, height: 1200 };
		const restored = restoreWithinDisplays(wide, [LAPTOP]);
		expect(isReachable(restored, [LAPTOP])).toBe(true);
		expect(restored.width).toBe(LAPTOP.width - 40);
		expect(restored.height).toBe(LAPTOP.height - 40);
	});

	test("a vertically off-screen window is pulled back below the menu bar", () => {
		const saved: Rect = { x: 200, y: -1400, width: 900, height: 600 };
		const restored = restoreWithinDisplays(saved, [LAPTOP]);
		expect(restored.y).toBeGreaterThanOrEqual(LAPTOP.y);
		expect(restored.y + 28).toBeLessThanOrEqual(LAPTOP.height);
	});
});
