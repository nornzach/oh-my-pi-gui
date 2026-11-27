import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { type ElectronApplication, _electron as electron, type Locator, type Page } from "playwright";
import { IPC_EVENTS } from "../src/shared/ipc-types";
import type { AgentSessionEvent } from "../src/shared/rpc-types";

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
			...(test.info().title.startsWith("#79") && {
				transcriptDetail: "compact",
				autoCollapseProcess: true,
				thinkingExpanded: true,
			}),
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
	// The card parses `/mcp list` text into a table, so the surviving row is the
	// contract — not the raw pipe-delimited line the fixture emitted.
	const output = page.getByRole("row").filter({ hasText: "mysql" });
	await expect(output).toBeVisible();
	await expect(output).toContainText("stdio");
	await expect(output).toContainText("enabled");
	await expect(output).toContainText("user");
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

async function verifyCopyOption(form: Locator) {
	await page.evaluate(() =>
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					document.body.dataset.copiedOption = value;
				},
			},
		}),
	);
	const draft = form.getByPlaceholder(/custom|own|other/i);
	await draft.fill("canary");
	await form.getByRole("button", { name: "Copy", exact: true }).click();
	await expect(page.locator("body")).toHaveAttribute("data-copied-option", "Blue environment");
	await expect(draft).toHaveValue("canary");
	await expect(form.getByRole("button", { name: "Blue environment" })).toHaveAttribute("aria-pressed", "false");
}

test("#74 an ask form answers inline while the conversation stays on screen", async () => {
	await command("fixture committed reply");
	await expect(page.getByText("Local fixture reply")).toBeVisible();
	await command("fixture form");
	const card = page.locator("[data-inline-ask]");
	await expect(card).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByText("Local fixture reply")).toBeVisible();
	await card.getByRole("textbox", { name: "Target" }).fill("staging");
	await verifyCopyOption(card);
	await page.screenshot({ path: "test-results/issues-74-inline.png", scale: "css", animations: "disabled" });
	await card.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(card).toHaveCount(0);
	await expect
		.poll(async () => (await recorded("extension_ui_response")).filter(item => item.id === "form-e2e"))
		.toMatchObject([{ formData: { target: "staging", strategy: "canary" } }]);

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
	await verifyCopyOption(modal);
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

async function rendererEvents() {
	if (!app) throw new Error("Electron app is unavailable");
	const application = app;
	const tabId = await page.evaluate(async () => (await window.omp.tabs.list()).find(tab => tab.active)?.tabId);
	return (events: AgentSessionEvent[]) =>
		application.evaluate(
			({ BrowserWindow }, batch) =>
				BrowserWindow.getAllWindows()[0]?.webContents.send(batch.channel, {
					tabId: batch.tabId,
					payload: batch.events,
				}),
			{ channel: IPC_EVENTS.EVENTS_BATCH, tabId, events },
		);
}

test("#79 live reasoning follows its own tail until the reader scrolls up", async () => {
	const emit = await rendererEvents();
	const delta = (text: string): AgentSessionEvent => ({
		type: "message_update",
		message: { role: "assistant" },
		assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: text },
	});
	const paragraph = Array.from(
		{ length: 45 },
		(_, index) => `Checking the scroll position after update ${index + 1}.\n\n`,
	).join("");
	await emit([
		{ type: "agent_start" },
		{ type: "message_start", message: { role: "assistant", timestamp: Date.now() } },
		delta(
			"The shortcut is registered on the widget, but the key event may be handled by the parent first.\n\nI’ll check the order of those handlers before changing the binding.",
		),
	]);
	const header = page.locator(".omp-thinking-header").last();
	await expect(header).toBeVisible();
	await expect(header).toHaveAttribute("aria-expanded", "false");
	await expect(page.locator(".omp-execution-group-header")).toHaveCount(0);
	await header.click();
	const body = page.locator(".omp-thinking-body").last();
	await expect(body).toContainText("before changing the binding");
	await page
		.locator(".omp-thinking-block")
		.last()
		.screenshot({ path: "test-results/compact-reasoning.png", animations: "disabled" });
	await emit([delta(`\n\n${paragraph}`)]);
	const gap = () => body.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop);
	await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
	await emit([delta(`${paragraph}Tail one`)]);
	await expect(body).toContainText("Tail one");
	await expect.poll(gap).toBeLessThan(2);
	await body.evaluate(node => {
		node.scrollTop -= 8;
	});
	await expect.poll(gap).toBeGreaterThan(6);
	const readingPosition = await body.evaluate(node => node.scrollTop);
	await emit([delta(`${paragraph}Tail two`)]);
	await expect(body).toContainText("Tail two");
	await expect.poll(() => body.evaluate(node => node.scrollTop)).toBe(readingPosition);
	await body.evaluate(node => {
		node.scrollTop = node.scrollHeight;
	});
	await expect.poll(gap).toBeLessThan(2);
	await emit([delta(`${paragraph}Tail three`)]);
	await expect(body).toContainText("Tail three");
	await expect.poll(gap).toBeLessThan(2);
	await header.click();
	await emit([
		{
			type: "tool_execution_start",
			toolCallId: "read-widget",
			toolName: "read",
			intent: "Check the widget’s keyboard shortcuts",
			args: { path: "src/components/Widget.tsx" },
		},
	]);
	const group = page.locator(".omp-execution-group-header");
	await expect(group).toHaveAttribute("aria-expanded", "false");
	await expect(group).toContainText("src/components/Widget.tsx");
	await expect(group).toContainText("Check the widget’s keyboard shortcuts");
	await expect(page.locator(".omp-tool-body")).toHaveCount(0);
	await group.screenshot({ path: "test-results/compact-tool-header.png", animations: "disabled" });
});

test("tool narration stays readable and the spacing control compacts actual transcript rows", async () => {
	const emit = await rendererEvents();
	await emit([
		{ type: "agent_start" },
		{
			type: "message_end",
			message: {
				role: "assistant",
				timestamp: Date.now(),
				content: [
					{ type: "thinking", thinking: "Use the build shell to finish the task." },
					{ type: "text", text: "The build is ready to continue." },
					{
						type: "toolCall",
						id: "send",
						name: "terminal",
						arguments: { action: "send", key: "enter", id: "pty-7" },
					},
					{ type: "toolCall", id: "wait", name: "terminal", arguments: { action: "wait", id: "pty-7" } },
				],
			},
		},
	]);
	const narration = page.getByText("The build is ready to continue.", { exact: true });
	const group = page.locator(".omp-execution-group-header");
	await expect(narration).toBeVisible();
	await expect(group).toContainText("Wait for command · pty-7");
	await group.click();
	const send = page.locator(".omp-tool-header").filter({ hasText: "Send input" });
	const wait = page.locator(".omp-tool-header").filter({ hasText: "Wait for command" });
	await expect(send).toContainText("enter · pty-7");
	await expect(page.locator(".omp-message-actions")).toHaveCount(0);
	const trigger = page.locator("[data-view-controls-trigger]");
	await trigger.click();
	await page.locator('[data-density-option="comfortable"]').click();
	const comfortableHeight = await send.evaluate(element => element.getBoundingClientRect().height);
	await page.locator('[data-density-option="tight"]').click();
	await expect
		.poll(() => send.evaluate(element => element.getBoundingClientRect().height))
		.toBeLessThan(comfortableHeight);
	await page.keyboard.press("Escape");
	const sendBox = await send.boundingBox();
	const waitBox = await wait.boundingBox();
	const gap = waitBox!.y - sendBox!.y - sendBox!.height;
	expect(gap).toBeGreaterThanOrEqual(0);
	expect(gap).toBeLessThan(3);
	await page.screenshot({ path: "test-results/transcript-tool-spacing.png", scale: "css", animations: "disabled" });
});

test("#73 activity moves between the right edge and drawer without covering the composer menu", async () => {
	await command("fixture dock");
	const peek = page.getByRole("complementary", { name: "Task activity" });
	const inspector = page.locator(".omp-inspector");
	const transcript = page.locator(".omp-transcript-canvas");
	await expect(peek).toContainText("Review the workflow");
	await expect(peek.getByRole("button", { name: /fixture scout.*Working/i })).toBeVisible();
	await expect(transcript).toContainText("Checking the release.");
	await expect(transcript).not.toContainText("Review the workflow");
	await expect(
		transcript.locator('.omp-tool-card, .omp-execution-group, [data-transcript-kind="todoSnapshot"]'),
	).toHaveCount(0);
	await page.screenshot({ path: "test-results/activity-floating.png", scale: "css", animations: "disabled" });
	await peek.getByRole("button", { name: /^Task activity/ }).click();
	await expect(peek).toHaveCount(0);
	await expect(inspector.getByRole("button", { name: "Task activity", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(inspector.getByText("Review the workflow", { exact: true })).toHaveCount(1);
	await expect(inspector.getByText("fixture scout", { exact: true })).toBeVisible();
	await page.screenshot({ path: "test-results/activity-drawer.png", scale: "css", animations: "disabled" });
	await inspector.getByRole("button", { name: "Files", exact: true }).click();
	await expect(peek).toHaveCount(0);
	await inspector.getByTitle("Close panel").click();
	await expect(peek).toBeVisible();
	const composer = page.locator(".omp-composer-box textarea");
	await composer.fill("/");
	const menu = page.locator("[data-completion-menu]");
	await expect(menu).toBeVisible();
	await page.screenshot({ path: "test-results/issues-73-layering.png", scale: "css", animations: "disabled" });

	const menuBox = await menu.boundingBox();
	const railBox = await peek.boundingBox();
	expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(railBox!.x);
	await menu.getByRole("button").first().click();
	await expect(menu).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("the composer grows from one line with wrapped or multiline drafts and shrinks on clear", async () => {
	const composer = page.locator(".omp-composer-box textarea");
	const height = () => composer.evaluate(node => node.getBoundingClientRect().height);
	const line = await composer.evaluate(node => Number.parseFloat(getComputedStyle(node).lineHeight));
	expect(Math.abs((await height()) - line)).toBeLessThan(1);
	await composer.fill("wrapped text ".repeat(80));
	await expect.poll(height).toBeGreaterThan(line * 2);
	await composer.fill("first\nsecond");
	await expect.poll(async () => Math.abs((await height()) - 2 * line)).toBeLessThan(1);
	await composer.fill("long\n".repeat(120));
	expect(await composer.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
	await composer.fill("");
	await expect.poll(async () => Math.abs((await height()) - line)).toBeLessThan(1);
});
