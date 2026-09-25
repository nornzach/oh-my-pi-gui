import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type ElectronApplication, _electron as electron } from "playwright";
import type { SettingEntry, SettingsSchemaResult } from "../src/shared/rpc-types";

type JsonRecord = Record<string, unknown>;

interface SettingAuditRow {
	path: string;
	type: SettingEntry["type"];
	tab?: string;
	condition?: string;
	tuiOnly: boolean;
	restartRequired: boolean;
	secret: boolean;
	initial: unknown;
	rowFound: boolean;
	control: {
		buttons: string[];
		inputs: Array<{ type: string; value: string; ariaLabel: string | null }>;
		selects: Array<{ value: string; optionCount: number; ariaLabel: string | null }>;
		textareas: number;
	};
	visibility:
		| "visible"
		| "advanced"
		| "hidden-by-condition"
		| "filtered-tui-only"
		| "filtered-terminal-only"
		| "no-gui-metadata";
	write: "passed" | "skipped-secret" | "skipped-unsafe" | "skipped-no-control" | "failed" | "not-run";
	readback: "passed" | "not-run" | "failed";
	restore: "passed" | "rpc-fallback" | "not-run" | "failed";
	initialAfter?: unknown;
	changedTo?: unknown;
	readbackValue?: unknown;
	error?: string;
	notes: string[];
}

interface SurfaceControl {
	page: string;
	kind: string;
	name: string;
	disabled: boolean;
	role: string | null;
	selectorHint: string;
}

interface DeepAuditEvidence {
	startedAt: string;
	finishedAt?: string;
	profile: string;
	runtime: JsonRecord;
	schema: { entryCount: number; tabCount: number; entriesWithUi: number; advanced: number; tuiOnly: number };
	settingsPages: Array<{ group: string; page: string; controls: SurfaceControl[] }>;
	settings: SettingAuditRow[];
	commands: {
		availableCount: number;
		names: string[];
		paletteTopLevelCount: number;
		paletteSearchMissing: string[];
		tuiOnlyNames: string[];
		nestedSurfaces: Array<{ name: string; controls: SurfaceControl[]; status: "opened" | "failed"; error?: string }>;
		error?: string;
	};
	limitations: string[];
}

const TERMINAL_DISPLAY_PATHS = new Set([
	"tui.resizeScrollback",
	"statusLine.preset",
	"display.showTurnTime",
	"theme.dark",
	"theme.light",
	"tui.tight",
	"colorBlindMode",
	"hideThinkingBlock",
	"proseOnlyThinking",
	"display.showTokenUsage",
	"display.collapseCompacted",
	"tui.titleState",
	"goal.statusInFooter",
	"terminal.showProgress",
	"emojiAutocomplete",
	"paste.largeMenuThreshold",
	"spelling.typoDetection",
	"spelling.autocomplete",
	"spelling.autocorrect",
	"tui.vimModeDisplay",
	"tui.mouse",
	"tui.maxInlineImageColumns",
	"tui.maxInlineImageRows",
	"tui.maxInlineImages",
	"statusLine.leftSegments",
	"statusLine.rightSegments",
	"statusLine.segmentOptions",
]);

function settingRow(page: Page, pathName: string): Locator {
	return page.locator(`#setting-${pathName.replaceAll(".", "\\.")}`);
}

async function readSetting(page: Page, pathName: string): Promise<unknown> {
	const response = await page.evaluate(async pathValue => window.omp.rpc.getSettings([pathValue]), pathName);
	if (!response.success) throw new Error(response.error);
	return (response.data as { values?: JsonRecord } | undefined)?.values?.[pathName];
}

async function writeSetting(page: Page, pathName: string, value: unknown): Promise<JsonRecord> {
	const response = await page.evaluate(async ({ pathValue, next }) => window.omp.rpc.setSetting(pathValue, next), {
		pathValue: pathName,
		next: value,
	});
	if (!response.success) throw new Error(response.error);
	return (response.data as JsonRecord | undefined) ?? {};
}

async function pollSetting(page: Page, pathName: string, expected: unknown): Promise<unknown> {
	await expect.poll(async () => readSetting(page, pathName), { timeout: 8_000 }).toEqual(expected);
	return readSetting(page, pathName);
}

async function restoreInitial(page: Page, pathName: string, initial: unknown): Promise<"passed"> {
	if (initial === undefined) {
		const reset = settingRow(page, pathName).getByRole("button", { name: "Remove global override", exact: true });
		await expect(reset).toBeVisible();
		await expect(reset).toBeEnabled();
		await reset.click();
		await pollSetting(page, pathName, undefined);
	}
	return "passed";
}

async function inspectRow(row: Locator): Promise<SettingAuditRow["control"]> {
	return row.evaluate(element => ({
		buttons: Array.from(element.querySelectorAll("button")).map(
			button => button.getAttribute("aria-label") ?? button.innerText.trim(),
		),
		inputs: Array.from(element.querySelectorAll("input")).map(input => ({
			type: input.type,
			value: input.value,
			ariaLabel: input.getAttribute("aria-label"),
		})),
		selects: Array.from(element.querySelectorAll("select")).map(select => ({
			value: select.value,
			optionCount: select.options.length,
			ariaLabel: select.getAttribute("aria-label"),
		})),
		textareas: element.querySelectorAll("textarea").length,
	}));
}

function equalJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function alternateOption(entry: SettingEntry, value: unknown): unknown {
	const options = entry.options ?? [];
	const current = typeof value === "string" || typeof value === "number" ? String(value) : "";
	const alternate = options.find(option => option.value !== current);
	if (!alternate) return undefined;
	if (entry.type === "number") return Number(alternate.value);
	return alternate.value;
}

function alternateNumber(input: {
	value: string;
	min: string | null;
	max: string | null;
	step: string | null;
}): number | undefined {
	const current = Number(input.value);
	const min = input.min === null || input.min === "" ? Number.NEGATIVE_INFINITY : Number(input.min);
	const max = input.max === null || input.max === "" ? Number.POSITIVE_INFINITY : Number(input.max);
	const step =
		input.step === null || input.step === "" || input.step === "any" ? 1 : Math.abs(Number(input.step)) || 1;
	const candidates = [current + step, current - step, 1, 0];
	return candidates.find(
		candidate => Number.isFinite(candidate) && candidate >= min && candidate <= max && candidate !== current,
	);
}

function safeStringValue(entry: SettingEntry, profile: string): string {
	if (entry.path.includes("Url") || entry.path.toLowerCase().includes("url")) return "http://127.0.0.1:9/gui-audit";
	if (entry.path.toLowerCase().includes("path") || entry.path.includes("directory")) return profile;
	if (entry.path.includes("interpreter")) return "/usr/bin/python3";
	return `__gui_audit__${entry.path.replaceAll(".", "_")}`;
}

function isUnsafeString(entry: SettingEntry): boolean {
	return entry.secret === true || entry.path === "images.urls.command" || entry.path === "collab.relayUrl";
}

function conditionGate(condition: string | undefined): Array<{ path: string; value: unknown }> {
	const gates: Record<string, Array<{ path: string; value: unknown }>> = {
		advisorEnabled: [{ path: "advisor.enabled", value: true }],
		hindsightActive: [{ path: "memory.backend", value: "hindsight" }],
		mnemopiActive: [{ path: "memory.backend", value: "mnemopi" }],
		autolearnActive: [{ path: "autolearn.enabled", value: true }],
		autoThinkingActive: [{ path: "defaultThinkingLevel", value: "auto" }],
		usageAwareFallbackEnabled: [{ path: "retry.usageAwareFallback", value: true }],
		planModeEnabled: [{ path: "plan.enabled", value: true }],
		planAutosaveEnabled: [
			{ path: "plan.enabled", value: true },
			{ path: "plan.autosave", value: true },
		],
		unexpectedStopDetection: [{ path: "features.unexpectedStopDetection", value: true }],
	};
	return condition === undefined ? [] : (gates[condition] ?? []);
}

async function clickSearchResult(page: Page, pathName: string): Promise<boolean> {
	const search = page.getByPlaceholder(/Search settings|搜索设置/);
	await search.fill(pathName);
	const exact = page.getByText(pathName, { exact: true });
	if ((await exact.count()) === 0) return false;
	await exact.last().click();
	return true;
}

async function captureSurfaceControls(page: Page, pageName: string): Promise<SurfaceControl[]> {
	return page
		.locator(
			".settings-content button, .settings-content input, .settings-content select, .settings-content textarea",
		)
		.evaluateAll(
			(elements, currentPage) =>
				elements.map((element, index) => ({
					page: currentPage,
					kind: element.tagName.toLowerCase(),
					name:
						element.getAttribute("aria-label") ??
						(element instanceof HTMLInputElement && element.placeholder ? element.placeholder : null) ??
						element.textContent?.trim() ??
						"",
					disabled:
						element instanceof HTMLButtonElement ||
						element instanceof HTMLInputElement ||
						element instanceof HTMLSelectElement ||
						element instanceof HTMLTextAreaElement
							? element.disabled
							: element.hasAttribute("disabled"),
					role: element.getAttribute("role"),
					selectorHint: `${element.tagName.toLowerCase()}[data-audit-index="${index}"]`,
				})),
			pageName,
		);
}

async function mutateEntry(
	page: Page,
	row: Locator,
	entry: SettingEntry,
	initial: unknown,
	profile: string,
): Promise<
	Pick<SettingAuditRow, "write" | "readback" | "restore" | "changedTo" | "readbackValue" | "error" | "notes">
> {
	const notes: string[] = [];
	if (entry.secret === true) {
		const reveal = row.getByRole("button", { name: /Reveal|显示/ });
		if ((await reveal.count()) > 0) {
			await reveal.click();
			notes.push("secret reveal control opened; value was not written");
		}
		return { write: "skipped-secret", readback: "not-run", restore: "not-run", notes };
	}
	if (isUnsafeString(entry)) {
		return {
			write: "skipped-unsafe",
			readback: "not-run",
			restore: "not-run",
			notes: ["write skipped to avoid starting an external uploader/relay from an audit run"],
		};
	}
	try {
		if (entry.type === "boolean") {
			const toggle = row.locator('button[role="switch"]').first();
			if ((await toggle.count()) === 0)
				return { write: "skipped-no-control", readback: "not-run", restore: "not-run", notes };
			const next = initial !== true;
			await toggle.click();
			const readbackValue = await pollSetting(page, entry.path, next);
			if (initial === undefined) {
				const restore = await restoreInitial(page, entry.path, initial);
				return { write: "passed", readback: "passed", restore, changedTo: next, readbackValue, notes };
			}
			await toggle.click();
			await pollSetting(page, entry.path, initial);
			return { write: "passed", readback: "passed", restore: "passed", changedTo: next, readbackValue, notes };
		}

		const select = row.locator("select").first();
		if (
			entry.type === "enum" ||
			(entry.type === "number" && entry.options && entry.options.length > 0 && (await select.count()) > 0)
		) {
			const next = alternateOption(entry, initial);
			if (next === undefined) return { write: "skipped-no-control", readback: "not-run", restore: "not-run", notes };
			await select.selectOption(String(next));
			const readbackValue = await pollSetting(page, entry.path, next);
			if (initial === undefined) {
				const restore = await restoreInitial(page, entry.path, initial);
				return { write: "passed", readback: "passed", restore, changedTo: next, readbackValue, notes };
			}
			await select.selectOption(initial === undefined ? "" : String(initial));
			await pollSetting(page, entry.path, initial);
			return { write: "passed", readback: "passed", restore: "passed", changedTo: next, readbackValue, notes };
		}

		if (entry.type === "number") {
			const input = row.locator('input[type="number"], input[inputmode="numeric"]').first();
			if ((await input.count()) === 0)
				return { write: "skipped-no-control", readback: "not-run", restore: "not-run", notes };
			const metadata = await input.evaluate(element => ({
				value: (element as HTMLInputElement).value,
				min: element.getAttribute("min"),
				max: element.getAttribute("max"),
				step: element.getAttribute("step"),
			}));
			const next = alternateNumber(metadata);
			if (next === undefined) return { write: "skipped-no-control", readback: "not-run", restore: "not-run", notes };
			await input.fill(String(next));
			await input.press("Enter");
			const readbackValue = await pollSetting(page, entry.path, next);
			if (initial === undefined) {
				const restore = await restoreInitial(page, entry.path, initial);
				return { write: "passed", readback: "passed", restore, changedTo: next, readbackValue, notes };
			}
			await input.fill(String(initial));
			await input.press("Enter");
			await pollSetting(page, entry.path, initial);
			return { write: "passed", readback: "passed", restore: "passed", changedTo: next, readbackValue, notes };
		}

		if (entry.type === "string") {
			// Model/provider references use the searchable picker, which supports a
			// custom value even when the isolated audit profile has no catalog rows.
			if (/(model|provider)$/i.test(entry.path) || entry.path === "shellPath") {
				const trigger = row.locator('button[aria-haspopup="listbox"]').first();
				if ((await trigger.count()) > 0) {
					const marker =
						entry.path === "shellPath" ? "/bin/sh" : `__gui_audit__/${entry.path.replaceAll(".", "_")}`;
					await trigger.click();
					const pickerInput = row.locator("input").last();
					await expect(pickerInput).toBeVisible();
					if ((await pickerInput.count()) > 0) {
						await pickerInput.fill(marker);
						const custom = row.locator('[role="listbox"] button').filter({ hasText: marker });
						await expect(custom.last()).toBeVisible();
						if ((await custom.count()) > 0) {
							await custom.last().click();
							const readbackValue = await pollSetting(page, entry.path, marker);
							if (initial === undefined) {
								const restore = await restoreInitial(page, entry.path, initial);
								return {
									write: "passed",
									readback: "passed",
									restore,
									changedTo: marker,
									readbackValue,
									notes,
								};
							}
							await trigger.click();
							if (initial === "") {
								await row.getByRole("button", { name: /Clear|清除/ }).click();
							} else {
								await pickerInput.fill(String(initial));
								await row
									.locator('[role="listbox"] button')
									.filter({ hasText: String(initial) })
									.last()
									.click();
							}
							await pollSetting(page, entry.path, initial == null ? "" : initial);
							return {
								write: "passed",
								readback: "passed",
								restore: "passed",
								changedTo: marker,
								readbackValue,
								notes,
							};
						}
					}
					await page.keyboard.press("Escape");
				}
			}
			const input = row.locator("input, textarea").first();
			if ((await input.count()) === 0)
				return { write: "skipped-no-control", readback: "not-run", restore: "not-run", notes };
			const next = safeStringValue(entry, profile);
			await input.fill(next);
			await input.press("Enter").catch(() => input.blur());
			const readbackValue = await pollSetting(page, entry.path, next);
			const restore = await restoreInitial(page, entry.path, initial);
			if (initial === undefined)
				return { write: "passed", readback: "passed", restore, changedTo: next, readbackValue, notes };
			await input.fill(initial == null ? "" : String(initial));
			await input.press("Enter").catch(() => input.blur());
			await pollSetting(page, entry.path, initial == null ? "" : initial);
			return { write: "passed", readback: "passed", restore: "passed", changedTo: next, readbackValue, notes };
		}

		if (entry.type === "array") {
			const input = row.locator("input").first();
			const selectControl = row.locator("select").first();
			const textarea = row.locator("textarea").first();
			if ((await textarea.count()) > 0) {
				const changed =
					entry.path === "bash.patterns"
						? [{ match: "echo gui-audit-block", approval: "deny" }]
						: ["__gui_audit__"];
				await textarea.fill(JSON.stringify(changed, null, 2));
				await row.getByRole("button", { name: /Apply|应用/ }).click();
				const readbackValue = await pollSetting(page, entry.path, changed);
				await textarea.fill(JSON.stringify(initial ?? [], null, 2));
				await row.getByRole("button", { name: /Apply|应用/ }).click();
				await pollSetting(page, entry.path, initial ?? []);
				return { write: "passed", readback: "passed", restore: "passed", changedTo: changed, readbackValue, notes };
			}
			if (Array.isArray(initial) && initial.length > 0) {
				const first = String(initial[0]);
				const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const remove = row.getByRole("button", { name: new RegExp(`Remove ${escaped}`) }).first();
				if ((await remove.count()) > 0) {
					await remove.click();
					const changed = initial.slice(1);
					await pollSetting(page, entry.path, changed);
					// Chip editors append new values, so adding the removed first chip
					// back would change an ordered list. Restore the exact order through
					// the same RPC used by the row after proving the UI removal/readback.
					await writeSetting(page, entry.path, initial);
					await pollSetting(page, entry.path, initial);
					return {
						write: "passed",
						readback: "passed",
						restore: "rpc-fallback",
						changedTo: changed,
						readbackValue: changed,
						notes: ["restore used RPC to preserve ordered chip position"],
					};
				}
			}
			const down = row.getByRole("button", { name: /Move .* down|下移/ }).first();
			if ((await down.count()) > 0 && !(await down.isDisabled()) && Array.isArray(initial) && initial.length > 1) {
				const changed = [...initial];
				[changed[0], changed[1]] = [changed[1], changed[0]];
				await down.click();
				const readbackValue = await pollSetting(page, entry.path, changed);
				const up = row.getByRole("button", { name: new RegExp(`Move ${String(changed[1])} up|上移`) }).first();
				if ((await up.count()) > 0) await up.click();
				else await writeSetting(page, entry.path, initial);
				await pollSetting(page, entry.path, initial);
				return { write: "passed", readback: "passed", restore: "passed", changedTo: changed, readbackValue, notes };
			}
			if ((await selectControl.count()) > 0 && !(await selectControl.isDisabled())) {
				const options = await selectControl
					.locator("option")
					.evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
				const current = Array.isArray(initial) ? initial.map(value => String(value)) : [];
				const next = options.find(option => !current.includes(option));
				if (!next)
					return {
						write: "skipped-no-control",
						readback: "not-run",
						restore: "not-run",
						notes: ["ordered/fixed options already exhausted"],
					};
				await selectControl.selectOption(next);
				const changed = [...current, next];
				const readbackValue = await pollSetting(page, entry.path, changed);
				await writeSetting(page, entry.path, initial);
				await pollSetting(page, entry.path, initial);
				return {
					write: "passed",
					readback: "passed",
					restore: "rpc-fallback",
					changedTo: changed,
					readbackValue,
					notes: ["restore used RPC because the chip remove label is localized"],
				};
			}
			if ((await input.count()) > 0) {
				const marker = `__gui_audit__${entry.path.replaceAll(".", "_")}`;
				await input.fill(marker);
				await input.press("Enter");
				const changed = [...(Array.isArray(initial) ? initial : []), marker];
				const readbackValue = await pollSetting(page, entry.path, changed);
				const remove = row.getByRole("button", { name: new RegExp(marker) });
				if ((await remove.count()) > 0) {
					await remove.click();
					await pollSetting(page, entry.path, initial);
					return {
						write: "passed",
						readback: "passed",
						restore: "passed",
						changedTo: changed,
						readbackValue,
						notes,
					};
				}
				await writeSetting(page, entry.path, initial);
				await pollSetting(page, entry.path, initial);
				return {
					write: "passed",
					readback: "passed",
					restore: "rpc-fallback",
					changedTo: changed,
					readbackValue,
					notes,
				};
			}
		}

		if (entry.type === "record") {
			const textarea = row.locator("textarea").first();
			if ((await textarea.count()) > 0) {
				const changed = {
					...(initial && typeof initial === "object" && !Array.isArray(initial) ? initial : {}),
					__gui_audit__: "ok",
				};
				await textarea.fill(JSON.stringify(changed, null, 2));
				const apply = row.getByRole("button", { name: /Apply|应用/ });
				await apply.click();
				const readbackValue = await pollSetting(page, entry.path, changed);
				await textarea.fill(JSON.stringify(initial ?? {}, null, 2));
				await apply.click();
				await pollSetting(page, entry.path, initial ?? {});
				return { write: "passed", readback: "passed", restore: "passed", changedTo: changed, readbackValue, notes };
			}
			if (entry.path === "providers.maxInFlightRequests") {
				const trigger = row.getByRole("button", { name: /Add provider|添加提供商/ }).first();
				if ((await trigger.count()) > 0) {
					const marker = "__gui_audit_provider__";
					await trigger.click();
					const pickerInput = row.locator("input").last();
					await expect(pickerInput).toBeVisible();
					if ((await pickerInput.count()) > 0) {
						await pickerInput.fill(marker);
						const custom = row.getByRole("button", { name: new RegExp(marker) });
						await expect(custom.last()).toBeVisible();
						if ((await custom.count()) > 0) {
							await custom.last().click();
							const changed = { [marker]: 1 };
							const readbackValue = await pollSetting(page, entry.path, changed);
							const remove = row.getByRole("button", { name: /Remove|移除/ }).last();
							if ((await remove.count()) > 0) await remove.click();
							else await writeSetting(page, entry.path, initial ?? {});
							await pollSetting(page, entry.path, initial ?? {});
							return {
								write: "passed",
								readback: "passed",
								restore: "passed",
								changedTo: changed,
								readbackValue,
								notes,
							};
						}
					}
					await page.keyboard.press("Escape");
				}
			}
			const add = row.getByRole("button", { name: /Add|添加/ }).first();
			if ((await add.count()) > 0) {
				await add.click();
				const changed = await readSetting(page, entry.path);
				if (!changed || typeof changed !== "object" || Array.isArray(changed) || equalJson(changed, initial)) {
					await page.keyboard.press("Escape");
					return {
						write: "skipped-no-control",
						readback: "not-run",
						restore: "not-run",
						notes: ["record editor has no available provider/key option"],
					};
				}
				const readbackValue = changed;
				await writeSetting(page, entry.path, initial ?? {});
				await pollSetting(page, entry.path, initial ?? {});
				return {
					write: "passed",
					readback: "passed",
					restore: "rpc-fallback",
					changedTo: changed,
					readbackValue,
					notes: ["record editor restore used RPC"],
				};
			}
		}
		return { write: "skipped-no-control", readback: "not-run", restore: "not-run", notes };
	} catch (error) {
		return { write: "failed", readback: "failed", restore: "failed", error: String(error), notes };
	}
}

async function launchAuditApp(
	profile: string,
	project: string,
	desktop: string,
	agent: string,
): Promise<ElectronApplication> {
	await fs.writeFile(
		path.join(desktop, "prefs.json"),
		JSON.stringify({
			language: "en",
			firstRunComplete: true,
			launchProfiles: { [project]: { noRules: true, noLsp: true } },
		}),
	);
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: agent,
		PI_CONFIG_DIR: path.relative(os.homedir(), profile),
		OMP_PROFILE: "",
		PI_PROFILE: "",
		OMP_BUNDLED_OMP: path.resolve("resources/omp"),
	};
	Reflect.deleteProperty(env, "ELECTRON_RUN_AS_NODE");
	Reflect.deleteProperty(env, "OMP_SIDECAR");
	return electron.launch({
		args: [path.resolve("out/main/index.js"), project, `--user-data-dir=${desktop}`],
		env,
	});
}

test("deep GUI audit: settings rows, nested controls, and command discoverability", async () => {
	test.setTimeout(600_000);
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-deep-audit-"));
	const project = path.join(profile, "project");
	const desktop = path.join(profile, "desktop");
	const agent = path.join(profile, "agent");
	await Promise.all([fs.mkdir(project), fs.mkdir(desktop), fs.mkdir(agent)]);
	await fs.writeFile(path.join(project, "README.md"), "# GUI deep audit\n");
	const evidence: DeepAuditEvidence = {
		startedAt: new Date().toISOString(),
		profile,
		runtime: {},
		schema: { entryCount: 0, tabCount: 0, entriesWithUi: 0, advanced: 0, tuiOnly: 0 },
		settingsPages: [],
		settings: [],
		commands: {
			availableCount: 0,
			names: [],
			paletteTopLevelCount: 0,
			paletteSearchMissing: [],
			tuiOnlyNames: [],
			nestedSurfaces: [],
		},
		limitations: [
			"Runtime effect is classified as readback unless a separate consumer state is exposed by RPC; no provider/network command is executed.",
			"Destructive/external actions (delete, upload, login, publish, PR mutation) are enumerated but never confirmed in an audit profile.",
		],
	};
	let app: ElectronApplication | null = null;
	try {
		app = await launchAuditApp(profile, project, desktop, agent);
		const page = await app.firstWindow();
		await expect
			.poll(async () => (await page.evaluate(() => window.omp.sidecar.getStatus())).status, { timeout: 90_000 })
			.toBe("ready");
		evidence.runtime = await app.evaluate(({ app }) => ({
			isPackaged: app.isPackaged,
			appPath: app.getAppPath(),
			resourcesPath: process.resourcesPath,
			sidecarOverride: process.env.OMP_BUNDLED_OMP ?? null,
		}));

		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(settings).toBeVisible();
		await expect(settings.locator(".settings-nav-group-label").first()).toBeVisible();
		const schemaResponse = await page.evaluate(() => window.omp.rpc.getSettingsSchema());
		if (!schemaResponse.success) throw new Error(schemaResponse.error);
		const schema = schemaResponse.data as SettingsSchemaResult;
		const settingsResponse = await page.evaluate(() => window.omp.rpc.getSettings());
		if (!settingsResponse.success) throw new Error(settingsResponse.error);
		const currentValues = ((settingsResponse.data as { values?: JsonRecord } | undefined)?.values ??
			{}) as JsonRecord;
		evidence.schema = {
			entryCount: schema.entries.length,
			tabCount: schema.tabs.length,
			entriesWithUi: schema.entries.filter(entry => entry.tab !== undefined).length,
			advanced: schema.entries.filter(entry => entry.tab === undefined).length,
			tuiOnly: schema.entries.filter(entry => entry.tuiOnly === true).length,
		};

		// Capture every settings page and every rendered control before mutating values.
		const groupButtons = settings.locator(".settings-nav-group-label");
		for (let groupIndex = 0; groupIndex < (await groupButtons.count()); groupIndex++) {
			await groupButtons.nth(groupIndex).click();
			const groupName = await groupButtons.nth(groupIndex).innerText();
			const pages = settings.locator(".settings-nav-item");
			for (let pageIndex = 0; pageIndex < (await pages.count()); pageIndex++) {
				const nav = pages.nth(pageIndex);
				const pageName = await nav.innerText();
				await nav.click();
				await expect(settings.locator(".settings-content .animate-spin")).toHaveCount(0, { timeout: 30_000 });
				evidence.settingsPages.push({
					group: groupName,
					page: pageName,
					controls: await captureSurfaceControls(page, pageName),
				});
			}
		}

		// Exercise every schema entry that the GUI claims to support. TUI-only and
		// metadata-less entries remain explicit rows in the matrix instead of being silently dropped.
		for (const entry of schema.entries) {
			let initial = currentValues[entry.path] ?? entry.value;
			const isTuiOnly = entry.tuiOnly === true;
			const isTerminalOnly = TERMINAL_DISPLAY_PATHS.has(entry.path);
			if (initial === undefined && !isTuiOnly && !isTerminalOnly) {
				initial = await readSetting(page, entry.path);
				initial ??= entry.default;
			}
			const base: SettingAuditRow = {
				path: entry.path,
				type: entry.type,
				tab: entry.tab,
				condition: entry.condition,
				tuiOnly: isTuiOnly,
				restartRequired: entry.restartRequired === true,
				secret: entry.secret === true,
				initial,
				rowFound: false,
				control: { buttons: [], inputs: [], selects: [], textareas: 0 },
				visibility: isTuiOnly
					? "filtered-tui-only"
					: isTerminalOnly
						? "filtered-terminal-only"
						: entry.tab
							? "hidden-by-condition"
							: "advanced",
				write: "not-run",
				readback: "not-run",
				restore: "not-run",
				notes: [],
			};
			if (base.visibility === "filtered-tui-only" || base.visibility === "filtered-terminal-only") {
				await page.getByPlaceholder(/Search settings|搜索设置/).fill(entry.path);
				await expect(page.getByText(entry.path, { exact: true })).toHaveCount(0);
				base.notes.push("GUI search absence verified");
				evidence.settings.push(base);
				continue;
			}
			const gates = conditionGate(entry.condition);
			const gateOriginals: Array<{ path: string; value: unknown }> = [];
			try {
				for (const gate of gates) {
					const originalGate = await readSetting(page, gate.path);
					gateOriginals.push({ path: gate.path, value: originalGate });
					if (!equalJson(originalGate, gate.value)) {
						await writeSetting(page, gate.path, gate.value);
						await pollSetting(page, gate.path, gate.value);
					}
				}
				// Search drives the same locator path a user sees, after the condition
				// gate has been opened through the real settings RPC.
				const found = await clickSearchResult(page, entry.path);
				if (!found) {
					base.notes.push("not in GUI search results after enabling its condition gate");
					evidence.settings.push(base);
					continue;
				}
				const row = settingRow(page, entry.path);
				if ((await row.count()) === 0) {
					base.notes.push("search result did not resolve to a setting row");
					evidence.settings.push(base);
					continue;
				}
				await expect(row).toBeVisible();
				base.rowFound = true;
				base.visibility = "visible";
				base.control = await inspectRow(row);
				const result = await mutateEntry(page, row, entry, initial, profile);
				Object.assign(base, result);
				base.initialAfter = await readSetting(page, entry.path).catch(() => undefined);
				evidence.settings.push(base);
			} catch (error) {
				base.write = "failed";
				base.readback = "failed";
				base.restore = "failed";
				base.error = String(error);
				evidence.settings.push(base);
			} finally {
				for (const original of gateOriginals.reverse()) {
					if (!equalJson(await readSetting(page, original.path).catch(() => undefined), original.value)) {
						await writeSetting(page, original.path, original.value);
						await pollSetting(page, original.path, original.value).catch(() => {});
					}
				}
			}
		}

		// The command palette is the single discoverability surface for built-ins,
		// slash commands, and native actions. Search every advertised command without
		// executing it and retain the TUI-only negative contract.
		// The settings home also exposes the same live palette entry, so the
		// discoverability action is exercised through its second-level surface.
		await settings.getByLabel("Close").click();
		await expect(settings).toHaveCount(0);
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const capabilitiesSettings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(capabilitiesSettings).toBeVisible();
		const settingsCommandCenter = capabilitiesSettings.locator('[data-command-center-entry="true"]');
		await expect(settingsCommandCenter).toBeVisible();
		await settingsCommandCenter.click();
		await expect(settings).toHaveCount(0);
		await expect(page.getByRole("dialog")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.locator('button[data-command-center-entry="true"]').first().locator("kbd")).toContainText(
			"⌘K / ⌃K",
		);
		await page.locator('button[data-command-center-entry="true"]').first().click();
		const palette = page.getByRole("dialog");
		await expect(palette).toBeVisible();
		const search = palette.getByRole("textbox").first();
		const available = await page.evaluate(async () => window.omp.rpc.getAvailableCommands());
		if (available.success) {
			const commandEntries =
				(available.data as { commands?: Array<{ name: string; textModeExecutable?: boolean }> } | undefined)
					?.commands ?? [];
			const commands = commandEntries.map(command => command.name);
			evidence.commands.availableCount = commands.length;
			evidence.commands.names = commands;
			for (const { name, textModeExecutable } of commandEntries) {
				await search.fill(name);
				const exactMatch = () =>
					palette
						.locator("button[data-command-name]")
						.evaluateAll(
							(rows, command) =>
								rows.some(
									row =>
										row.getAttribute("data-command-name") === command ||
										(JSON.parse(row.getAttribute("data-command-aliases") ?? "[]") as string[]).includes(
											command,
										),
								),
							name,
						);
				if (textModeExecutable === false && !(await exactMatch())) {
					evidence.commands.tuiOnlyNames.push(name);
					continue;
				}
				try {
					await expect.poll(exactMatch, { timeout: 2_000 }).toBe(true);
				} catch {
					evidence.commands.paletteSearchMissing.push(name);
				}
			}
		} else {
			evidence.commands.error = available.error;
		}
		// Drill into every native submenu without executing its actions. This
		// verifies that nested command surfaces open and that their own controls
		// are rendered; destructive/external rows remain enumerated only.
		await search.fill("");
		await expect(palette.locator(".omp-command-list")).toBeVisible();
		evidence.commands.paletteTopLevelCount = await palette.locator("button[data-palette-index]").count();
		const submenuButtons = palette.locator('button[data-command-kind="submenu"]');
		const submenuCount = await submenuButtons.count();
		for (let index = 0; index < submenuCount; index++) {
			const button = palette.locator('button[data-command-kind="submenu"]').nth(index);
			const name = (await button.innerText()).replaceAll(/\s+/g, " ").trim();
			try {
				await button.click();
				const nestedRows = palette.locator("button[data-palette-index]");
				expect(await nestedRows.count(), `${name} did not render nested command rows`).toBeGreaterThan(0);
				await expect(palette.getByRole("textbox").first()).toBeVisible();
				evidence.commands.nestedSurfaces.push({
					name,
					status: "opened",
					controls: await palette.locator("button, input, select, textarea").evaluateAll(
						(elements, currentPage) =>
							elements.map((element, controlIndex) => ({
								page: currentPage,
								kind: element.tagName.toLowerCase(),
								name:
									element.getAttribute("aria-label") ??
									(element instanceof HTMLInputElement && element.placeholder ? element.placeholder : null) ??
									element.textContent?.trim() ??
									"",
								disabled:
									element instanceof HTMLButtonElement ||
									element instanceof HTMLInputElement ||
									element instanceof HTMLSelectElement ||
									element instanceof HTMLTextAreaElement
										? element.disabled
										: element.hasAttribute("disabled"),
								role: element.getAttribute("role"),
								selectorHint: `${element.tagName.toLowerCase()}[data-audit-index="${controlIndex}"]`,
							})),
						name,
					),
				});
			} catch (error) {
				evidence.commands.nestedSurfaces.push({ name, status: "failed", controls: [], error: String(error) });
			}
			await page.keyboard.press("Escape");
			await expect(palette.locator('button[data-command-kind="submenu"]')).toHaveCount(submenuCount);
		}
		await page.keyboard.press("Escape");
		evidence.finishedAt = new Date().toISOString();
		await fs.mkdir("test-results/deep-audit", { recursive: true });
		await fs.writeFile("test-results/deep-audit/evidence.json", JSON.stringify(evidence, null, 2));
		const failed = evidence.settings.filter(row => row.write === "failed");
		expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
		expect(evidence.commands.paletteSearchMissing, JSON.stringify(evidence.commands)).toEqual([]);
		expect(evidence.commands.nestedSurfaces.filter(surface => surface.status === "failed")).toEqual([]);
	} finally {
		evidence.finishedAt ??= new Date().toISOString();
		await fs.mkdir("test-results/deep-audit", { recursive: true });
		await fs.writeFile("test-results/deep-audit/evidence.json", JSON.stringify(evidence, null, 2));
		if (app) {
			await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
		}
		await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
	}
});
