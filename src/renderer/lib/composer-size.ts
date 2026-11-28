export const composerSizes = {
	composerRows: { min: 1, max: 6, step: 1, initial: 1 },
	composerFontScale: { min: 80, max: 160, step: 10, initial: 100 },
} as const;

export type ComposerSizeKey = keyof typeof composerSizes;

export function validComposerSize(key: ComposerSizeKey, value: unknown): value is number {
	const { min, max, step } = composerSizes[key];
	return typeof value === "number" && value >= min && value <= max && (value - min) % step === 0;
}
