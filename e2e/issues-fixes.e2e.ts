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
			...(test.info().title.startsWith("Read alignment:") && {
				transcriptDetail: "full",
				autoCollapseProcess: false,
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
		...(test.info().title.startsWith("Model recovery:") && { OMP_GUI_TEST_NO_DEFAULT_MODEL: "1" }),
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
	const option = form.getByRole("button", { name: "Blue environment" });
	const word = await option.evaluate(element => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.textContent !== "Blue") continue;
			const range = document.createRange();
			range.setStart(node, 0);
			range.setEnd(node, 4);
			const { left, right, top, height } = range.getBoundingClientRect();
			return { left, right, middle: top + height / 2 };
		}
		throw new Error("Option label missing");
	});
	await page.mouse.move(word.left + 1, word.middle);
	await page.mouse.down();
	await page.mouse.move(word.right - 1, word.middle, { steps: 8 });
	await page.mouse.up();
	const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selectedText.trim().length).toBeGreaterThan(0);
	expect("Blue environment").toContain(selectedText);
	expect(selectedText).not.toBe("Blue environment");
	await expect(option).toHaveAttribute("aria-pressed", "false");
	const initialHeight = (await draft.boundingBox())!.height;
	await draft.fill("A long answer with enough words to wrap across multiple lines in this form. ".repeat(8));
	expect((await draft.boundingBox())!.height).toBeGreaterThan(initialHeight);
	await draft.fill("canary");
	await form.getByRole("button", { name: "Copy", exact: true }).click();
	await expect(page.locator("body")).toHaveAttribute("data-copied-option", "Blue environment");
	await expect(draft).toHaveValue("canary");
	await expect(option).toHaveAttribute("aria-pressed", "false");
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

test("display switches align with ordinary settings before and after restoring the terminal value", async () => {
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog");
	await settings.getByPlaceholder("Search settings…").fill("Show usage for each response");
	await settings.getByRole("button", { name: /^Show usage for each response/ }).click();
	const tracks = settings.locator("#setting-gui-display .omp-switch-track");
	const reference = settings.locator("#setting-gui-askInline .omp-switch-track");
	const checkAlignment = async () => {
		const right = await reference.evaluate(node => node.getBoundingClientRect().right);
		await expect(tracks).toHaveCount(8);
		const edges = await tracks.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
		for (const edge of edges) expect(Math.abs(edge - right)).toBeLessThan(1);
	};
	const row = settings.locator("#setting-gui-showTokenUsage");
	const toggle = row.getByRole("switch");
	const restore = row.getByRole("button", { name: "Use terminal setting", exact: true });
	const inherited = await toggle.getAttribute("aria-checked");
	await expect(restore).toHaveCount(0);
	await checkAlignment();
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", inherited === "true" ? "false" : "true");
	await expect(restore).toBeVisible();
	await checkAlignment();
	await restore.click();
	await expect(restore).toHaveCount(0);
	await expect(toggle).toHaveAttribute("aria-checked", inherited!);
	await checkAlignment();
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

test("Model recovery: manual selection restores reasoning without a model change event", async () => {
	const thinking = page.getByTitle(/^Thinking:/);
	await thinking.click();
	await expect(page.getByText("The current model does not support reasoning.")).toBeVisible();
	await page.keyboard.press("Escape");
	await page.locator("[data-model-picker-trigger]:visible").click();
	await page.getByRole("textbox", { name: "Search models" }).fill("local-fixture");
	await page.getByRole("option", { name: /Local fixture/ }).click();
	await thinking.click();
	await page.getByRole("menuitemradio", { name: /^High\b/ }).click();
	await expect(thinking).toHaveAttribute("title", /Thinking: High/);
	await expect.poll(async () => (await recorded("set_thinking_level")).at(-1)?.level).toBe("high");
});

test("#88 composer and transcript images open full-window without switching the inspector", async () => {
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
	const file = path.join(profile, "project", "chart.png");
	await fs.writeFile(file, Buffer.from(png, "base64"));
	await page.locator('.omp-composer-box input[type="file"]').setInputFiles(file);
	const viewer = page.locator('[role="dialog"][data-image-viewer]');
	async function verifyPopup(trigger: Locator) {
		await trigger.click();
		await expect(viewer).toBeVisible();
		await expect(viewer.locator("img")).toHaveAttribute("src", `data:image/png;base64,${png}`);
		await expect(page.locator('[data-inspector="closed"]')).toBeVisible();
		const close = viewer.getByRole("button", { name: "Close", exact: true });
		await expect(close).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(viewer.getByRole("button", { name: /^Zoom in\b/ })).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(close).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(viewer).toHaveCount(0);
	}
	await verifyPopup(page.locator("[data-composer-attachments] img"));
	const emit = await rendererEvents();
	await emit([
		{
			type: "message_end",
			message: {
				role: "assistant",
				timestamp: Date.now(),
				content: [{ type: "text", text: "![Saved chart](chart.png)\n\n[Original file](chart.png)" }],
			},
		},
	]);
	await verifyPopup(page.getByRole("button", { name: "Saved chart" }));
	await verifyPopup(page.getByRole("link", { name: "Original file" }));
});

test("#86 zoomed Mermaid keeps its light canvas", async () => {
	await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
	const emit = await rendererEvents();
	await emit([
		{
			type: "message_end",
			message: {
				role: "assistant",
				timestamp: Date.now(),
				content: [{ type: "text", text: "```mermaid\ngraph TD\nA[Start] --> B[Finish]\n```" }],
			},
		},
	]);
	const diagram = page.getByRole("button", { name: /diagram/i });
	const canvas = await diagram.evaluate(element => getComputedStyle(element.parentElement!).backgroundColor);
	await diagram.click();
	await expect(page.locator("[data-image-viewer] img")).toHaveCSS("background-color", canvas);
	await page.keyboard.press("Escape");
	await expect(page.locator("[data-image-viewer]")).toHaveCount(0);
});

test("#87 font placeholders and conversation detail labels fit their settings controls", async () => {
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog");
	await settings.getByPlaceholder("Search settings…").fill("Interface font");
	await settings.getByRole("button", { name: /^Interface font\b/ }).click();
	for (const name of ["Interface font", "Code font"]) {
		const field = settings.getByRole("textbox", { name, exact: true });
		await expect(field).toBeVisible();
		expect(
			await field.evaluate(element => {
				const input = element as HTMLInputElement;
				const style = getComputedStyle(input);
				const canvas = document.createElement("canvas").getContext("2d")!;
				canvas.font = `${style.fontSize} ${style.fontFamily}`;
				const availableWidth = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
				return availableWidth - canvas.measureText(input.placeholder).width;
			}),
		).toBeGreaterThan(0);
	}
	const compact = settings.getByRole("button", { name: "Compact (recommended)", exact: true });
	expect(await compact.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

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

test("background job notifications stay inside the process on delivery and after reload", async () => {
	await command("fixture background notification");
	for (const reload of [false, true]) {
		if (reload) await page.reload();
		const transcript = page.locator(".omp-transcript-canvas");
		await expect(transcript.getByText("Local fixture reply", { exact: true })).toBeVisible();
		const process = transcript.locator(".omp-execution-group-header");
		await expect(process).toHaveAttribute("aria-expanded", "false");
		const notice = transcript.locator("summary").filter({ hasText: "Background job output · bg_1" });
		await expect(notice).not.toBeVisible();
		await process.click();
		await expect(notice).toBeVisible();
		await expect(transcript).not.toContainText("building arm64 DMG");
		await notice.click();
		await expect(transcript.getByText("building arm64 DMG", { exact: true })).toBeVisible();
		await expect(transcript).not.toContainText(/async-notify|INTERNAL_BUILD_COMMAND|PRIVATE_MATCH_PATTERN/);
	}
});

test("dynamic view folds both narrated tool rounds when the first answer text arrives", async () => {
	const emit = await rendererEvents();
	await page.locator("[data-view-controls-trigger]").click();
	await page.locator('[data-process-preset="balanced"]').click();
	await page.keyboard.press("Escape");
	const start = Date.now();
	const answer = { role: "assistant", timestamp: start + 3 } as const;
	await emit([
		{ type: "agent_start" },
		...["Inspect the schema.", "Check the generated mappings."].map(
			(text, index): AgentSessionEvent => ({
				type: "message_end",
				message: {
					role: "assistant",
					timestamp: start + index,
					content: [
						{ type: "thinking", thinking: "Check the evidence." },
						{ type: "text", text },
						{
							type: "toolCall",
							id: `inspect-${index}`,
							name: "bash",
							arguments: { command: `npm test -- ${"packages/renderer/test/conversation.test.ts ".repeat(18)}` },
						},
					],
				},
			}),
		),
	]);
	const narration = page.getByText("Inspect the schema.", { exact: true });
	await expect(narration).toBeVisible();
	const conclusion = "The schema is complete.";
	await emit([
		{ type: "message_start", message: answer },
		{
			type: "message_update",
			message: answer,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: conclusion },
		},
	]);
	const group = page.locator(".omp-execution-group-header");
	await expect(page.getByText(conclusion, { exact: true })).toBeVisible();
	await expect(group).toHaveAttribute("aria-expanded", "false");
	await expect(narration).toBeHidden();
	await emit([{ type: "message_end", message: { ...answer, content: [{ type: "text", text: conclusion }] } }]);
	await expect(group).toHaveAttribute("aria-expanded", "false");
	const answerText = page.locator('[data-transcript-kind="message"]').getByText(conclusion, { exact: true });
	await expect
		.poll(async () => {
			const summaryBox = await group.boundingBox();
			const answerBox = await answerText.boundingBox();
			return summaryBox && answerBox ? answerBox.y - summaryBox.y - summaryBox.height : 0;
		})
		.toBeGreaterThanOrEqual(8);
	expect(await group.getByRole("status").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
	await group.click();
	await expect(narration).toBeVisible();
	await expect(page.getByText("Check the generated mappings.", { exact: true })).toBeVisible();
	await expect(answerText).toBeVisible();
});

test("Read alignment: single, grouped, and live reads use the same tool row columns", async () => {
	const emit = await rendererEvents();
	const timestamp = Date.now();
	await emit([
		{ type: "agent_start" },
		{
			type: "message_end",
			message: {
				role: "assistant",
				timestamp,
				content: [
					{ type: "toolCall", id: "read-one", name: "read", arguments: { path: "src/types.ts:280-360" } },
					{ type: "toolCall", id: "bash-between", name: "bash", arguments: { command: "ls src" } },
					{ type: "toolCall", id: "read-two", name: "read", arguments: { path: "src/config.ts:1-20" } },
					{ type: "toolCall", id: "read-three", name: "read", arguments: { path: "src/config.ts:21-40" } },
				],
			},
		},
		{ type: "message_start", message: { role: "assistant", timestamp: timestamp + 1 } },
		{ type: "tool_execution_start", toolCallId: "read-live", toolName: "read", args: { path: "src/live.ts" } },
	]);

	const headers = page.locator(".omp-tool-header");
	const single = headers.filter({ hasText: "src/types.ts:280-360" });
	const group = headers.filter({ hasText: "src/config.ts" });
	const live = headers.filter({ hasText: "src/live.ts" });
	const shell = headers.filter({ hasText: "ls src" });
	await expect(group).toContainText("(2)");
	await expect(live).toBeVisible();
	const shellBox = (await shell.boundingBox())!;
	const labelBox = (await single.getByText("Read", { exact: true }).boundingBox())!;
	const summaryBox = (await single.getByText("src/types.ts:280-360", { exact: true }).boundingBox())!;
	for (const [row, summary] of [
		[single, "src/types.ts:280-360"],
		[group, "src/config.ts"],
		[live, "src/live.ts"],
	] as const) {
		const rowBox = (await row.boundingBox())!;
		expect(rowBox.x).toBeCloseTo(shellBox.x, 0);
		expect(rowBox.width).toBeCloseTo(shellBox.width, 0);
		expect(rowBox.height).toBeCloseTo(shellBox.height, 0);
		expect((await row.getByText("Read", { exact: true }).boundingBox())!.x).toBeCloseTo(labelBox.x, 0);
		expect((await row.getByText(summary, { exact: true }).boundingBox())!.x).toBeCloseTo(summaryBox.x, 0);
	}
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
					{ type: "text", text: "The build is ready to continue.  \nNext, send `Enter`." },
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
	const narration = page.locator(".markdown-body p").filter({ hasText: "The build is ready to continue." });
	const group = page.locator(".omp-execution-group-header");
	await expect(narration).toBeHidden();
	await expect(group).toContainText("Wait for command · pty-7");
	await group.click();
	await expect(narration).toBeVisible();
	const send = page.locator(".omp-tool-header").filter({ hasText: "Send input" });
	const wait = page.locator(".omp-tool-header").filter({ hasText: "Wait for command" });
	await expect(send).toContainText("enter · pty-7");
	await expect(page.locator(".omp-message-actions")).toHaveCount(0);
	const narrationSpacing = async () => {
		const [textBox, thinkingBox, toolBox] = await Promise.all([
			narration.boundingBox(),
			page.locator(".omp-thinking-block").boundingBox(),
			send.boundingBox(),
		]);
		if (!textBox || !thinkingBox || !toolBox) throw new Error("Process details must be visible");
		const above = textBox.y - thinkingBox.y - thinkingBox.height;
		const below = toolBox.y - textBox.y - textBox.height;
		expect(above).toBeCloseTo(below, 0);
		expect(textBox.x).toBeCloseTo((await send.locator(".omp-tool-status-icon").boundingBox())!.x, 0);
		return below;
	};
	const trigger = page.locator("[data-view-controls-trigger]");
	await trigger.click();
	await page.locator('[data-density-option="comfortable"]').click();
	const comfortableHeight = await send.evaluate(element => element.getBoundingClientRect().height);
	const comfortableNarrationGap = await narrationSpacing();
	await page.locator('[data-density-option="tight"]').click();
	await expect
		.poll(() => send.evaluate(element => element.getBoundingClientRect().height))
		.toBeLessThan(comfortableHeight);
	const tightNarrationGap = await narrationSpacing();
	expect(tightNarrationGap).toBeGreaterThanOrEqual(1);
	expect(tightNarrationGap).toBeLessThan(comfortableNarrationGap);
	await page.keyboard.press("Escape");
	const sendBox = await send.boundingBox();
	const waitBox = await wait.boundingBox();
	const gap = waitBox!.y - sendBox!.y - sendBox!.height;
	expect(gap).toBeGreaterThanOrEqual(0);
	expect(gap).toBeLessThan(3);
	await page.screenshot({ path: "test-results/transcript-tool-spacing.png", scale: "css", animations: "disabled" });
	await trigger.click();
	await page.locator('[data-process-preset="detailed"]').click();
	await expect(group).toHaveCount(0);
	expect(await narrationSpacing()).toBeGreaterThanOrEqual(1);
});

test("switching sessions restores each inspector tab and its closed state", async () => {
	const inspector = page.locator(".omp-inspector");
	const review = page.locator(".omp-review-toggle");
	const sessions = page.getByRole("tablist", { name: "Session tabs" }).getByRole("tab");
	const browser = inspector.getByRole("button", { name: "Browser", exact: true });
	const files = inspector.getByRole("button", { name: "Files", exact: true });
	await review.click();
	await browser.click();
	await page.getByRole("button", { name: "New Agent Tab", exact: true }).click();
	await expect(sessions).toHaveCount(2);
	await expect(inspector).toHaveCount(0);
	await review.click();
	await files.click();
	await sessions.first().click();
	await expect(browser).toHaveAttribute("aria-pressed", "true");
	await sessions.last().click();
	await expect(files).toHaveAttribute("aria-pressed", "true");
	await inspector.getByTitle("Close panel").click();
	await sessions.first().click();
	await expect(browser).toHaveAttribute("aria-pressed", "true");
	await sessions.last().click();
	await expect(inspector).toHaveCount(0);
});

test("#73 activity moves between the right edge and drawer without covering the composer menu", async () => {
	const peek = page.getByRole("complementary", { name: "Task activity" });
	await expect(peek.getByText("Audit session", { exact: true })).toBeVisible();
	await expect(peek.getByText("project", { exact: true })).toBeVisible();
	await expect(peek.getByText("Local fixture", { exact: true })).toBeVisible();
	await command("fixture dock");
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

test("#92 changing the send key leaves Enter for multiline input", async () => {
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog");
	await settings.getByText("Keyboard shortcuts", { exact: true }).first().click();
	await settings.getByRole("button", { name: "Shift+Enter", exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.omp.prefs.get("shiftEnterToSend"))).toBe(true);
	await page.keyboard.press("Escape");
	await page.reload();
	const composer = page.getByRole("textbox", { name: /Ask omp/ });
	await composer.fill("first line");
	await composer.press("Enter");
	await expect(composer).toHaveValue("first line\n");
	await composer.pressSequentially("second line");
	await composer.press("Shift+Enter");
	await expect
		.poll(async () => (await recorded("prompt")).map(item => item.message))
		.toContain("first line\nsecond line");
});

test("#88 text attachments preview by default and can open in the system app", async () => {
	const file = path.join(profile, "project", "notes.txt");
	await fs.writeFile(file, "Attachment preview contents");
	await command(`Review @"${file}"`);
	const card = page.locator("[data-file-attachment]").getByRole("button", { name: "notes.txt" });
	await card.click();
	const inspector = page.locator(".omp-inspector");
	await expect(inspector.getByText("Attachment preview contents", { exact: true }).first()).toBeVisible();
	await inspector.getByTitle("Close panel").click();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog");
	await settings.getByPlaceholder("Search settings…").fill("Open text files in");
	await settings.getByRole("button", { name: /^Open text files in/ }).click();
	await settings.getByRole("button", { name: "Open in default app", exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.omp.prefs.get("externalTextFiles"))).toBe(true);
	await page.keyboard.press("Escape");
	const invoked = app!.evaluate(({ shell }) => {
		const opened = Promise.withResolvers<string>();
		shell.openPath = async target => {
			opened.resolve(target);
			return "";
		};
		return opened.promise;
	});
	await card.click();
	expect(await invoked).toBe(file);
	await expect(inspector).toHaveCount(0);
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

test("composer height and typography can be adjusted independently and survive reload", async () => {
	const composer = page.locator(".omp-composer-box textarea");
	const metrics = () =>
		composer.evaluate(node => ({
			font: Number.parseFloat(getComputedStyle(node).fontSize),
			hint: Number.parseFloat(getComputedStyle(node, "::placeholder").fontSize),
			rows: Math.round(node.clientHeight / Number.parseFloat(getComputedStyle(node).lineHeight)),
		}));
	const baseline = await metrics();
	const openSettings = async () => {
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByRole("dialog");
		await settings.getByPlaceholder("Search settings…").fill("Composer starting height");
		await settings.getByRole("button", { name: /^Composer starting height/ }).click();
		return settings;
	};
	let settings = await openSettings();
	await settings.getByTitle("Composer starting height (lines) +1", { exact: true }).click();
	await expect.poll(metrics).toEqual({ ...baseline, rows: 2 });
	await settings.getByTitle("Composer text size +10%", { exact: true }).click();
	const larger = { font: baseline.font * 1.1, hint: baseline.hint * 1.1 };
	await page.keyboard.press("Escape");
	await expect.poll(async () => (await metrics()).hint).toBeCloseTo(larger.hint);
	await page.reload();
	await expect.poll(async () => (await metrics()).font).toBeCloseTo(larger.font);
	await expect.poll(async () => (await metrics()).rows).toBe(2);
	await composer.fill("one\ntwo\nthree\nfour");
	await expect.poll(async () => (await metrics()).rows).toBe(4);
	await composer.fill("");
	await expect.poll(async () => (await metrics()).rows).toBe(2);
	settings = await openSettings();
	await settings.getByRole("group", { name: "Composer starting height (lines)" }).getByTitle("Reset (1)").click();
	await settings.getByRole("group", { name: "Composer text size" }).getByTitle("Reset (100%)").click();
	await page.keyboard.press("Escape");
	await expect.poll(metrics).toEqual(baseline);
});
