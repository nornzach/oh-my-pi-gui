import { afterEach, describe, expect, it } from "vitest";
import { useExtensionUiStore, watchSignInRequests } from "./extension-ui";

afterEach(() => useExtensionUiStore.getState().clearAll());

describe("watchSignInRequests", () => {
	it("removes only the sign-in dialogs that appeared during the watched sign-in", () => {
		const store = useExtensionUiStore.getState();
		// Already open before this sign-in starts: another flow's (MCP re-authorization) browser step.
		store.pushRequest({
			type: "extension_ui_request",
			id: "mcp",
			method: "open_url",
			url: "https://example.test/mcp",
		});

		const dismiss = watchSignInRequests();
		store.pushRequest({
			type: "extension_ui_request",
			id: "open",
			method: "open_url",
			url: "https://example.test/auth",
		});
		store.pushRequest({
			type: "extension_ui_request",
			id: "code",
			method: "input",
			title: "Code",
			authCodeFor: "open",
		});
		store.pushRequest({
			type: "extension_ui_request",
			id: "key",
			method: "input",
			title: "API key",
			loginPromptFor: "open",
		});
		store.pushRequest({ type: "extension_ui_request", id: "plain", method: "input", title: "Name the branch" });
		dismiss();

		expect(useExtensionUiStore.getState().pendingRequests.map(request => request.id)).toEqual(["mcp", "plain"]);
	});
});
