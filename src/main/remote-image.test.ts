import type { LookupAddress } from "node:dns";
import { afterEach, expect, it, vi } from "vitest";
import { FS_IMAGE_MAX_BYTES } from "./fs-image";
import { fetchRemoteImage, type RemoteImageNetwork, type RemoteImageResponse } from "./remote-image";

const publicAddress: LookupAddress = { address: "93.184.216.34", family: 4 };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function response(
	statusCode: number,
	body: Uint8Array[] = [],
	headers: RemoteImageResponse["headers"] = {},
): RemoteImageResponse {
	return {
		statusCode,
		headers,
		body: (async function* () {
			for (const chunk of body) yield chunk;
		})(),
		cancel: vi.fn(),
	};
}

function network(responses: RemoteImageResponse[], addresses: LookupAddress[] = [publicAddress]): RemoteImageNetwork {
	return {
		resolve: vi.fn(async hostname => {
			if (hostname.includes("127.0.0.1") || hostname.includes("::1"))
				return [
					{ address: hostname.includes("::1") ? "::1" : "127.0.0.1", family: hostname.includes("::1") ? 6 : 4 },
				];
			return addresses;
		}),
		request: vi.fn(async () => {
			const next = responses.shift();
			if (!next) throw new Error("Unexpected image request");
			return next;
		}),
	};
}

afterEach(() => vi.restoreAllMocks());

it("rejects unsupported URLs before resolving or requesting them", async () => {
	const transport = network([]);
	for (const address of [null, "file:///picture.png", "https://user:password@example.com/picture.png"]) {
		expect(await fetchRemoteImage(address, transport)).toBeNull();
	}
	expect(transport.resolve).not.toHaveBeenCalled();
	expect(transport.request).not.toHaveBeenCalled();
});

it("refuses loopback and mixed public/private DNS answers before connecting", async () => {
	const loopback = network([]);
	expect(await fetchRemoteImage("http://127.0.0.1/picture.png", loopback)).toBeNull();
	expect(loopback.request).not.toHaveBeenCalled();

	const mixed = network([], [publicAddress, { address: "10.0.0.5", family: 4 }]);
	expect(await fetchRemoteImage("https://example.com/picture.png", mixed)).toBeNull();
	expect(mixed.request).not.toHaveBeenCalled();
});

it("blocks private and special-use IPv4/IPv6 ranges while allowing global addresses", async () => {
	for (const address of ["192.168.1.4", "100.64.0.1", "198.18.0.2", "fc00::1", "fe80::1", "2001:db8::1"]) {
		const family = address.includes(":") ? 6 : 4;
		const transport = network([], [{ address, family }]);
		expect(await fetchRemoteImage("https://example.com/picture.png", transport)).toBeNull();
		expect(transport.request, address).not.toHaveBeenCalled();
	}

	for (const address of [publicAddress, { address: "2606:4700:4700::1111", family: 6 }]) {
		const transport = network([response(200, [png])], [address]);
		expect(await fetchRemoteImage("https://example.com/picture.png", transport)).toBe(
			`data:image/png;base64,${Buffer.from(png).toString("base64")}`,
		);
		expect(transport.request).toHaveBeenCalledOnce();
	}
});

it("revalidates every redirect and never requests a private destination", async () => {
	const redirect = response(302, [], { location: "http://[::1]/metadata" });
	const transport = network([redirect]);

	expect(await fetchRemoteImage("https://example.com/picture.png", transport)).toBeNull();
	expect(transport.request).toHaveBeenCalledTimes(1);
	expect(redirect.cancel).toHaveBeenCalledOnce();
});

it("pins each public redirect to its validated address and returns inert image data", async () => {
	const redirect = response(302, [], { location: "https://cdn.example/image.png" });
	const image = response(200, [png], { "content-length": String(png.byteLength) });
	const transport = network([redirect, image]);

	expect(await fetchRemoteImage("https://example.com/image.png", transport)).toBe(
		`data:image/png;base64,${Buffer.from(png).toString("base64")}`,
	);
	expect(transport.resolve).toHaveBeenCalledTimes(2);
	expect(transport.resolve).toHaveBeenNthCalledWith(2, "cdn.example");
	expect(transport.request).toHaveBeenNthCalledWith(
		2,
		expect.objectContaining({ hostname: "cdn.example" }),
		publicAddress,
		expect.any(AbortSignal),
	);
	expect(redirect.cancel).toHaveBeenCalledOnce();
});

it("rejects non-images and cancels a response that exceeds the image size limit", async () => {
	const nonImage = network([
		response(200, [new TextEncoder().encode("<html>Login required</html>")], { "content-type": "image/png" }),
	]);
	expect(await fetchRemoteImage("https://example.com/picture.png", nonImage)).toBeNull();

	const oversized = response(200, [new Uint8Array(FS_IMAGE_MAX_BYTES + 1)]);
	const transport = network([oversized]);
	expect(await fetchRemoteImage("https://example.com/oversized.png", transport)).toBeNull();
	expect(oversized.cancel).toHaveBeenCalledOnce();
});
