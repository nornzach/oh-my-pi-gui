import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _electron as electron, expect, type Page } from "@playwright/test";
import { $ } from "bun";
import { en } from "../src/renderer/locales/en";
import { zh } from "../src/renderer/locales/zh";
import { projectFiles, showcaseTimestamp } from "./showcase-data";
import { seedScheduledTasks } from "./showcase-tasks";

const root = path.resolve(import.meta.dir, "..");
const realHome = os.homedir();
const privateText = [realHome, root, process.env.USER].filter((value): value is string => Boolean(value));

async function captureLocale(language: "en" | "zh"): Promise<void> {
	const t = language === "zh" ? zh : en;
	const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-showcase-"));
	const home = path.join(temporary, "home");
	const project = path.join(home, "projects", "aurora-web");
	const agent = path.join(home, ".omp", "agent");
	const desktop = path.join(temporary, "desktop");
	const output = path.join(root, "docs", "screenshots", language);
	await Promise.all([project, agent, desktop, output].map(directory => fs.mkdir(directory, { recursive: true })));
	await Bun.write(
		path.join(desktop, "prefs.json"),
		JSON.stringify({ language, firstRunComplete: true, theme: "dark" }),
	);
	const fixture = path.join(temporary, "omp-showcase");
	await Bun.write(
		fixture,
		`#!/usr/bin/env bun\nimport ${JSON.stringify(path.join(root, "scripts", "showcase-fixture.ts"))};\n`,
	);
	await fs.chmod(fixture, 0o700);
	for (const [filename, contents] of Object.entries(projectFiles)) {
		await Bun.write(path.join(project, filename), contents);
	}
	await Bun.write(
		path.join(project, "package.json"),
		JSON.stringify({ name: "aurora-web", private: true, scripts: { test: "bun test" } }, null, 2),
	);
	const titles =
		language === "zh"
			? ["构建无障碍设置页", "优化搜索交互", "检查主题对比度", "规划组件库"]
			: [
					"Build accessible settings",
					"Refine search interactions",
					"Review theme contrast",
					"Plan a component library",
				];
	for (const [index, title] of titles.entries()) {
		const entries = [
			{ type: "title", title },
			{ type: "session", id: `showcase-${index}`, timestamp: "2026-09-22T08:00:00.000Z", cwd: project },
			{ type: "message", id: `user-${index}`, message: { role: "user", content: title } },
			{
				type: "message",
				id: `assistant-${index}`,
				message: { role: "assistant", content: [{ type: "text", text: title }], stopReason: "stop" },
			},
		];
		await Bun.write(
			path.join(agent, "sessions", "aurora-web", `showcase-${index}.jsonl`),
			`${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`,
		);
	}
	const taskTitles = seedScheduledTasks(path.join(desktop, "scheduler.db"), project, language, Date.now());
	const app = await electron.launch({
		args: [path.join(root, "out", "main", "index.js"), project, `--user-data-dir=${desktop}`],
		cwd: project,
		env: {
			HOME: home,
			USER: "demo",
			LOGNAME: "demo",
			SHELL: "/usr/bin/false",
			PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
			TMPDIR: temporary,
			LANG: "en_US.UTF-8",
			PI_CODING_AGENT_DIR: agent,
			OMP_BUNDLED_OMP: fixture,
			OMP_SHOWCASE_PROJECT: project,
			OMP_SHOWCASE_LANG: language,
			PI_NOTIFICATIONS: "off",
		},
	});
	const errors: string[] = [];
	try {
		await app.context().route("**/*", route => {
			const url = new URL(route.request().url());
			return ["file:", "data:", "blob:"].includes(url.protocol) || ["127.0.0.1", "localhost"].includes(url.hostname)
				? route.continue()
				: route.abort();
		});
		const page = await app.firstWindow();
		const cdp = await app.context().newCDPSession(page);
		await cdp.send("Emulation.setLocaleOverride", { locale: language === "en" ? "en-US" : "zh-CN" });
		await page.clock.install({ time: showcaseTimestamp });
		page.on("pageerror", error => errors.push(error.message));
		page.setDefaultTimeout(15_000);
		await page.setViewportSize({ width: 1440, height: 960 });
		await expect(page.locator("textarea").first()).toBeVisible();
		await page.getByRole("button", { name: t["onboarding.later"], exact: true }).click();
		const modelButton = page.getByTitle(new RegExp(`^${escapeRegExp(t["input.model"])}: `));
		await expect(modelButton).toBeEnabled();
		await expect(page.getByText(titles[0], { exact: true }).first()).toBeVisible();

		async function shot(name: string): Promise<void> {
			await page.mouse.move(1430, 950);
			await page.waitForFunction(() =>
				document.getAnimations().every(animation => {
					const timing = animation.effect?.getComputedTiming();
					return timing?.iterations === Infinity || animation.playState !== "running";
				}),
			);
			await page.evaluate(() => document.fonts.ready);
			for (const canvas of await page.locator("canvas:visible").all()) {
				let previous = "";
				let stable = 0;
				await expect
					.poll(
						async () => {
							const current = (await canvas.screenshot()).toString("base64");
							stable = current === previous ? stable + 1 : 0;
							previous = current;
							return stable;
						},
						{ timeout: 10_000, intervals: [120] },
					)
					.toBeGreaterThanOrEqual(3);
			}
			// shortenPath only knows /Users and /home homes, so the temporary project
			// folder cannot read as ~; show it as it reads on a real machine.
			await page.evaluate(
				([shown, display]) => {
					const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
					for (let node = walker.nextNode(); node; node = walker.nextNode()) {
						if (shown.includes(node.textContent ?? "")) node.textContent = display;
					}
				},
				[[project, middleEllipsis(project)], "~/projects/aurora-web"] as const,
			);
			// macOS draws the window controls over the page, so a page screenshot leaves their
			// strip blank. Draw them where BrowserWindow.getWindowButtonPosition() says they sit.
			await page.evaluate(() => {
				if (document.getElementById("showcase-window-controls")) return;
				const controls = document.createElement("div");
				controls.id = "showcase-window-controls";
				controls.style.cssText =
					"position:fixed;left:16px;top:17px;display:flex;gap:8px;z-index:2147483647;pointer-events:none";
				for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
					const light = document.createElement("span");
					light.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color}`;
					controls.append(light);
				}
				document.body.append(controls);
			});
			const text = await page.locator("body").innerText();
			if (privateText.some(value => text.includes(value)) || /\/(?:Users|home)\/(?!demo\b)[^\s/]+/.test(text)) {
				throw new Error(`Privacy check failed for ${language}/${name}`);
			}
			if (errors.length > 0) throw new Error(`Renderer errors: ${errors.join("; ")}`);
			await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
			console.log(`Captured ${language}/${name}`);
		}
		async function nav(key: string): Promise<void> {
			// A row's accessible name includes its shortcut hint, so match the label text.
			const item = page
				.getByRole("button")
				.filter({ has: page.getByText(t[key], { exact: true }) })
				.first();
			if (await item.isVisible()) return item.click();
			// App-wide tools live in the sidebar's More menu.
			await page.getByRole("button", { name: t["sidebar.navigation.expand"], exact: true }).click();
			await page.getByRole("menuitem", { name: t[key] }).click();
		}
		async function close(): Promise<void> {
			await page.keyboard.press("Escape");
			await expect(page.getByRole("dialog")).toHaveCount(0);
		}
		/** Closes dialogs stacked on each other; an edited form takes a second Escape to discard. */
		async function closeAll(): Promise<void> {
			await expect
				.poll(
					async () => {
						const open = await page.getByRole("dialog").count();
						if (open > 0) await page.keyboard.press("Escape");
						return open;
					},
					{ timeout: 10_000, intervals: [250] },
				)
				.toBe(0);
		}
		async function command(key: string): Promise<void> {
			await nav("titlebar.commands");
			await page.getByPlaceholder(t["palette.search"]).fill(t[key]);
			await page.keyboard.press("Enter");
		}

		await shot("01-conversation");
		// The drawer toggle is named for the change count once the tree is dirty.
		const drawerLabel = [t["titlebar.togglePanel"], t["titlebar.review.changes"]].map(templatePattern).join("|");
		await page.getByRole("button", { name: new RegExp(`^(?:${drawerLabel})$`) }).click();
		const overview = page.getByRole("button", { name: t["panel.tabs.overview"], exact: true });
		await expect(overview).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator(".omp-inspector")).toContainText(t["overview.context.title"]);
		await shot("13-overview");
		await page.getByRole("button", { name: t["panel.tabs.diff"], exact: true }).click();
		const inspector = page.locator(".omp-inspector");
		await expect(inspector).toContainText('aria-labelledby="preferences-title"');
		const separator = await inspector.getByRole("separator").boundingBox();
		if (!separator) throw new Error("Workspace resize handle is missing");
		await page.mouse.move(separator.x + 2, separator.y + 100);
		await page.mouse.down();
		await page.mouse.move(840, separator.y + 100, { steps: 8 });
		await page.mouse.up();
		await shot("02-workspace");
		await page.getByRole("button", { name: t["panel.close"], exact: true }).click();

		await modelButton.click();
		await expect(page.getByPlaceholder(t["modelPicker.placeholder"])).toBeVisible();
		await shot("03-models");
		await close();

		await nav("titlebar.providers");
		await expect(page.getByRole("dialog")).toContainText("Anthropic");
		await shot("04-providers");
		await close();

		await nav("titlebar.commands");
		await page.getByPlaceholder(t["palette.search"]).fill(t["cmd.modelRoles"]);
		await page.keyboard.press("Enter");
		await expect(page.getByRole("dialog")).toContainText(t["modelRoles.title"]);
		await shot("05-model-roles");
		await close();

		await nav("titlebar.agentHub");
		await page.getByRole("tab", { name: new RegExp(`^${t["agentHub.tabs.hub"]}`) }).click();
		await expect(page.getByRole("dialog")).toContainText("scout");
		await shot("06-agent-hub");
		await close();

		await nav("titlebar.stats");
		await page.getByRole("button", { name: "7d", exact: true }).click();
		await expect(page.getByRole("dialog").locator("canvas").first()).toBeVisible();
		await shot("07-statistics");
		await close();

		await page.getByRole("button", { name: new RegExp(`^${t["contextUsage.open"].split("{percent}")[0]}`) }).click();
		await expect(page.getByRole("group", { name: t["contextUsage.title"], exact: true })).toBeVisible();
		await shot("08-context");
		await close();

		await nav("titlebar.commands");
		await expect(page.getByPlaceholder(t["palette.search"])).toBeVisible();
		await shot("09-commands");
		await close();

		await nav("titlebar.settings");
		await expect(page.getByRole("dialog")).toBeVisible();
		await page.getByRole("dialog").getByRole("button", { name: t["settings.nav.experience"], exact: true }).click();
		await shot("10-settings");
		await close();

		await nav("titlebar.usage");
		await expect(page.getByRole("dialog")).toContainText("Anthropic");
		await shot("12-usage");
		await close();

		await command("cmd.theme");
		await page.getByRole("button", { name: t["themePicker.custom.create"], exact: true }).click();
		const themeEditor = page.getByRole("dialog").last();
		await expect(themeEditor).toContainText(t["themeEditor.titleNew"]);
		await themeEditor.locator("input").first().fill("Aurora");
		await themeEditor.getByLabel(t["themeEditor.component.accent"], { exact: true }).fill("#8b5cf6");
		await themeEditor.getByRole("button", { name: t["themeEditor.fromAccent"] }).click();
		await themeEditor.getByText(t["themeEditor.name"], { exact: true }).scrollIntoViewIfNeeded();
		await shot("16-theme-editor");
		await closeAll();

		await nav("titlebar.providers");
		await page.getByRole("button", { name: t["providerCfg.title.add"] }).first().click();
		const providerForm = page.getByRole("dialog").last();
		const providerFields = providerForm.locator("input");
		await providerFields.nth(0).fill("aurora-gateway");
		await providerFields.nth(1).fill("https://gateway.example.test/v1");
		await providerForm.getByRole("button", { name: t["providerCfg.fetch.action"] }).click();
		const fetchedModels = providerForm.locator("[data-model-fetch-panel]");
		await expect(fetchedModels).toContainText("aurora/long-context");
		await fetchedModels.scrollIntoViewIfNeeded();
		await shot("17-fetch-models");
		await closeAll();

		await command("cmd.live");
		const voice = page.getByRole("dialog");
		await voice.getByRole("button", { name: t["live.start"] }).click();
		await expect(voice).toContainText(t["live.assistant"]);
		await shot("18-voice");
		await closeAll();

		await command("cmd.collab");
		const collab = page.getByRole("dialog");
		await collab.getByRole("button", { name: t["collab.start"], exact: true }).click();
		await expect(collab).toContainText(t["collab.hosting"]);
		await shot("19-collab");
		await collab.getByRole("button", { name: t["collab.leave"], exact: true }).click();
		await closeAll();

		await command("cmd.debug");
		const debug = page.getByRole("dialog");
		await expect(debug).toContainText("demo-1");
		await debug.getByRole("button", { name: t["debug.stack"], exact: true }).click();
		await expect(debug).toContainText("renders visible labels");
		await shot("20-debug");
		await close();

		await captureSplit(page, t);
		await shot("11-split");

		// The scheduler runs on the real clock, so these scenes come after the fixed-clock ones.
		await page.clock.setSystemTime(Date.now());
		await nav("tasks.title");
		const tasks = page.getByRole("dialog");
		// With a run awaiting review the window opens on Review; show the task list.
		await tasks.getByRole("tab", { name: t["tasks.view.tasks"], exact: true }).click();
		await expect(tasks).toContainText(taskTitles[0]);
		await shot("14-tasks");
		await tasks.getByRole("tab", { name: t["tasks.view.insights"] }).click();
		await expect(tasks).toContainText(taskTitles[1]);
		await shot("15-task-insights");
		await close();
	} catch (error) {
		const failure = path.join(os.tmpdir(), `omp-showcase-failure-${language}.png`);
		await (await app.firstWindow()).screenshot({ path: failure }).catch(() => {});
		console.error(`Failure screenshot: ${failure}`);
		throw error;
	} finally {
		const closed = await Promise.race([app.close().then(() => true), Bun.sleep(10_000).then(() => false)]);
		if (!closed) app.process().kill("SIGKILL");
		await fs.rm(temporary, { recursive: true, force: true });
	}
}

async function captureSplit(page: Page, t: Record<string, string>): Promise<void> {
	await page.keyboard.press("Meta+t");
	await expect(page.getByRole("tab")).toHaveCount(2);
	await expect(page.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");
	await page.getByRole("tab").first().click({ button: "right" });
	await page.getByText(t["tabs.menu.splitRight"], { exact: true }).click();
	await expect(page.locator("textarea")).toHaveCount(2);
}

/** How shortenPath (src/renderer/lib/format.ts) cuts a path it cannot shorten to ~. */
function middleEllipsis(value: string, max = 56): string {
	if (value.length <= max) return value;
	const keep = Math.floor((max - 1) / 2);
	return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/** A locale template as a pattern: each `{param}` matches anything. */
function templatePattern(template: string): string {
	return escapeRegExp(template).replace(/\\\{\w+\\\}/g, ".*");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The landing page's images, cut from the showcase so the two can't drift apart. Needs `cwebp` on PATH. */
const siteAssets: Record<string, string> = {
	overview: "en/13-overview",
	"split-view": "en/11-split",
	"dock-agents": "en/01-conversation",
	"agent-hub": "en/06-agent-hub",
	"scheduled-tasks": "en/14-tasks",
	"task-insights": "en/15-task-insights",
	"context-breakdown": "en/08-context",
	"command-palette-zh": "zh/09-commands",
	"theme-editor": "en/16-theme-editor",
	"fetch-models": "en/17-fetch-models",
	"04-voice": "en/18-voice",
	"05-collab": "en/19-collab",
	"06-debug": "en/20-debug",
};

/**
 * These dialogs are unreadable at card width inside a full window, so the page shows the part that matters,
 * at the 16:10 its cards display. Fetch models frames the fetched rows, which sit at the dialog's bottom.
 */
const siteAssetCrops: Record<string, string[]> = {
	"theme-editor": ["-crop", "240", "54", "960", "600"],
	"fetch-models": ["-crop", "240", "274", "960", "600"],
};

for (const language of ["en", "zh"] as const) await captureLocale(language);
for (const [asset, source] of Object.entries(siteAssets)) {
	const input = path.join(root, "docs", "screenshots", `${source}.png`);
	const output = path.join(root, "site", "assets", `${asset}.webp`);
	const crop = siteAssetCrops[asset] ?? [];
	await $`cwebp -quiet -q 82 -m 6 ${crop} ${input} -o ${output}`;
	console.log(`Wrote site/assets/${asset}.webp`);
}
