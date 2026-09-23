/**
 * Contract tests for markdown image rendering: inline data: URLs survive
 * sanitization and render as <img>, remote URLs never become a request, local
 * paths route to the fs:read-image IPC (SSR shows the path placeholder —
 * resolution is an effect), and hostile protocols stay stripped.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "./i18n";
import { classifyImageSrc, MarkdownRenderer } from "./markdown";

function render(content: string): string {
	return renderToStaticMarkup(
		<I18nProvider>
			<MarkdownRenderer content={content} />
		</I18nProvider>,
	);
}

const TINY_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("classifyImageSrc", () => {
	it("keeps inline data: and blob: URLs as direct loads", () => {
		expect(classifyImageSrc(TINY_PNG)).toEqual({ kind: "direct", src: TINY_PNG });
		expect(classifyImageSrc("blob:https://app/uuid")).toEqual({ kind: "direct", src: "blob:https://app/uuid" });
	});

	it("classifies http(s) and protocol-relative URLs as remote, never as a load", () => {
		expect(classifyImageSrc("https://example.com/x.png")).toEqual({
			kind: "remote",
			src: "https://example.com/x.png",
		});
		expect(classifyImageSrc("http://localhost:8080/x.png")).toEqual({
			kind: "remote",
			src: "http://localhost:8080/x.png",
		});
	});

	it("upgrades protocol-relative URLs to https", () => {
		expect(classifyImageSrc("//cdn.example.com/x.png")).toEqual({
			kind: "remote",
			src: "https://cdn.example.com/x.png",
		});
	});

	it("routes bare absolute, relative, and plain paths to the local read", () => {
		expect(classifyImageSrc("/Users/x/shot.png")).toEqual({ kind: "local", path: "/Users/x/shot.png" });
		expect(classifyImageSrc("./shots/x.png")).toEqual({ kind: "local", path: "./shots/x.png" });
		expect(classifyImageSrc("../out/x.png")).toEqual({ kind: "local", path: "../out/x.png" });
		expect(classifyImageSrc("x.png")).toEqual({ kind: "local", path: "x.png" });
	});

	it("strips file:// and decodes escapes for the local read", () => {
		expect(classifyImageSrc("file:///tmp/my%20shot.png")).toEqual({ kind: "local", path: "/tmp/my shot.png" });
	});

	it("rejects empty src", () => {
		expect(classifyImageSrc(undefined)).toEqual({ kind: "none" });
		expect(classifyImageSrc("")).toEqual({ kind: "none" });
	});
});

describe("markdown images", () => {
	it("renders inline data: URLs — sanitize must not strip the src", () => {
		const html = render(`![pixel](${TINY_PNG})`);
		expect(html).toContain("<img");
		expect(html).toContain(encodeURI(TINY_PNG).replace(/&/g, "&amp;"));
		expect(html).toContain('alt="pixel"');
	});

	it("renders a remote URL as an opt-in link, never as a loadable image", () => {
		const html = render("![shot](https://example.com/shot.png)");
		// An <img> here is an outbound GET the user never asked for: it names this
		// machine (IP, timing) to whoever the model pointed at.
		expect(html).not.toContain("<img");
		expect(html).toContain("shot");
		expect(html).toContain('href="https://example.com/shot.png"');
	});

	it("renders local paths as a resolving placeholder carrying the path", () => {
		const html = render("![screen](./captures/screen.png)");
		expect(html).toContain("screen");
		expect(html).toContain("./captures/screen.png");
		expect(html).not.toContain('src="./captures/screen.png"');
	});

	it("strips javascript: URLs from raw HTML images", () => {
		const html = render('<img src="javascript:alert(1)" alt="x">');
		expect(html).not.toContain("javascript:");
	});

	it("keeps file: URLs for local resolution instead of dropping the src", () => {
		const html = render("![snap](file:///tmp/snap.png)");
		expect(html).toContain("/tmp/snap.png");
	});
});
