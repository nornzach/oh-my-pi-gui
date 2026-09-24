import { describe, expect, it } from "vitest";
import { bundledOmpFilename } from "./bundled-omp-path";

describe("bundledOmpFilename", () => {
	it("uses the host sidecar filename", () => {
		expect(bundledOmpFilename()).toBe(process.platform === "win32" ? "omp.exe" : "omp");
	});
});
