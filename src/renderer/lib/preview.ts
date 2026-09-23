/**
 * Shared preview ceilings for tool renderers and transcript cards.
 *
 * Every bounded output surface picks one of these tiers instead of inventing
 * its own max-h-* — heights stay consistent across cards and a global tweak
 * lands in one place. Pair the scroll tiers with the matching content cap.
 */

/** Heights only, for surfaces that clip rather than scroll (images, code
 *  cells that bring their own overflow). */
export const PREVIEW_HEIGHT_MD = "max-h-64";
export const PREVIEW_HEIGHT_LG = "max-h-72";

/** Short outputs: status lines, small JSON, error text (160px). */
export const PREVIEW_SCROLL_SM = "max-h-40 overflow-auto";
/** Medium outputs: command output, match lists, code cells (256px). */
export const PREVIEW_SCROLL_MD = `${PREVIEW_HEIGHT_MD} overflow-auto`;
/** Tall previews: file contents, diffs, read results (288px). */
export const PREVIEW_SCROLL_LG = `${PREVIEW_HEIGHT_LG} overflow-auto`;
/** Markdown code fences in assistant prose — taller, code is the content (416px). */
export const PREVIEW_SCROLL_CODE = "max-h-[26rem] overflow-auto";

/** Lines of file content the read renderer shows before the "+N more" note. */
export const READ_PREVIEW_LINES = 50;
/** Match lines rendered per grep card before the truncation note takes over. */
export const GREP_PREVIEW_MATCHES = 200;
/** Paths listed per glob card. */
export const GLOB_PREVIEW_PATHS = 300;
/** Maximum characters inserted into any line-bounded text preview. */
export const PREVIEW_TEXT_CHARS = 20_000;
