/**
 * Network side of the Plugins page: plugin logos and the "what it adds" preview.
 *
 * Logos run here rather than in the page because the renderer's content security
 * policy deliberately has no remote image sources; the page gets a data URL.
 * Only organizations get one: a personal account's avatar is usually that person's
 * photo, and it would sit on every plugin they list, whoever wrote it.
 * Both only ask GitHub, with every URL part validated, and send no cookies or
 * tokens. A failure degrades (initial instead of a logo, no preview) and never
 * blocks installing.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { IpcPluginInspection, IpcPluginInspectPayload } from "../shared/ipc-types";
import { PLUGIN_MANIFEST_PATHS, pluginConfigFilesToRead, summarizePluginEffects } from "../shared/plugin-effects";
import { isValidGithubOwner, isValidGithubRepo, isValidGitRef, normalizeRepoPath } from "../shared/plugin-source";
import { sniffImageMime } from "./fs-image";

const MAX_LOGO_BYTES = 512_000;
const LOGO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOGO_RETRY_AFTER_MS = 10 * 60 * 1000;
const ACCOUNT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Saved beside the logo. Account names can't contain a dot, so this can't collide with one. */
const ACCOUNT_FILE_SUFFIX = ".account";
const ORGANIZATION = "organization";
const PERSONAL = "personal";
/** Cards ask for logos one by one, milliseconds apart. Waiting this long puts a whole screen in one request. */
const LOOKUP_GATHER_MS = 100;
const MAX_ACCOUNTS_PER_LOOKUP = 50;
/** A lost request would cost a whole screen of logos, so it gets more than one try. */
const LOOKUP_ATTEMPTS = 3;
const LOOKUP_RETRY_WAIT_MS = 5_000;
const GITHUB_API_HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
const MAX_CONCURRENT_LOGOS = 6;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONFIG_BYTES = 256_000;
const MAX_README_BYTES = 64_000;
const MAX_CACHED_INSPECTIONS = 100;
const RASTER_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const README_PATTERN = /^readme(?:\.(?:md|markdown))?$/i;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface PluginCatalogDeps {
	fetch: Fetch;
	logoCacheDir: string;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

interface TreeResponse {
	tree?: Array<{ path?: unknown; type?: unknown }>;
	truncated?: unknown;
}

interface AccountSearchResponse {
	items?: Array<{ login?: unknown; type?: unknown }>;
}

/** Reads a response body up to `maxBytes`. Past the limit: the first part when `truncate`, otherwise null. */
async function readCapped(response: Response, maxBytes: number, truncate = false): Promise<Buffer | null> {
	const reader = response.body?.getReader();
	if (!reader) return Buffer.alloc(0);
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.byteLength;
			if (total > maxBytes) {
				if (!truncate) return null;
				return Buffer.concat(chunks).subarray(0, maxBytes);
			}
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	return Buffer.concat(chunks);
}

function logoDataUrl(bytes: Buffer): string | null {
	const mime = sniffImageMime(bytes.subarray(0, 512));
	if (!mime || !RASTER_LOGO_TYPES.has(mime)) return null;
	return `data:${mime};base64,${bytes.toString("base64")}`;
}

function parseJsonObject(bytes: Buffer | null): Record<string, unknown> | null {
	if (!bytes) return null;
	try {
		const parsed: unknown = JSON.parse(bytes.toString("utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function rawFileUrl(owner: string, repo: string, ref: string, file: string): string {
	const encodedFile = file.split("/").map(encodeURIComponent).join("/");
	return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURI(ref)}/${encodedFile}`;
}

export class PluginCatalog {
	#deps: PluginCatalogDeps;
	#logoRequests = new Map<string, Promise<string | null>>();
	#logoRetryAt = new Map<string, number>();
	#waitingAccounts = new Map<string, (isOrganization: boolean | null) => void>();
	#accountLookupsRunning = false;
	#accountLookupsPausedUntil = 0;
	#activeLogos = 0;
	#logoQueue: Array<() => void> = [];
	#inspections = new Map<string, IpcPluginInspection>();

	constructor(deps: PluginCatalogDeps) {
		this.#deps = deps;
	}

	#now(): number {
		return this.#deps.now?.() ?? Date.now();
	}

	/** An organization's avatar as a data URL, or null for a personal account or when there isn't a usable one. */
	logo(owner: unknown): Promise<string | null> {
		if (typeof owner !== "string" || !isValidGithubOwner(owner)) return Promise.resolve(null);
		const key = owner.toLowerCase();
		const pending = this.#logoRequests.get(key);
		if (pending) return pending;
		const request = this.#loadLogo(key).finally(() => this.#logoRequests.delete(key));
		this.#logoRequests.set(key, request);
		return request;
	}

	async #loadLogo(key: string): Promise<string | null> {
		const file = path.join(this.#deps.logoCacheDir, key);
		if (!(await this.#isOrganization(key, file))) return null;
		const cached = await this.#readCachedLogo(file);
		if (cached?.fresh) return cached.url;
		if ((this.#logoRetryAt.get(key) ?? 0) > this.#now()) return cached?.url ?? null;

		const bytes = await this.#withLogoSlot(() => this.#downloadLogo(key));
		const url = bytes ? logoDataUrl(bytes) : null;
		if (!bytes || !url) {
			this.#logoRetryAt.set(key, this.#now() + LOGO_RETRY_AFTER_MS);
			return cached?.url ?? null;
		}
		this.#logoRetryAt.delete(key);
		await this.#writeCacheFile(file, bytes);
		return url;
	}

	/** An account whose type isn't known counts as personal, so a failed lookup costs a logo and never shows a face. */
	async #isOrganization(key: string, logoFile: string): Promise<boolean> {
		const accountFile = `${logoFile}${ACCOUNT_FILE_SUFFIX}`;
		const cached = await this.#readCacheFile(accountFile, ACCOUNT_MAX_AGE_MS);
		const known = cached?.bytes.toString() === ORGANIZATION;
		if (cached?.fresh || (this.#logoRetryAt.get(key) ?? 0) > this.#now()) return known;

		const isOrganization = await this.#lookUpAccount(key);
		if (isOrganization === null) {
			this.#logoRetryAt.set(key, this.#now() + LOGO_RETRY_AFTER_MS);
			return known;
		}
		await this.#writeCacheFile(accountFile, Buffer.from(isOrganization ? ORGANIZATION : PERSONAL));
		// Also removes photos saved before logos were limited to organizations.
		if (!isOrganization) await fsp.rm(logoFile, { force: true }).catch(() => {});
		return isOrganization;
	}

	/** Whether GitHub says this is an organization, or null when it can't be found out right now. */
	#lookUpAccount(key: string): Promise<boolean | null> {
		const { promise, resolve } = Promise.withResolvers<boolean | null>();
		this.#waitingAccounts.set(key, resolve);
		if (!this.#accountLookupsRunning) {
			this.#accountLookupsRunning = true;
			void this.#runAccountLookups();
		}
		return promise;
	}

	/** One request at a time. Whoever arrives during a request or a pause goes in the next one. */
	async #runAccountLookups(): Promise<void> {
		await this.#sleep(LOOKUP_GATHER_MS);
		let failures = 0;
		while (this.#waitingAccounts.size > 0) {
			await this.#sleep(this.#accountLookupsPausedUntil - this.#now());
			const keys = [...this.#waitingAccounts.keys()].slice(0, MAX_ACCOUNTS_PER_LOOKUP);
			const answers = await this.#searchAccounts(keys);
			if (!answers && ++failures < LOOKUP_ATTEMPTS) {
				this.#accountLookupsPausedUntil = Math.max(
					this.#accountLookupsPausedUntil,
					this.#now() + LOOKUP_RETRY_WAIT_MS,
				);
				continue;
			}
			failures = 0;
			for (const key of keys) {
				this.#waitingAccounts.get(key)?.(answers?.get(key) ?? null);
				this.#waitingAccounts.delete(key);
			}
		}
		this.#accountLookupsRunning = false;
	}

	/**
	 * Search rather than GET /users/<name>: it answers for many accounts at once, and its allowance isn't the 60 requests
	 * an hour the plugin preview needs. It can leave an account out, which stays unknown rather than counting as personal.
	 * Null when the request failed.
	 */
	async #searchAccounts(keys: string[]): Promise<Map<string, boolean> | null> {
		try {
			const query = encodeURIComponent(keys.map(key => `user:${key}`).join(" "));
			const response = await this.#deps.fetch(`https://api.github.com/search/users?per_page=100&q=${query}`, {
				credentials: "omit",
				headers: GITHUB_API_HEADERS,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			this.#pauseLookupsIfNeeded(response);
			// GitHub's answer when none of the accounts in the request can be searched. Trying again won't change it.
			if (response.status === 422) return new Map();
			if (!response.ok) return null;
			const body = parseJsonObject(await readCapped(response, MAX_CONFIG_BYTES)) as AccountSearchResponse | null;
			if (!body) return null;
			const answers = new Map<string, boolean>();
			for (const { login, type } of body.items ?? []) {
				if (typeof login === "string" && typeof type === "string") {
					answers.set(login.toLowerCase(), type === "Organization");
				}
			}
			return answers;
		} catch {
			return null;
		}
	}

	/** When GitHub refuses or the allowance is spent, waits for it to come back, going by GitHub's clock and for a limited time. */
	#pauseLookupsIfNeeded(response: Response): void {
		const spent = response.headers.get("x-ratelimit-remaining") === "0";
		if (!spent && response.status !== 403 && response.status !== 429) return;
		const answeredAt = Date.parse(response.headers.get("date") ?? "");
		const clock = Number.isNaN(answeredAt) ? this.#now() : answeredAt;
		const untilReset = Number(response.headers.get("x-ratelimit-reset")) * 1000 - clock;
		const wait = untilReset > 0 ? Math.min(untilReset, LOGO_RETRY_AFTER_MS) : LOGO_RETRY_AFTER_MS;
		this.#accountLookupsPausedUntil = this.#now() + wait;
	}

	async #sleep(ms: number): Promise<void> {
		if (ms > 0) await (this.#deps.sleep ?? delay)(ms);
	}

	async #readCachedLogo(file: string): Promise<{ url: string; fresh: boolean } | null> {
		const cached = await this.#readCacheFile(file, LOGO_MAX_AGE_MS);
		const url = cached ? logoDataUrl(cached.bytes) : null;
		return cached && url ? { url, fresh: cached.fresh } : null;
	}

	async #readCacheFile(file: string, maxAgeMs: number): Promise<{ bytes: Buffer; fresh: boolean } | null> {
		try {
			const [bytes, stat] = await Promise.all([fsp.readFile(file), fsp.stat(file)]);
			return { bytes, fresh: this.#now() - stat.mtimeMs < maxAgeMs };
		} catch {
			return null;
		}
	}

	/** Best effort: what can't be cached is still shown. */
	async #writeCacheFile(file: string, bytes: Buffer): Promise<void> {
		const partial = `${file}.${process.pid}.tmp`;
		try {
			await fsp.mkdir(path.dirname(file), { recursive: true });
			await fsp.writeFile(partial, bytes);
			await fsp.rename(partial, file);
		} catch {
			await fsp.rm(partial, { force: true }).catch(() => {});
		}
	}

	async #withLogoSlot<T>(run: () => Promise<T>): Promise<T> {
		if (this.#activeLogos >= MAX_CONCURRENT_LOGOS) {
			const { promise, resolve } = Promise.withResolvers<void>();
			this.#logoQueue.push(resolve);
			await promise;
		}
		this.#activeLogos++;
		try {
			return await run();
		} finally {
			this.#activeLogos--;
			this.#logoQueue.shift()?.();
		}
	}

	async #downloadLogo(key: string): Promise<Buffer | null> {
		try {
			// This redirects to GitHub's avatar host. The bytes are checked afterwards, whatever served them.
			const response = await this.#deps.fetch(`https://github.com/${key}.png?size=128`, {
				credentials: "omit",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!response.ok) return null;
			return await readCapped(response, MAX_LOGO_BYTES);
		} catch {
			return null;
		}
	}

	/** What installing would add, read from the plugin's repository. Results that succeeded are remembered. */
	async inspect(payload: IpcPluginInspectPayload): Promise<IpcPluginInspection> {
		const owner = payload?.owner;
		const repo = payload?.repo;
		const rootPath = payload?.path === undefined ? "" : normalizeRepoPath(String(payload.path));
		const ref = payload?.ref;
		if (
			typeof owner !== "string" ||
			typeof repo !== "string" ||
			!isValidGithubOwner(owner) ||
			!isValidGithubRepo(repo) ||
			rootPath === null ||
			(ref !== undefined && (typeof ref !== "string" || !isValidGitRef(ref)))
		) {
			return { status: "unavailable" };
		}
		const resolvedRef = ref ?? "HEAD";
		const key = JSON.stringify([owner, repo, resolvedRef, rootPath, payload.components ?? null]);
		const remembered = this.#inspections.get(key);
		if (remembered) return remembered;

		const result = await this.#inspectRepository(owner, repo, resolvedRef, rootPath, payload);
		if (result.status === "ok") {
			if (this.#inspections.size >= MAX_CACHED_INSPECTIONS) {
				const oldest = this.#inspections.keys().next().value;
				if (oldest !== undefined) this.#inspections.delete(oldest);
			}
			this.#inspections.set(key, result);
		}
		return result;
	}

	async #inspectRepository(
		owner: string,
		repo: string,
		ref: string,
		rootPath: string,
		payload: IpcPluginInspectPayload,
	): Promise<IpcPluginInspection> {
		let tree: TreeResponse;
		try {
			const response = await this.#deps.fetch(
				`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
				{
					credentials: "omit",
					headers: GITHUB_API_HEADERS,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				},
			);
			if (response.status === 403 || response.status === 429) return { status: "rate-limited" };
			if (response.status === 404) return { status: "not-found" };
			if (!response.ok) return { status: "unavailable" };
			tree = (await response.json()) as TreeResponse;
		} catch {
			return { status: "unavailable" };
		}

		const prefix = rootPath ? `${rootPath}/` : "";
		const files = new Set<string>();
		for (const entry of tree.tree ?? []) {
			if (entry.type !== "blob" || typeof entry.path !== "string" || !entry.path.startsWith(prefix)) continue;
			files.add(entry.path.slice(prefix.length));
		}
		if (files.size === 0 && !tree.truncated) return { status: "not-found" };

		const readRaw = async (file: string, maxBytes: number, truncate = false): Promise<Buffer | null> => {
			try {
				const response = await this.#deps.fetch(rawFileUrl(owner, repo, ref, `${prefix}${file}`), {
					credentials: "omit",
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
				if (!response.ok) return null;
				return await readCapped(response, maxBytes, truncate);
			} catch {
				return null;
			}
		};

		const manifestFile = PLUGIN_MANIFEST_PATHS.find(file => files.has(file));
		const manifest = manifestFile ? parseJsonObject(await readRaw(manifestFile, MAX_CONFIG_BYTES)) : null;
		const wanted = pluginConfigFilesToRead(files, manifest, payload.components);
		const readmeFile = [...files]
			.filter(file => README_PATTERN.test(file))
			.sort((a, b) => Number(/\.md$/i.test(b)) - Number(/\.md$/i.test(a)))[0];
		const [configEntries, readme] = await Promise.all([
			Promise.all(wanted.map(async file => [file, parseJsonObject(await readRaw(file, MAX_CONFIG_BYTES))] as const)),
			readmeFile ? readRaw(readmeFile, MAX_README_BYTES, true) : Promise.resolve(null),
		]);
		const unreadable =
			configEntries.some(([, config]) => config === null) || (manifestFile !== undefined && manifest === null);

		return {
			status: "ok",
			effects: summarizePluginEffects({
				files,
				manifest,
				configs: new Map(configEntries),
				components: payload.components,
			}),
			...(readme ? { readme: readme.toString("utf8") } : {}),
			partial: tree.truncated === true || unreadable,
		};
	}
}
