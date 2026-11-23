import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { type ElectronApplication, _electron as electron, type Page } from "playwright";

let app: ElectronApplication | undefined;
let page: Page;
let profile: string;
let record: string;
let emptyProject: string;
const errors: string[] = [];

async function command(text: string) {
	const composer = page.getByRole("textbox", { name: /Ask omp/ });
	// Native text correction can change fixture commands as the composer blurs.
	await composer.evaluate(element => {
		element.setAttribute("spellcheck", "false");
		element.setAttribute("autocorrect", "off");
	});
	await composer.fill(text);
	await page.getByRole("button", { name: "Send (Enter)", exact: true }).click();
}

async function recorded(type: string) {
	const text = await fs.readFile(record, "utf8").catch(() => "");
	return text
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line))
		.filter(command => command.type === type);
}

async function transcriptReads() {
	return (await recorded("get_transcript")).length + (await recorded("get_messages")).length;
}

test.beforeEach(async () => {
	errors.length = 0;
	profile = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-issues-")));
	const project = path.join(profile, "project");
	emptyProject = path.join(profile, "empty-project");
	const userData = path.join(profile, "desktop");
	const agent = path.join(profile, "agent");
	await Promise.all([fs.mkdir(project), fs.mkdir(emptyProject), fs.mkdir(userData), fs.mkdir(agent)]);
	record = path.join(profile, "rpc.jsonl");
	await fs.writeFile(
		path.join(userData, "prefs.json"),
		JSON.stringify({
			language: "en",
			firstRunComplete: true,
			askInline: true,
			sidebar: { registeredWorkspaces: [emptyProject] },
		}),
	);
	const fixture = path.resolve("e2e/sidecar-fixture.ts");
	await fs.chmod(fixture, 0o755);
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: agent,
		PI_CONFIG_DIR: path.relative(os.homedir(), profile),
		OMP_PROFILE: "",
		PI_PROFILE: "",
		OMP_BUNDLED_OMP: fixture,
		OMP_GUI_TEST_RECORD: record,
		OMP_GUI_TEST_STATS_BINARY: path.resolve("resources/omp"),
	};
	Reflect.deleteProperty(env, "ELECTRON_RUN_AS_NODE");
	app = await electron.launch({
		args: [path.resolve("out/main/index.js"), project, `--user-data-dir=${userData}`],
		env,
	});
	page = await app.firstWindow();
	page.on("pageerror", error => errors.push(error.message));
	await page.waitForFunction(() => window.omp?.rpc != null);
	await expect.poll(async () => (await page.evaluate(() => window.omp.sidecar.getStatus())).status).toBe("ready");
});

test.afterEach(async () => {
	const testInfo = test.info();
	try {
		if (app) await app.evaluate(({ app }) => app.exit(0));
		if (testInfo.status !== testInfo.expectedStatus && record) {
			await testInfo.attach("rpc", { path: record, contentType: "application/jsonl" }).catch(() => {});
		}
	} finally {
		app = undefined;
		if (profile) await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("#75 builtin output stays on screen after the hydrate its prompt triggers", async () => {
	await command("fixture committed reply");
	await expect(page.getByText("Local fixture reply")).toBeVisible();
	const readsBefore = await transcriptReads();

	await command("fixture builtin");
	const output = page.getByText("mysql | stdio | enabled [user]");
	await expect(output).toBeVisible();
	// The hydrate must actually have run: a prompt_result with agentInvoked:false
	// is what re-reads the transcript, and that read used to drop the local row.
	await expect.poll(transcriptReads).toBeGreaterThan(readsBefore);
	await expect(output).toBeVisible();
	await expect(page.getByText("Local fixture reply")).toBeVisible();
	await page.screenshot({ path: "test-results/issues-75-builtin.png", scale: "css", animations: "disabled" });
});

test("#76 an empty project can be removed from the sidebar without touching its folder", async () => {
	const row = page.locator(`[data-workspace-group="${emptyProject}"]`);
	await expect(row).toBeVisible();
	await row.hover();
	await row.getByRole("button", { name: "Workspace actions", exact: true }).click();
	const menu = page.getByRole("menu");
	await expect(menu.getByRole("menuitem", { name: "Remove project from list", exact: true })).toBeVisible();
	// Deleting sessions is meaningless for a group that has none.
	await expect(menu.getByRole("menuitem", { name: "Delete sessions", exact: true })).toHaveCount(0);
	await menu.getByRole("menuitem", { name: "Remove project from list", exact: true }).click();
	await expect(row).toHaveCount(0);
	const prefs = (await page.evaluate(() => window.omp.prefs.get("sidebar"))) as {
		registeredWorkspaces?: string[];
	};
	expect(prefs.registeredWorkspaces ?? []).not.toContain(emptyProject);
	expect((await fs.stat(emptyProject)).isDirectory()).toBe(true);
	expect(errors).toEqual([]);
});

test("#74 an ask form answers inline while the conversation stays on screen", async () => {
	await command("fixture committed reply");
	await expect(page.getByText("Local fixture reply")).toBeVisible();
	await command("fixture form");
	const card = page.locator("[data-inline-ask]");
	await expect(card).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByText("Local fixture reply")).toBeVisible();
	await card.getByRole("textbox", { name: "Target" }).fill("staging");
	await page.screenshot({ path: "test-results/issues-74-inline.png", scale: "css", animations: "disabled" });
	await card.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(card).toHaveCount(0);
	await expect
		.poll(async () => (await recorded("extension_ui_response")).filter(item => item.id === "form-e2e"))
		.toMatchObject([{ formData: { target: "staging" } }]);

	// Escape inside the inline form cancels it, exactly as the modal does.
	await command("fixture form");
	await expect(card).toBeVisible();
	await card.getByRole("textbox", { name: "Target" }).focus();
	await page.keyboard.press("Escape");
	await expect(card).toHaveCount(0);
	await expect
		.poll(async () => (await recorded("extension_ui_response")).filter(item => item.cancelled === true))
		.toHaveLength(1);
});

test("#74 turning the preference off brings the modal back", async () => {
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog");
	await settings.getByPlaceholder("Search settings…").fill("Show ask forms");
	// Search surfaces a jump button; the control itself lives on the GUI page.
	await settings.getByRole("button", { name: /Show ask forms inline in the chat/ }).click();
	const toggle = settings.getByRole("switch", { name: "Show ask forms inline in the chat", exact: true });
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await page.keyboard.press("Escape");
	await expect(settings).toHaveCount(0);
	expect(await page.evaluate(() => window.omp.prefs.get("askInline"))).toBe(false);

	await command("fixture form");
	const modal = page.getByRole("dialog", { name: "Questions", exact: true });
	await expect(modal).toBeVisible();
	await expect(page.locator("[data-inline-ask]")).toHaveCount(0);
	await modal.getByRole("textbox", { name: "Target" }).fill("production");
	await modal.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(modal).toHaveCount(0);
	await expect
		.poll(async () =>
			(await recorded("extension_ui_response")).filter(item => item.formData?.target === "production"),
		)
		.toHaveLength(1);
});

test("#71 the Token Meter reports live throughput and closes on Escape", async () => {
	await command("fixture stream");
	const metrics = page.locator("button.omp-session-metrics");
	await expect(metrics).toBeVisible();
	await metrics.click();
	const meter = page.getByRole("dialog", { name: "Token Meter", exact: true });
	await expect(meter).toBeVisible();
	await expect(meter).toContainText("char/s");
	await expect(meter).toContainText("last 60 s");
	// The fixture model carries an always-off-peak tariff, so the row is stable.
	await expect(meter.locator("[data-tariff]")).toContainText("Off-peak");
	await expect(meter.locator("[data-tariff]")).toContainText("×0.5");
	// The gauge samples the streaming buffer, so it must climb above zero while
	// the fixture keeps delivering deltas.
	await expect
		.poll(async () => Number(await meter.locator("[data-token-meter-rate]").textContent()))
		.toBeGreaterThan(0);
	await page.screenshot({ path: "test-results/issues-71-meter.png", scale: "css", animations: "disabled" });
	await page.keyboard.press("Escape");
	await expect(meter).toHaveCount(0);
	// Closing the meter must not abort the stream it was measuring.
	const abort = page.getByRole("button", { name: "Abort", exact: true });
	await expect(abort).toBeVisible();
	// The readout toggles the panel: clicking it again closes what it opened.
	await metrics.click();
	await expect(meter).toBeVisible();
	await metrics.click();
	await expect(meter).toHaveCount(0);
	await abort.click();
	await expect(page.getByRole("button", { name: "Send (Enter)", exact: true })).toBeVisible();
});

test("#73 the slash menu paints above the Agents dock header", async () => {
	await command("fixture dock");
	const dock = page.locator('[data-testid="workspace-dock"]');
	await expect(dock).toBeVisible();
	const composer = page.locator("textarea").first();
	await composer.fill("/");
	const menu = page.locator("[data-completion-menu]");
	await expect(menu).toBeVisible();
	await page.screenshot({ path: "test-results/issues-73-layering.png", scale: "css", animations: "disabled" });

	const probe = await page.evaluate(() => {
		const menu = document.querySelector("[data-completion-menu]");
		const header = document.querySelector('[data-testid="workspace-dock"] .sticky');
		if (!menu || !header) return null;
		const a = menu.getBoundingClientRect();
		const b = header.getBoundingClientRect();
		const left = Math.max(a.left, b.left);
		const right = Math.min(a.right, b.right);
		const top = Math.max(a.top, b.top);
		const bottom = Math.min(a.bottom, b.bottom);
		if (right <= left || bottom <= top) return { overlap: 0, hit: "" };
		const x = (left + right) / 2;
		const y = (top + bottom) / 2;
		const hit = document.elementFromPoint(x, y);
		return {
			overlap: (right - left) * (bottom - top),
			hit: hit ? (hit.closest("[data-completion-menu]") ? "menu" : hit.className || hit.tagName) : "none",
		};
	});
	expect(probe).not.toBeNull();
	// Without an overlap the probe proves nothing about paint order.
	expect(probe!.overlap).toBeGreaterThan(0);
	expect(probe!.hit).toBe("menu");
	await composer.fill("");
	await expect(menu).toHaveCount(0);
	expect(errors).toEqual([]);
});
