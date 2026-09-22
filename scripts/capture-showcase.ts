import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _electron as electron, expect, type Page } from "@playwright/test";
import { en } from "../src/renderer/locales/en";
import { zh } from "../src/renderer/locales/zh";
import { projectFiles, showcaseTimestamp } from "./showcase-data";

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
		await expect(page.getByTitle(t["input.model"], { exact: true })).toBeEnabled();
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
			const text = await page.locator("body").innerText();
			if (privateText.some(value => text.includes(value)) || /\/(?:Users|home)\/(?!demo\b)[^\s/]+/.test(text)) {
				throw new Error(`Privacy check failed for ${language}/${name}`);
			}
			if (errors.length > 0) throw new Error(`Renderer errors: ${errors.join("; ")}`);
			await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
			console.log(`Captured ${language}/${name}`);
		}
		async function nav(key: string): Promise<void> {
			const expand = page.getByRole("button", { name: t["sidebar.navigation.expand"], exact: true });
			if (await expand.isVisible()) await expand.click();
			await page.getByRole("button", { name: t[key], exact: true }).first().click();
		}
		async function close(): Promise<void> {
			await page.keyboard.press("Escape");
			await expect(page.getByRole("dialog")).toHaveCount(0);
		}

		await shot("01-conversation");
		await nav("titlebar.workspace");
		await page.getByRole("button", { name: t["panel.tabs.diff"], exact: true }).click();
		const inspector = page.locator(".omp-inspector");
		await inspector.getByRole("button", { name: "M src/components/Preferences.tsx", exact: true }).click();
		await expect(inspector).toContainText('aria-labelledby="preferences-title"');
		const separator = await inspector.getByRole("separator").boundingBox();
		if (!separator) throw new Error("Workspace resize handle is missing");
		await page.mouse.move(separator.x + 2, separator.y + 100);
		await page.mouse.down();
		await page.mouse.move(840, separator.y + 100, { steps: 8 });
		await page.mouse.up();
		await shot("02-workspace");
		await page.getByRole("button", { name: t["panel.close"], exact: true }).click();

		await page.getByTitle(t["input.model"], { exact: true }).click();
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

		await captureSplit(page, t);
		await shot("11-split");
	} finally {
		await app.close();
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

for (const language of ["en", "zh"] as const) await captureLocale(language);
