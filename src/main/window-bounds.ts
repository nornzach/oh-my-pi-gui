/**
 * Restored-window geometry guard. The saved rect comes from a session that may
 * have had different displays attached, so it can name a screen that no longer
 * exists — an app that "opens" as an unreachable rectangle off the edge.
 */

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Only the top strip matters: it carries the title bar the user drags by. */
const GRAB_BAND_HEIGHT = 28;
const MIN_GRAB_WIDTH = 60;

function intersects(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** True when enough of the window's title bar sits on some display to reach it. */
export function isReachable(rect: Rect, workAreas: Rect[]): boolean {
	const band: Rect = { x: rect.x, y: rect.y, width: rect.width, height: GRAB_BAND_HEIGHT };
	return workAreas.some(area => {
		const clipped: Rect = {
			x: Math.max(band.x, area.x),
			y: Math.max(band.y, area.y),
			width: Math.min(band.x + band.width, area.x + area.width) - Math.max(band.x, area.x),
			height: Math.min(band.y + band.height, area.y + area.height) - Math.max(band.y, area.y),
		};
		return clipped.width >= MIN_GRAB_WIDTH && clipped.height > 0 && intersects(band, area);
	});
}

/**
 * Keep `rect` where it was when its title bar is on a screen, otherwise place it
 * centred on the fallback display (never resized — a window the user stretched
 * across two monitors should come back that way when both are attached again).
 */
export function restoreWithinDisplays(rect: Rect, workAreas: Rect[]): Rect {
	if (workAreas.length === 0 || isReachable(rect, workAreas)) return rect;
	const area = workAreas[0];
	const width = Math.min(rect.width, Math.max(area.width - 40, 1));
	const height = Math.min(rect.height, Math.max(area.height - 40, 1));
	return {
		x: Math.round(area.x + (area.width - width) / 2),
		y: Math.round(area.y + (area.height - height) / 2),
		width,
		height,
	};
}
