import { afterEach, expect, it, vi } from "vitest";
import type { IpcCustomThemes } from "../../shared/ipc-types";
import { customTheme, setCustomThemes } from "../lib/themes";
import { initCustomThemes, loadCustomThemes, useCustomThemesStore } from "./custom-themes";

afterEach(() => {
	useCustomThemesStore.getState().reset();
	setCustomThemes(new Map());
	vi.unstubAllGlobals();
});

it("keeps a change pushed while the first read is still out", async () => {
	const read = Promise.withResolvers<IpcCustomThemes>();
	let push: (themes: IpcCustomThemes) => void = () => {};
	vi.stubGlobal("window", {
		omp: {
			themes: {
				list: () => read.promise,
				onChanged: (callback: (themes: IpcCustomThemes) => void) => {
					push = callback;
					return () => {};
				},
			},
		},
	});
	initCustomThemes();
	push({ dir: "/themes", files: [{ id: "midnight", fileName: "midnight.json", data: { extends: "nord" } }] });
	read.resolve({ dir: "/themes", files: [] });
	await read.promise;
	await Promise.resolve();

	expect(useCustomThemesStore.getState().entries.map(entry => entry.selection)).toEqual(["custom:midnight"]);
});

it("keeps a theme's last working version while its file is broken, and drops it with the file", () => {
	const file = { id: "midnight", fileName: "midnight.json" };
	loadCustomThemes({ dir: "/themes", files: [{ ...file, data: { tokens: { accent: "#111111" } } }] });
	loadCustomThemes({ dir: "/themes", files: [{ ...file, error: "Unexpected token } in JSON" }] });

	expect(customTheme("custom:midnight")?.tokens["--omp-accent"]).toBe("#111111");
	expect(useCustomThemesStore.getState().entries.map(entry => entry.problem)).toEqual(["unreadable"]);

	loadCustomThemes({ dir: "/themes", files: [] });
	expect(customTheme("custom:midnight")).toBeUndefined();
});
