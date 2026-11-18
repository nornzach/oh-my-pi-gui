import { afterEach, describe, expect, it } from "vitest";
import { hasUnsavedFileDrafts, setWindowFileDrafts } from "./file-draft-guard";

afterEach(() => {
	setWindowFileDrafts(1, false);
	setWindowFileDrafts(2, false);
});

describe("file draft close inventory", () => {
	it("keeps close checks window-local and quit checks app-wide", () => {
		setWindowFileDrafts(1, true);
		expect(hasUnsavedFileDrafts(1)).toBe(true);
		expect(hasUnsavedFileDrafts(2)).toBe(false);
		expect(hasUnsavedFileDrafts()).toBe(true);
	});

	it("continues to protect other windows after a file is saved or its window closes", () => {
		setWindowFileDrafts(1, true);
		setWindowFileDrafts(2, true);
		setWindowFileDrafts(1, false);
		expect(hasUnsavedFileDrafts(1)).toBe(false);
		expect(hasUnsavedFileDrafts()).toBe(true);
		setWindowFileDrafts(2, false);
		expect(hasUnsavedFileDrafts()).toBe(false);
	});
});
