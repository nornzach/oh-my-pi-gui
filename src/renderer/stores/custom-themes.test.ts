import { afterEach, expect, it, vi } from "vitest";
import type { IpcCustomThemes } from "../../shared/ipc-types";
import { setCustomThemes } from "../lib/themes";
import { initCustomThemes, useCustomThemesStore } from "./custom-themes";

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
