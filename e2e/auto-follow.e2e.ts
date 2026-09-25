import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

/** Distance from the bottom that still counts as "riding the live edge". Row
 * re-measurement during streaming overshoots a few pixels, so this is deliberately
 * looser than the app's own slack while still ruling out a stranded view. */
const LIVE_EDGE_PX = 200;

test("a bottom-pinned transcript rides the stream, and 'jump to latest' re-engages it", async () => {
	test.setTimeout(150_000);
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-follow-"));
	const desktop = path.join(profile, "desktop"),
		agent = path.join(profile, "agent"),
		project = path.join(profile, "project");
	await Promise.all([fs.mkdir(desktop), fs.mkdir(agent), fs.mkdir(project)]);
	await fs.writeFile(path.join(desktop, "prefs.json"), JSON.stringify({ language: "en" }));
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: agent,
		PI_CONFIG_DIR: path.relative(os.homedir(), profile),
		OMP_PROFILE: "",
		PI_PROFILE: "",
		OMP_BUNDLED_OMP: path.resolve("e2e/sidecar-fixture.ts"),
		// Enough history that an abort leaves something to scroll up through, which is
		// the state a reader is actually in when they send the next message.
		OMP_GUI_TEST_HISTORY: "300",
	};
	Reflect.deleteProperty(env, "ELECTRON_RUN_AS_NODE");
	const app = await electron.launch({
		args: [path.resolve("out/main/index.js"), project, `--user-data-dir=${desktop}`],
		env,
	});
	const page = await app.firstWindow();
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	try {
		const scroll = page.locator(".omp-transcript-scroll");
		const input = page.locator("textarea").first();
		await expect(input).toBeVisible({ timeout: 60_000 });

		const gap = () => scroll.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
		const height = () => scroll.evaluate(node => node.scrollHeight);
		const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
		// The control is always mounted and fades out while pinned, so Playwright's
		// visibility check cannot tell "offered" from "hidden"; interactivity can.
		const jumpOffered = () => jump.evaluate(node => getComputedStyle(node).pointerEvents !== "none");
		const send = async (text: string) => {
			await input.fill(text);
			await page.getByRole("button", { name: "Send (Enter)", exact: true }).click();
			await expect(page.getByRole("button", { name: "Abort", exact: true })).toBeVisible();
		};
		const abort = async () => {
			await page.getByRole("button", { name: "Abort", exact: true }).click();
			await expect(page.getByRole("button", { name: "Abort", exact: true })).toHaveCount(0);
		};
		const scrollUp = async () => {
			await scroll.hover();
			await page.mouse.wheel(0, -1500);
			await expect.poll(jumpOffered).toBe(true);
			expect(await gap()).toBeGreaterThan(LIVE_EDGE_PX);
		};
		// The fixture streams a chunk every 16ms, so a handful of samples proves
		// sustained following rather than one lucky frame.
		const ridesTheStream = async (ticks: number) => {
			const trace: string[] = [];
			let growth = 0;
			let previousHeight = 0;
			// A reclaim converges on the tail over a few frames, so the first sample
			// would otherwise measure the edge moving away faster than the chase closes.
			await expect.poll(gap, { timeout: 3_000, intervals: [50] }).toBeLessThan(LIVE_EDGE_PX);
			for (let tick = 0; tick < ticks; tick++) {
				const measured = await height();
				if (previousHeight && measured > previousHeight) growth++;
				previousHeight = measured;
				const distance = await gap();
				trace.push(`${distance}@${measured}`);
				expect(distance, `gap@height trace ${trace.join(" → ")}`).toBeLessThan(LIVE_EDGE_PX);
				await page.waitForTimeout(120);
			}
			// Without real growth the loop would only prove an idle view stands still.
			expect(growth, `gap@height trace ${trace.join(" → ")}`).toBeGreaterThan(ticks / 3);
		};
		// A reader who scrolled up owns the viewport: the distance from the bottom may
		// only grow while content arrives, never shrink back toward the live edge.
		const holdsPosition = async (ticks: number) => {
			const gaps: number[] = [];
			for (let tick = 0; tick < ticks; tick++) {
				gaps.push(await gap());
				await page.waitForTimeout(80);
			}
			for (let tick = 1; tick < gaps.length; tick++) {
				expect(gaps[tick], `gap trace ${gaps.join(" → ")}`).toBeGreaterThanOrEqual(gaps[tick - 1] - 4);
			}
			expect(gaps[gaps.length - 1], `gap trace ${gaps.join(" → ")}`).toBeGreaterThan(LIVE_EDGE_PX);
		};

		await send("fixture stream");

		// Send reclaims the live edge, and every later chunk has to keep it.
		await expect.poll(gap).toBeLessThan(LIVE_EDGE_PX);
		await ridesTheStream(12);
		expect(await jumpOffered()).toBe(false);

		await scrollUp();
		const heldHeight = await height();
		await holdsPosition(8);
		expect(await height()).toBeGreaterThan(heldHeight);

		// Re-engaged means it keeps following, not that it jumped once.
		await jump.click();
		await expect.poll(gap).toBeLessThan(LIVE_EDGE_PX);
		expect(await jumpOffered()).toBe(false);
		await ridesTheStream(6);

		// Scrolling back down to the tail re-engages on its own: intent is a gesture
		// toward the tail, so the reader never has to reach for the control.
		await scrollUp();
		for (let step = 0; step < 60 && (await jumpOffered()); step++) await page.mouse.wheel(0, 1_500);
		expect(await jumpOffered()).toBe(false);
		await ridesTheStream(6);
		await abort();

		// A fresh send reclaims the live edge even from a view the reader had scrolled
		// up: the reply must not render off-screen below the fold.
		await scrollUp();
		await send("fixture stream");
		await expect.poll(gap).toBeLessThan(LIVE_EDGE_PX);
		expect(await jumpOffered()).toBe(false);
		await ridesTheStream(6);
		await abort();

		await page.screenshot({ path: "test-results/auto-follow.png", scale: "css", animations: "disabled" });
		expect(errors).toEqual([]);
	} finally {
		// Test teardown bypasses the production quit confirmation.
		await app.evaluate(({ app }) => app.exit(0));
		await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
