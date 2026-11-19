/** Session-owned references must never fall through to OS URL handlers. */
export function isSessionOutputPath(value: string): boolean {
	return /^(?:local|artifact):\/\//i.test(value);
}
