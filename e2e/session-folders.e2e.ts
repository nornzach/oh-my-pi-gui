import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { type ElectronApplication, _electron as electron, type Locator, type Page } from "playwright";

const sharedTitle = "Release investigation";
const chatTitle = "Cross-workspace notes";

async function fixture(history = 0, useRealCore = false, missingModel = false) {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-folders-")));
	const desktop = path.join(root, "desktop");
	const agent = path.join(root, "agent");
	const release = path.join(root, "release-workspace");
	const notes = path.join(root, "notes-workspace");
	const gate = path.join(root, "finish-run");
	await Promise.all([desktop, release, notes].map(directory => fs.mkdir(directory)));
	await fs.writeFile(path.join(desktop, "prefs.json"), JSON.stringify({ language: "en", firstRunComplete: true }));
	const seed = async (title: string, cwd: string, id: string, kind: "agent" | "chat", text: string) => {
		const timestamp = new Date().toISOString();
		const dir = path.join(agent, "sessions", cwd.replace(/[^a-z0-9_-]/gi, "-"));
		const file = path.join(dir, `2026-11-28T00-00-00-000Z_${id}.jsonl`);
		await fs.mkdir(dir, { recursive: true });
		const slot = { type: "title", v: 1, title, updatedAt: timestamp, pad: "" };
		slot.pad = " ".repeat(255 - Buffer.byteLength(JSON.stringify(slot)));
		const lines = [
			slot,
			{ type: "session", version: 3, id, cwd, kind, timestamp },
			{
				type: "message",
				id: "seed",
				parentId: null,
				timestamp,
				message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
			},
		].map(entry => JSON.stringify(entry));
		await fs.writeFile(file, `${lines.join("\n")}\n`);
		return file;
	};
	const sharedFile = await seed(sharedTitle, release, "shared", "agent", "release-folder-search-marker");
	const chatFile = await seed(chatTitle, notes, "notes", "chat", "notes-folder-transcript-marker");
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: agent,
		PI_CONFIG_DIR: path.relative(os.homedir(), root),
		OMP_DAEMON_DIR: path.join(root, "daemon"),
		OMP_PROFILE: "",
		PI_PROFILE: "",
		OMP_BUNDLED_OMP: path.resolve(useRealCore ? "resources/omp" : "e2e/sidecar-fixture.ts"),
		OMP_GUI_TEST_FOLDER_GATE: gate,
		OMP_GUI_TEST_HISTORY: String(history),
		...(missingModel
			? {
					OMP_GUI_TEST_RESTORE: sharedFile,
					OMP_GUI_TEST_NO_DEFAULT_MODEL: "1",
					OMP_GUI_TEST_RECORD: path.join(root, "commands.jsonl"),
				}
			: {}),
	};
	Reflect.deleteProperty(env, "ELECTRON_RUN_AS_NODE");
	Reflect.deleteProperty(env, "OMP_SIDECAR");
	const launch = (restore = false) =>
		electron.launch({
			args: [path.resolve("out/main/index.js"), ...(restore ? [] : [release]), `--user-data-dir=${desktop}`],
			env,
		});
	return { root, gate, sharedFile, chatFile, launch };
}

const tree = (page: Page) => page.getByRole("region", { name: "Session folders" });
const tabs = (page: Page) => page.getByRole("tablist", { name: "Session tabs" }).getByRole("tab");
const row = (page: Page, title: string) => page.locator(".omp-sidebar-list").getByText(title, { exact: true });
const input = (page: Page) => page.getByRole("textbox", { name: /Ask omp/ });

async function ready(page: Page) {
	await expect.poll(async () => (await page.evaluate(() => window.omp.sidecar.getStatus())).status).toBe("ready");
}

async function quitForRestore(application: ElectronApplication) {
	const stopped = application.waitForEvent("close");
	await application.evaluate(({ app, BrowserWindow }) => {
		BrowserWindow.getAllWindows()[0].webContents.session.flushStorageData();
		app.quit();
	});
	await stopped;
}

async function disposeFixture(application: ElectronApplication, root: string) {
	if (application.process().exitCode === null && application.process().signalCode === null) {
		const stopped = application.waitForEvent("close");
		await application.evaluate(({ app }) => app.exit(0));
		await stopped;
	}
	await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
}

async function dismissWelcome(page: Page) {
	await page.addLocatorHandler(page.getByRole("dialog", { name: "Welcome to omp", exact: true }), dialog =>
		dialog.getByRole("button", { name: "Close", exact: true }).click(),
	);
}

async function createFolder(page: Page, name: string, parent?: string) {
	if (parent) {
		await tree(page)
			.getByRole("button", { name: `Folder actions for ${parent}` })
			.click();
		await page.getByRole("menuitem", { name: "New subfolder" }).click();
	} else await tree(page).getByRole("button", { name: "New folder", exact: true }).click();
	const field = tree(page).getByRole("textbox", { name: "Folder name" });
	await expect(field).toBeFocused();
	await expect(page.getByRole("dialog", { name: "New folder" })).toHaveCount(0);
	await field.fill(name);
	await field.press("Enter");
	await expect(field).toHaveCount(0);
}

async function addReference(page: Page, title: string, paths: string[]) {
	await row(page, title).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Add to folders", exact: true }).click();
	const menu = page.getByRole("menu", { name: "Add to folders" });
	if (paths.length === 1) await menu.getByRole("menuitem", { name: paths[0], exact: true }).click();
	else {
		await menu.getByRole("menuitem", { name: "Select multiple folders…" }).click();
		for (const folder of paths) await menu.getByRole("menuitemcheckbox", { name: folder, exact: true }).click();
		await menu.getByRole("menuitem", { name: "Add to folders" }).click();
	}
	await expect(menu).toHaveCount(0);
}

async function chooseFolder(page: Page, current: string, destination: string) {
	await page.getByRole("button", { name: `Switch session folder: ${current}`, exact: true }).click();
	await page
		.getByRole("menu", { name: "Session folders" })
		.getByRole("menuitem", { name: destination, exact: true })
		.click();
}

test("folder naming and destructive confirmations stay in the sidebar and cancel without side effects", async () => {
	const setup = await fixture();
	const app = await setup.launch();
	const page = await app.firstWindow();
	try {
		await ready(page);
		const folders = tree(page);
		await input(page).fill("/rename");
		await page.getByRole("button", { name: "Send (Enter)", exact: true }).click();
		const titleField = page.getByRole("textbox", { name: "Session name" });
		await expect(titleField).toBeFocused();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await titleField.press("Escape");
		await expect(titleField).toHaveCount(0);
		const field = folders.getByRole("textbox", { name: "Folder name" });
		await folders.getByRole("button", { name: "New folder" }).click();
		await field.fill("   ");
		await field.press("Enter");
		await expect(field).toBeFocused();
		await field.press("Escape");
		await expect(field).toHaveCount(0);
		await createFolder(page, "Project");
		await createFolder(page, "Notes", "Project");
		await folders.getByRole("button", { name: "Folder actions for Project" }).click();
		await page.getByRole("menuitem", { name: "Rename folder" }).click();
		await expect(field).toHaveValue("Project");
		await field.fill("项目");
		await folders.getByRole("button", { name: "Rename folder" }).click();
		await folders.getByRole("button", { name: "Folder actions for 项目" }).click();
		await page.getByRole("menuitem", { name: "Delete folder" }).click();
		const confirm = folders.getByRole("group", { name: "Delete folder" });
		await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(confirm).toHaveCount(0);
		await expect(folders.getByTitle("Notes", { exact: true })).toBeVisible();
		await row(page, chatTitle).click();
		await expect(page.getByText("notes-folder-transcript-marker", { exact: true })).toBeVisible();
		await row(page, chatTitle).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
		const sessionConfirm = page
			.locator(".omp-sidebar-list")
			.getByRole("group")
			.filter({ hasText: "cannot be undone" });
		await expect(sessionConfirm).toContainText(chatTitle);
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await sessionConfirm.getByRole("button", { name: "Cancel" }).press("Enter");
		await expect(sessionConfirm).toHaveCount(0);
		await expect(row(page, chatTitle)).toBeVisible();
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("a session with a missing model can open with a chosen model without changing the outgoing session", async () => {
	const setup = await fixture(0, false, true);
	const app = await setup.launch();
	const page = await app.firstWindow();
	try {
		await ready(page);
		await page.getByRole("button", { name: "Find a session to open" }).click();
		const target = page.getByRole("option", { name: new RegExp(sharedTitle) });
		await target.click();
		const restore = page.getByRole("dialog", { name: "Session model unavailable" });
		await restore.getByRole("button", { name: "Cancel" }).click();
		await expect(target).toBeVisible();
		await target.click();
		await restore.getByRole("combobox").selectOption("fixture/local-fixture");
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.getByText("release-folder-search-marker", { exact: true })).toBeVisible();
		const commands = (await fs.readFile(path.join(setup.root, "commands.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(commands.filter(command => command.type === "switch_session").at(-1)).toMatchObject({
			sessionPath: setup.sharedFile,
			provider: "fixture",
			modelId: "local-fixture",
		});
		expect(commands.some(command => command.type === "set_model")).toBe(false);
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("dismissing task and PR drafts keeps edits; closing catalog settings returns to Plugins", async () => {
	const setup = await fixture();
	const app = await setup.launch();
	const page = await app.firstWindow();
	try {
		await ready(page);
		await createFolder(page, "Project");
		await input(page).fill("conversation draft");
		for (const [section, action, placeholder] of [
			["Scheduled Tasks", "New task", "Morning CI check"],
			["PR Center", "New PR", "feat: add the thing"],
		]) {
			await page.getByRole("button", { name: new RegExp(`^${section}`) }).click();
			const open = page.locator("[data-workspace-page]").getByRole("button", { name: action, exact: true }).first();
			const field = page.getByPlaceholder(placeholder);
			await open.click();
			await field.fill("unfinished title");
			await field.press("Escape");
			await expect(field).toHaveCount(0);
			await open.click();
			await expect(field).toHaveValue("unfinished title");
			await page.getByRole("button", { name: "Discard changes", exact: true }).click();
			await open.click();
			await expect(field).toHaveValue("");
			await field.press("Escape");
		}
		await page.getByRole("button", { name: "Plugins", exact: true }).click();
		const plugins = page.getByRole("region", { name: "Plugins", exact: true });
		await plugins.getByRole("button", { name: "Manage catalogs" }).first().click();
		const settings = page.getByRole("dialog", { name: "Settings" });
		await expect(settings).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(settings).toHaveCount(0);
		await expect(plugins).toBeVisible();
		await tree(page).getByTitle("Default", { exact: true }).click();
		await expect(input(page)).toHaveValue("conversation draft");
		await expect(plugins).toHaveCount(0);
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("tabs and sidebar sessions drop onto sidebar folders or the hover-open folder menu", async () => {
	const setup = await fixture();
	const app = await setup.launch();
	const page = await app.firstWindow();
	const picker = page.getByRole("button", { name: /^Switch session folder:/ });
	const menu = page.getByRole("menu", { name: "Session folders" });
	const dropThroughMenu = async (source: Locator, name: string) => {
		await source.hover();
		await page.mouse.down();
		const box = await picker.boundingBox();
		if (!box) throw new Error("Folder switcher not visible");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
		await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
		const target = menu.getByRole("menuitem", { name, exact: true });
		await target.hover();
		await page.mouse.up();
		await expect(menu).toHaveCount(0);
	};
	try {
		await ready(page);
		await createFolder(page, "Infron");
		await createFolder(page, "Release", "Infron");
		await createFolder(page, "Notes");
		await createFolder(page, "Archive");
		await picker.click();
		await expect(menu).toBeVisible();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await menu.getByRole("menuitem").first().click({ trial: true });
		const triggerBox = await picker.boundingBox();
		const menuBox = await menu.boundingBox();
		expect(Math.abs((menuBox?.x ?? 0) - (triggerBox?.x ?? -20))).toBeLessThan(2);
		expect((menuBox?.y ?? 0) - ((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0))).toBeCloseTo(3, 0);
		await picker.click();
		await expect(menu).toHaveCount(0);
		await dropThroughMenu(row(page, sharedTitle), "Default");
		await expect(row(page, sharedTitle)).toBeVisible();
		await dropThroughMenu(row(page, chatTitle), "Infron / Release");
		await row(page, sharedTitle).dragTo(tree(page).getByRole("button", { name: "Release", exact: true }));
		await chooseFolder(page, "Default", "Infron / Release");
		await expect(tabs(page)).toHaveCount(0);
		await row(page, sharedTitle).click();
		await expect(row(page, chatTitle)).toBeVisible();
		await input(page).fill("draft on the dragged tab");
		const owner = await page.evaluate(file => window.omp.tabs.getSessionOwner(file), setup.sharedFile);
		const tab = tabs(page).filter({ hasText: sharedTitle });
		await tab.dragTo(tree(page).getByTitle("Infron", { exact: true }));
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		await dropThroughMenu(tab, "Notes");
		for (const [from, to] of [
			["Infron / Release", "Notes"],
			["Notes", "Infron"],
		]) {
			await chooseFolder(page, from, to);
			await expect(tab).toBeVisible();
			await expect(input(page)).toHaveValue("draft on the dragged tab");
			expect(await page.evaluate(file => window.omp.tabs.getSessionOwner(file), setup.sharedFile)).toEqual(owner);
		}
		await tab.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Add to folders" }).click();
		await expect(page.getByRole("menuitem", { name: "Notes" })).toBeDisabled();
		await page.getByRole("menuitem", { name: "Archive" }).click();
		await expect(page.getByRole("menu")).toHaveCount(0);
		await chooseFolder(page, "Infron", "Archive");
		await expect(input(page)).toHaveValue("draft on the dragged tab");
		await chooseFolder(page, "Archive", "Infron / Release");
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		await row(page, chatTitle).click();
		const chatTab = tabs(page).filter({ hasText: chatTitle });
		const chip = await chatTab.boundingBox();
		if (!chip) throw new Error("Chat tab not visible");
		await tab.hover();
		await page.mouse.down();
		const after = chip.x + chip.width * 0.75;
		await page.mouse.move(after, chip.y + chip.height / 2, { steps: 10 });
		await page.mouse.move(after + 1, chip.y + chip.height / 2);
		await expect(chatTab).toHaveAttribute("data-drop", "after");
		await page.mouse.up();
		await expect(tabs(page).last()).toContainText(sharedTitle);
		await tab.dragTo(page.locator(".omp-split-workspace"));
		await expect(page.locator(".omp-session-pane")).toHaveCount(2);
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("shared shortcuts preserve one session, its draft and a run that finishes in an empty folder", async () => {
	const setup = await fixture();
	const app = await setup.launch();
	const page = await app.firstWindow();
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	try {
		await ready(page);
		await createFolder(page, "Infron");
		await createFolder(page, "Release", "Infron");
		await createFolder(page, "gwprobe");
		await addReference(page, sharedTitle, ["Infron / Release", "gwprobe"]);
		await addReference(page, chatTitle, ["Infron / Release"]);
		await expect(row(page, sharedTitle)).toHaveCount(0);
		await chooseFolder(page, "Default", "Infron / Release");
		await expect(row(page, sharedTitle)).toBeVisible();
		await expect(row(page, chatTitle)).toBeVisible();
		await row(page, chatTitle).click();
		await expect(page.getByText("notes-folder-transcript-marker", { exact: true })).toBeVisible();
		await row(page, sharedTitle).click();
		await expect(page.getByText("release-folder-search-marker", { exact: true })).toBeVisible();
		await input(page).fill("draft shared between folders");
		const owner = await page.evaluate(file => window.omp.tabs.getSessionOwner(file), setup.sharedFile);
		expect(owner?.tabId).toBeTruthy();
		await chooseFolder(page, "Infron / Release", "gwprobe");
		await expect(page.locator("[data-empty-folder]")).toBeVisible();
		await expect(tabs(page)).toHaveCount(0);
		await expect(input(page)).toHaveCount(0);
		await expect(row(page, chatTitle)).toHaveCount(0);
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		const recent = page.locator("[data-empty-folder]");
		await expect(recent.getByText(chatTitle)).toHaveCount(0);
		await recent.getByRole("button", { name: new RegExp(sharedTitle) }).click();
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		await expect(input(page)).toHaveValue("draft shared between folders");
		await expect(tabs(page)).toHaveCount(1);
		expect(await page.evaluate(file => window.omp.tabs.getSessionOwner(file), setup.sharedFile)).toEqual(owner);
		await input(page).fill("fixture folder background");
		await page.getByRole("button", { name: "Send (Enter)", exact: true }).click();
		await expect(page.getByRole("button", { name: "Abort", exact: true })).toBeVisible();
		await page.keyboard.press(process.platform === "darwin" ? "Meta+w" : "Control+w");
		await expect(page.locator("[data-empty-folder]")).toBeVisible();
		await expect(row(page, sharedTitle)).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(async tabId => (await window.omp.tabs.list()).find(tab => tab.tabId === tabId), owner?.tabId),
			)
			.toMatchObject({ status: "running" });
		const runningFolders = tree(page).locator('button[aria-description="Running"]');
		await expect(runningFolders).toHaveText(["Infron", "Release", "gwprobe"]);
		const dot = runningFolders.first().locator('span[aria-hidden="true"] > span');
		await expect(dot).toBeVisible();
		await expect(dot).toHaveCSS("animation-name", "pulse");
		await page.emulateMedia({ reducedMotion: "reduce" });
		await expect(dot).toHaveCSS("animation-name", "none");
		await expect(dot).toBeVisible();
		await fs.writeFile(setup.gate, "finish");
		await expect
			.poll(() =>
				page.evaluate(async tabId => (await window.omp.tabs.list()).find(tab => tab.tabId === tabId), owner?.tabId),
			)
			.toMatchObject({ status: "ready" });
		await expect(runningFolders).toHaveCount(0);
		await chooseFolder(page, "gwprobe", "Infron / Release");
		await expect(tabs(page)).toHaveCount(2);
		await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
		await expect(page.getByText("Completed in the background", { exact: true })).toBeVisible();
		expect(await page.evaluate(file => window.omp.tabs.getSessionOwner(file), setup.sharedFile)).toEqual(owner);
		await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+Alt+Shift+ArrowLeft`);
		await expect(tabs(page).first()).toContainText(sharedTitle);
		await chooseFolder(page, "Infron / Release", "gwprobe");
		await row(page, sharedTitle).click();
		await expect(tabs(page)).toHaveCount(1);
		await chooseFolder(page, "gwprobe", "Infron / Release");
		await expect(tabs(page).first()).toContainText(sharedTitle);
		expect(errors).toEqual([]);
		await page.screenshot({ path: "test-results/session-folders.png", animations: "disabled", scale: "css" });
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("file a selection into its first folder and create another directly from a tab with the sidebar closed", async () => {
	const setup = await fixture();
	const app = await setup.launch();
	const page = await app.firstWindow();
	try {
		await ready(page);
		const modifier = process.platform === "darwin" ? "Meta" : "Control";
		await row(page, sharedTitle).click({ modifiers: [modifier] });
		await row(page, chatTitle).click({ modifiers: [modifier] });
		const add = page
			.getByRole("toolbar", { name: "Selected sessions" })
			.getByRole("button", { name: "Add to folders" });
		await add.click();
		const field = page.getByRole("textbox", { name: "Folder name" });
		await expect(field).toBeFocused();
		await field.fill("   ");
		await field.press("Enter");
		await expect(field).toBeFocused();
		await field.press("Escape");
		await expect(field).toHaveCount(0);
		await expect(page.getByRole("button", { name: /^Switch session folder:/ })).toHaveCount(0);
		await add.click();
		await field.fill("Delivery");
		await field.press("Enter");
		await chooseFolder(page, "Default", "Delivery");
		await expect(row(page, chatTitle)).toBeVisible();
		await row(page, sharedTitle).click();
		await input(page).fill("unfinished note");
		const owner = await page.evaluate(file => window.omp.tabs.getSessionOwner(file), setup.sharedFile);
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		await tabs(page).filter({ hasText: sharedTitle }).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Add to folders" }).click();
		await page.getByRole("menuitem", { name: "New folder and add sessions…" }).click();
		await expect(field).toBeFocused();
		await field.fill("Follow-up");
		await field.press("Enter");
		await chooseFolder(page, "Delivery", "Follow-up");
		await expect(input(page)).toHaveValue("unfinished note");
		expect(await page.evaluate(file => window.omp.tabs.getSessionOwner(file), setup.sharedFile)).toEqual(owner);
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("bulk references, search paths, folder persistence and subtree deletion use real session files", async () => {
	test.setTimeout(120_000);
	const setup = await fixture(0, true);
	let app = await setup.launch();
	let page = await app.firstWindow();
	try {
		await dismissWelcome(page);
		await ready(page);
		await createFolder(page, "Infron");
		await createFolder(page, "Release", "Infron");
		await createFolder(page, "gwprobe");
		const modifier = process.platform === "darwin" ? "Meta" : "Control";
		const workspace = page
			.locator(".omp-sidebar-list")
			.getByRole("button", { name: "release-workspace", exact: true });
		await expect(workspace).toBeVisible();
		if ((await workspace.getAttribute("aria-expanded")) === "false") await workspace.click();
		await row(page, sharedTitle).click({ modifiers: [modifier] });
		await row(page, chatTitle).click({ modifiers: [modifier] });
		await page
			.getByRole("toolbar", { name: "Selected sessions" })
			.getByRole("button", { name: "Add to folders" })
			.click();
		const add = page.getByRole("menu", { name: "Add to folders" });
		await add.getByRole("menuitemcheckbox", { name: "Infron / Release" }).click();
		await add.getByRole("menuitemcheckbox", { name: "gwprobe" }).click();
		await add.getByRole("menuitem", { name: "Add to folders" }).click();
		await expect(add).toHaveCount(0);
		await chooseFolder(page, "Default", "gwprobe");
		await row(page, sharedTitle).click();
		await expect.poll(() => page.evaluate(() => window.omp.sidecar.getStatus())).toMatchObject({ status: "ready" });
		await expect
			.poll(() => page.evaluate(() => window.omp.rpc.getState()))
			.toMatchObject({ success: true, data: { sessionFile: setup.sharedFile, messageCount: 1 } });
		await expect(page.getByText("release-folder-search-marker", { exact: true })).toBeVisible({ timeout: 30_000 });
		await page.keyboard.press(`${modifier}+Shift+f`);
		const search = page.getByRole("dialog", { name: "Search conversations" });
		await search.getByRole("textbox", { name: "Search conversations" }).fill("release-folder-search-marker");
		const paths = search.getByRole("combobox", { name: "Open in folder" });
		await expect(paths).toHaveCount(1);
		await expect(paths.locator("option:checked")).toHaveText("gwprobe");
		await paths.selectOption({ label: "Infron / Release" });
		await search.getByText("release-folder-search-marker", { exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Switch session folder: Infron / Release", exact: true }),
		).toBeVisible();
		await expect(tabs(page)).toHaveCount(1);
		await quitForRestore(app);
		app = await setup.launch(true);
		page = await app.firstWindow();
		await dismissWelcome(page);
		await expect(page.getByText("release-folder-search-marker", { exact: true })).toBeVisible({ timeout: 30_000 });
		await expect(tabs(page)).toHaveCount(1);
		await expect(
			page.getByRole("button", { name: "Switch session folder: Infron / Release", exact: true }),
		).toBeVisible();
		await row(page, chatTitle).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Remove from this folder", exact: true }).click();
		await expect(row(page, chatTitle)).toHaveCount(0);
		const destination = path.join(setup.root, "relocated");
		await fs.mkdir(destination);
		await input(page).fill("draft across project move");
		const moved = await page.evaluate(cwd => window.omp.rpc.moveSession(cwd), destination);
		expect(moved.success).toBe(true);
		await expect
			.poll(() => page.evaluate(() => window.omp.rpc.getState()))
			.toMatchObject({ success: true, data: { cwd: destination } });
		await expect(
			page.locator(`[data-session-group="${destination}"]`).getByText(sharedTitle, { exact: true }),
		).toBeVisible();
		await expect(input(page)).toHaveValue("draft across project move");
		await tree(page).getByRole("button", { name: "Folder actions for Infron" }).click();
		await page.getByRole("menuitem", { name: "Delete folder" }).click();
		await tree(page)
			.getByRole("group", { name: "Delete folder" })
			.getByRole("button", { name: "Delete folder" })
			.click();
		await expect(page.getByRole("button", { name: "Switch session folder: Default", exact: true })).toBeVisible();
		await chooseFolder(page, "Default", "gwprobe");
		await expect(row(page, chatTitle)).toBeVisible();
		await expect(page.getByText("release-folder-search-marker", { exact: true })).toBeVisible();
		const files = await page.evaluate(async () =>
			(await window.omp.sessions.list("global")).map(session => session.path),
		);
		expect(files).toContain(setup.chatFile);
		expect(files).not.toContain(setup.sharedFile);
		await expect(row(page, sharedTitle)).toBeVisible();
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("30 folder switches with 5,000-message histories keep rendering bounded", async () => {
	test.setTimeout(120_000);
	const setup = await fixture(5000);
	const app = await setup.launch();
	const page = await app.firstWindow();
	try {
		await ready(page);
		await createFolder(page, "Infron");
		await createFolder(page, "gwprobe");
		await addReference(page, sharedTitle, ["Infron"]);
		await addReference(page, chatTitle, ["gwprobe"]);
		await chooseFolder(page, "Default", "Infron");
		await row(page, sharedTitle).click();
		await expect(page.locator("[data-transcript-kind]").first()).toBeVisible();
		await chooseFolder(page, "Infron", "gwprobe");
		await row(page, chatTitle).click();
		await expect(page.locator("[data-transcript-kind]").first()).toBeVisible();
		const pool = await page.evaluate(async () => (await window.omp.tabs.list()).map(tab => tab.tabId).sort());
		const samples = [];
		let maxRows = 0;
		for (let index = 0; index < 30; index++) {
			const folder = index % 2 === 0 ? "Infron" : "gwprobe";
			const before = performance.now();
			await tree(page).getByRole("button", { name: folder, exact: true }).click();
			await expect(tabs(page)).toHaveCount(1);
			await expect(tabs(page).first()).toContainText(index % 2 === 0 ? sharedTitle : chatTitle);
			await expect(page.locator("[data-transcript-kind]").first()).toBeVisible();
			const rows = await page.evaluate(
				() =>
					new Promise<number>(resolve =>
						requestAnimationFrame(() => resolve(document.querySelectorAll("[data-transcript-kind]").length)),
					),
			);
			samples.push(performance.now() - before);
			maxRows = Math.max(rows, maxRows);
		}
		const p95 = samples.sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1];
		await test.info().attach("Folder switching performance", {
			body: JSON.stringify({ p95Ms: p95, maxRows, samples }),
			contentType: "application/json",
		});
		expect(p95).toBeLessThan(500);
		expect(maxRows).toBeLessThan(150);
		expect(await page.evaluate(async () => (await window.omp.tabs.list()).map(tab => tab.tabId).sort())).toEqual(
			pool,
		);
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("a filed session opened in another window is visible without changing the source window", async () => {
	const setup = await fixture();
	let app = await setup.launch();
	const page = await app.firstWindow();
	try {
		await ready(page);
		await createFolder(page, "Notes");
		await addReference(page, chatTitle, ["Notes"]);
		await chooseFolder(page, "Default", "Notes");
		await row(page, chatTitle).click({ button: "right" });
		const opened = app.waitForEvent("window");
		await page.getByRole("menuitem", { name: "Open in new window" }).click();
		const other = await opened;
		await expect(other.getByText("notes-folder-transcript-marker", { exact: true })).toBeVisible();
		await expect(tabs(other)).toHaveCount(1);
		await expect(page.locator("[data-empty-folder]")).toBeVisible();
		await chooseFolder(page, "Notes", "Default");
		await expect(other.getByRole("button", { name: "Switch session folder: Notes" })).toBeVisible();
		await expect(tabs(page)).toHaveCount(1);
		await chooseFolder(other, "Notes", "Default");
		await chooseFolder(page, "Default", "Notes");
		await row(page, chatTitle).click();
		await expect(other.getByText("notes-folder-transcript-marker", { exact: true })).toBeVisible();
		await expect(tabs(page)).toHaveCount(0);
		await chooseFolder(page, "Notes", "Default");
		await expect(tabs(page)).toHaveCount(1);
		await quitForRestore(app);
		app = await setup.launch(true);
		await expect.poll(() => app.windows().length).toBe(2);
		await expect
			.poll(async () =>
				Promise.all(
					app
						.windows()
						.map(win => win.getByRole("button", { name: /^Switch session folder:/ }).getAttribute("title")),
				).then(labels => labels.sort()),
			)
			.toEqual(["Default", "Notes"]);
		for (const win of app.windows()) await expect(tabs(win)).toHaveCount(1);
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("a narrow window shows only the local split panes, and its folder picker stays reachable", async () => {
	const setup = await fixture();
	const app = await setup.launch();
	const page = await app.firstWindow();
	const name = "发布审计与回归检查".repeat(8);
	const nested = `Platform / ${name}`;
	try {
		await ready(page);
		await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
		await createFolder(page, "Platform");
		await createFolder(page, name, "Platform");
		await addReference(page, chatTitle, ["Platform", nested]);
		await addReference(page, sharedTitle, [nested]);
		await chooseFolder(page, "Default", nested);
		await row(page, sharedTitle).click();
		await row(page, chatTitle).click();
		await tabs(page).filter({ hasText: sharedTitle }).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Split right" }).click();
		await expect(page.locator(".omp-session-pane")).toHaveCount(2);
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		const picker = page.getByRole("button", { name: `Switch session folder: ${nested}`, exact: true });
		const colors = new Set<string>();
		for (const [scheme, theme] of [
			["light", "Porcelain"],
			["dark", "Graphite"],
		] as const) {
			const pane = page.locator('.omp-session-pane[data-active="true"]');
			await pane.locator("textarea").fill("/theme");
			await pane.getByRole("button", { name: "Send (Enter)", exact: true }).click();
			const themes = page.getByRole("dialog");
			await themes.getByPlaceholder("Search themes…").fill(theme);
			await themes.locator("button[aria-pressed]").filter({ hasText: theme }).click();
			await expect
				.poll(() => picker.locator("span").evaluate(label => label.scrollWidth > label.clientWidth))
				.toBe(true);
			await picker.click();
			const dialog = page.getByRole("menu", { name: "Session folders" });
			const selected = dialog.getByRole("menuitem", { name: nested, exact: true });
			colors.add(await dialog.evaluate(panel => getComputedStyle(panel).backgroundColor));
			await selected.click({ trial: true });
			expect(await selected.evaluate(button => button.scrollWidth <= button.clientWidth)).toBe(true);
			await page.screenshot({
				path: `test-results/folder-picker-${scheme}.png`,
				animations: "disabled",
				scale: "css",
			});
			await page.keyboard.press("Escape");
			await expect(picker).toBeFocused();
		}
		expect(colors.size).toBe(2);
		await chooseFolder(page, nested, "Platform");
		await expect(page.locator(".omp-session-pane")).toHaveCount(0);
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		const branch = tree(page).locator('button[aria-expanded][aria-label="Platform"]');
		await branch.click();
		await row(page, chatTitle).click();
		await expect(branch).toHaveAttribute("aria-expanded", "false");
		await expect(page.locator(".omp-session-pane")).toHaveCount(1);
		await expect(tabs(page)).toHaveCount(1);
		await tabs(page).first().click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Separate pair" })).toHaveCount(0);
		await page.keyboard.press("Escape");
		await chooseFolder(page, "Platform", nested);
		await expect(page.locator(".omp-session-pane")).toHaveCount(2);
	} finally {
		await disposeFixture(app, setup.root);
	}
});

test("a new tab without a transcript returns to its folder after restarting", async () => {
	const setup = await fixture();
	let app = await setup.launch();
	let page = await app.firstWindow();
	try {
		await ready(page);
		await createFolder(page, "Unsent");
		await chooseFolder(page, "Default", "Unsent");
		await page.locator("[data-empty-folder]").getByRole("button", { name: "New session" }).click();
		await ready(page);
		await expect(tabs(page)).toHaveCount(1);
		await quitForRestore(app);
		app = await setup.launch(true);
		page = await app.firstWindow();
		await expect(page.getByRole("button", { name: "Switch session folder: Unsent" })).toBeVisible();
		await expect(tabs(page)).toHaveCount(1);
		await expect(input(page)).toBeVisible();
		await chooseFolder(page, "Unsent", "Default");
		await expect(tabs(page)).toHaveCount(1);
	} finally {
		await disposeFixture(app, setup.root);
	}
});
