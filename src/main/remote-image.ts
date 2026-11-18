import type { LookupAddress } from "node:dns";
import * as dns from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { BlockList, isIP } from "node:net";
import { FS_IMAGE_MAX_BYTES, sniffImageMime } from "./fs-image";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

const IPV4_NON_PUBLIC_RANGES = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.88.99.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
];

const IPV6_NON_PUBLIC_RANGES = [
	"::/128",
	"::1/128",
	"::ffff:0:0/96",
	"64:ff9b:1::/48",
	"100::/64",
	"2001::/23",
	"2001:db8::/32",
	"2002::/16",
	"3fff::/20",
	"fc00::/7",
	"fe80::/10",
	"ff00::/8",
];

const IPV4_NON_PUBLIC = new BlockList();
for (const range of IPV4_NON_PUBLIC_RANGES)
	IPV4_NON_PUBLIC.addSubnet(range.slice(0, range.indexOf("/")), Number(range.split("/")[1]));

const IPV6_GLOBAL_UNICAST = new BlockList();
IPV6_GLOBAL_UNICAST.addSubnet("2000::", 3, "ipv6");

const IPV6_NON_PUBLIC = new BlockList();
for (const range of IPV6_NON_PUBLIC_RANGES) {
	IPV6_NON_PUBLIC.addSubnet(range.slice(0, range.indexOf("/")), Number(range.split("/")[1]), "ipv6");
}

export interface RemoteImageResponse {
	statusCode: number | undefined;
	headers: {
		location?: string;
		"content-length"?: string;
		"content-encoding"?: string;
		"content-type"?: string;
	};
	body: AsyncIterable<Uint8Array>;
	cancel(): void;
}

export interface RemoteImageNetwork {
	resolve(hostname: string): Promise<LookupAddress[]>;
	request(url: URL, address: LookupAddress, signal: AbortSignal): Promise<RemoteImageResponse>;
}

function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return !IPV4_NON_PUBLIC.check(address, "ipv4");
	if (family === 6) return IPV6_GLOBAL_UNICAST.check(address, "ipv6") && !IPV6_NON_PUBLIC.check(address, "ipv6");
	return false;
}

async function resolvePublicAddresses(hostname: string): Promise<LookupAddress[]> {
	const unbracketed = hostname.replace(/^\[|\]$/g, "");
	const family = isIP(unbracketed);
	if (family !== 0) return [{ address: unbracketed, family }];
	return dns.lookup(unbracketed, { all: true, order: "verbatim" });
}

async function requestPublicAddress(
	url: URL,
	address: LookupAddress,
	signal: AbortSignal,
): Promise<RemoteImageResponse> {
	const client = url.protocol === "https:" ? https : http;
	const pending = Promise.withResolvers<RemoteImageResponse>();
	try {
		const request = client.request(
			url,
			{
				method: "GET",
				agent: false,
				signal,
				headers: { accept: "image/*", "accept-encoding": "identity" },
				lookup: (_hostname, options, callback) => {
					if (options.all) callback(null, [address]);
					else callback(null, address.address, address.family);
				},
			},
			response => {
				pending.resolve({
					statusCode: response.statusCode,
					headers: response.headers,
					body: response,
					cancel: () => response.destroy(),
				});
			},
		);
		request.once("error", pending.reject);
		request.end();
	} catch (error) {
		pending.reject(error);
	}
	return pending.promise;
}

const defaultNetwork: RemoteImageNetwork = {
	resolve: resolvePublicAddresses,
	request: requestPublicAddress,
};

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	const pending = Promise.withResolvers<T>();
	const abort = () => pending.reject(signal.reason);
	if (signal.aborted) abort();
	else signal.addEventListener("abort", abort, { once: true });
	void promise.then(pending.resolve, pending.reject).finally(() => signal.removeEventListener("abort", abort));
	return pending.promise;
}

function parseHttpUrl(address: string): URL | null {
	try {
		const url = new URL(address);
		if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
		return url;
	} catch {
		return null;
	}
}

/** Fetch only when the user asks to load an image. Never connect to private addresses. */
export async function fetchRemoteImage(
	address: unknown,
	network: RemoteImageNetwork = defaultNetwork,
): Promise<string | null> {
	if (typeof address !== "string") return null;
	let url = parseHttpUrl(address);
	if (!url) return null;

	const abort = new AbortController();
	const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
	try {
		for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
			signal.throwIfAborted();
			const addresses = await raceAbort(network.resolve(url.hostname), signal);
			if (addresses.length === 0 || addresses.some(({ address: ip }) => !isPublicAddress(ip))) return null;
			const response = await network.request(url, addresses[0], signal);
			const status = response.statusCode ?? 0;
			if ([301, 302, 303, 307, 308].includes(status)) {
				response.cancel();
				if (redirects === MAX_REDIRECTS || !response.headers.location) return null;
				url = parseHttpUrl(new URL(response.headers.location, url).href);
				if (!url) return null;
				continue;
			}
			if (status < 200 || status >= 300 || /^(?!identity$).+/i.test(response.headers["content-encoding"] ?? "")) {
				response.cancel();
				return null;
			}
			const contentLength = Number(response.headers["content-length"]);
			if (Number.isFinite(contentLength) && contentLength > FS_IMAGE_MAX_BYTES) {
				response.cancel();
				return null;
			}

			const chunks: Uint8Array[] = [];
			let size = 0;
			for await (const chunk of response.body) {
				size += chunk.byteLength;
				if (size > FS_IMAGE_MAX_BYTES) {
					response.cancel();
					return null;
				}
				chunks.push(chunk);
			}
			const bytes = Buffer.concat(chunks, size);
			const mime = sniffImageMime(bytes.subarray(0, 512));
			return mime ? `data:${mime};base64,${bytes.toString("base64")}` : null;
		}
	} catch {
		return null;
	} finally {
		abort.abort();
	}
	return null;
}
