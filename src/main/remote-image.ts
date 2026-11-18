import { FS_IMAGE_MAX_BYTES, sniffImageMime } from "./fs-image";

const FETCH_TIMEOUT_MS = 15_000;

/** Fetch only when the user asks to load an image. Return inert image data to the renderer. */
export async function fetchRemoteImage(address: unknown): Promise<string | null> {
	if (typeof address !== "string") return null;
	const url = URL.parse(address);
	if (!url || (url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
		return null;
	}

	const abort = new AbortController();
	try {
		const response = await fetch(url, {
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: AbortSignal.any([abort.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
		});
		if (!response.ok || !response.body || Number(response.headers.get("content-length")) > FS_IMAGE_MAX_BYTES) {
			return null;
		}

		const chunks: Uint8Array[] = [];
		let size = 0;
		const reader = response.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > FS_IMAGE_MAX_BYTES) return null;
			chunks.push(value);
		}
		const bytes = Buffer.concat(chunks, size);
		const mime = sniffImageMime(bytes.subarray(0, 512));
		return mime ? `data:${mime};base64,${bytes.toString("base64")}` : null;
	} catch {
		return null;
	} finally {
		abort.abort();
	}
}
