import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionUIRequest } from "../../shared/rpc-types";
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

describe("form drafts live and die with their request", () => {
	const form: ExtensionUIRequest = { type: "extension_ui_request", id: "f1", method: "form", sections: [] };

	it("keeps drafts while the request is pending and drops them when it is answered", () => {
		const store = useExtensionUiStore.getState();
		store.pushRequest(form);
		useExtensionUiStore.setState(state => ({ formDrafts: { ...state.formDrafts, f1: ["typed"] } }));
		expect(useExtensionUiStore.getState().formDrafts.f1).toEqual(["typed"]);

		store.removeRequest("f1");

		expect(useExtensionUiStore.getState().formDrafts.f1).toBeUndefined();
		expect(useExtensionUiStore.getState().pendingRequests).toEqual([]);
	});

	it("drops drafts when the agent cancels the request", () => {
		const store = useExtensionUiStore.getState();
		store.pushRequest(form);
		useExtensionUiStore.setState(state => ({ formDrafts: { ...state.formDrafts, f1: ["typed"] } }));

		store.pushRequest({ type: "extension_ui_request", id: "cancel-1", method: "cancel", targetId: "f1" });

		expect(useExtensionUiStore.getState().formDrafts.f1).toBeUndefined();
		expect(useExtensionUiStore.getState().pendingRequests).toEqual([]);
	});

	it("forgets a draft without touching the pending request", () => {
		const store = useExtensionUiStore.getState();
		store.pushRequest(form);
		useExtensionUiStore.setState(state => ({ formDrafts: { ...state.formDrafts, f1: ["typed"] } }));

		store.forgetFormDraft("f1");

		expect(useExtensionUiStore.getState().formDrafts.f1).toBeUndefined();
		expect(useExtensionUiStore.getState().pendingRequests.map(request => request.id)).toEqual(["f1"]);
	});
});
