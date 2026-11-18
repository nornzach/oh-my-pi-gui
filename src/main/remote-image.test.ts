import { afterEach, expect, it, vi } from "vitest";
import { FS_IMAGE_MAX_BYTES } from "./fs-image";
import { fetchRemoteImage } from "./remote-image";

afterEach(() => vi.unstubAllGlobals());

it("rejects unsupported URLs before making a request", async () => {
	const fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	for (const address of [null, "file:///picture.png", "https://user:password@example.com/picture.png"]) {
		expect(await fetchRemoteImage(address)).toBeNull();
	}
	expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects non-images even if the host serves an image content type", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response("<html>Login required</html>", {
					headers: { "Content-Type": "image/png" },
				}),
		),
	);
	expect(await fetchRemoteImage("https://example.com/picture.png")).toBeNull();
});

it("cancels the request when the stream exceeds the image size limit", async () => {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(FS_IMAGE_MAX_BYTES + 1));
		},
	});
	const fetchMock = vi.fn(async (_url: URL, _options: RequestInit) => new Response(body));
	vi.stubGlobal("fetch", fetchMock);
	expect(await fetchRemoteImage("https://example.com/oversized.png")).toBeNull();
	expect(fetchMock.mock.calls[0]?.[1].signal?.aborted).toBe(true);
});
