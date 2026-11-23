import { parseHTML } from "linkedom";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { useStats, useStatsList } from "./use-stats";

function StatsProbe({ range, onRefetch }: { range?: string; onRefetch?: (refetch: () => void) => void }) {
	const result = useStats<{ count: number }>("/api/stats/overview", range === undefined ? {} : { range });
	const { refetch } = result;
	useEffect(() => onRefetch?.(refetch), [onRefetch, refetch]);
	return <p>{JSON.stringify(result)}</p>;
}

function StatsListProbe() {
	const result = useStatsList<{ timestamp: number }>("/api/stats/errors", { range: "24h" });
	return <p>{JSON.stringify(result)}</p>;
}

function setupStats(fetch: () => Promise<unknown>) {
	const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("document", document);
	vi.stubGlobal("window", Object.assign(window, { omp: { stats: { fetch } } }));
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const node = document.getElementById("root")!;
	const root = createRoot(node);
	return {
		node,
		root,
		dispose: async () => {
			try {
				await act(async () => root.unmount());
			} finally {
				vi.unstubAllGlobals();
			}
		},
	};
}

test("late ranges cannot replace the selected range, failed refresh retains only its own data, and requests do not overlap", async () => {
	const slow = Promise.withResolvers<unknown>();
	const fast = Promise.withResolvers<unknown>();
	const fetch = vi
		.fn()
		.mockReturnValueOnce(slow.promise)
		.mockReturnValueOnce(fast.promise)
		.mockRejectedValueOnce(new Error("offline"));
	const { node, root, dispose } = setupStats(fetch);
	let refresh = () => {};
	const captureRefetch = (refetch: () => void) => {
		refresh = refetch;
	};
	try {
		await act(async () => root.render(<StatsProbe range="all" onRefetch={captureRefetch} />));
		await act(async () => {
			refresh();
			refresh();
		});
		expect(fetch).toHaveBeenCalledTimes(1);
		await act(async () => root.render(<StatsProbe range="24h" onRefetch={captureRefetch} />));
		expect(node.textContent).toContain('"data":null');
		await act(async () => fast.resolve({ count: 2 }));
		await act(async () => slow.resolve({ count: 900 }));
		expect(node.textContent).toContain('"count":2');
		// The discarded payload, not the digits: `updatedAt` is an epoch in
		// milliseconds and can contain "900" on its own.
		expect(node.textContent).not.toContain('"count":900');
		await act(async () => refresh());
		expect(node.textContent).toContain("offline");
		expect(node.textContent).toContain('"count":2');
	} finally {
		await dispose();
	}
});

test("an unavailable stats server keeps the route loading and self-heals once the server is ready", async () => {
	let ready = false;
	const fetch = vi.fn(async () =>
		ready
			? { count: 7 }
			: { error: "The bundled stats server is not ready. Please retry shortly.", unavailable: true },
	);
	const { node, root, dispose } = setupStats(fetch);
	try {
		await act(async () => root.render(<StatsProbe />));
		// Not ready yet: still loading, never a dead-end error.
		expect(node.textContent).toContain('"isLoading":true');
		expect(node.textContent).toContain('"error":null');
		expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(1);

		// Server comes up; the fast retry must recover without a manual refetch.
		ready = true;
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 2600));
		});
		expect(node.textContent).toContain('"count":7');
		expect(node.textContent).toContain('"error":null');
		expect(node.textContent).toContain('"isLoading":false');
	} finally {
		await dispose();
	}
});

test("a list endpoint that replies with a non-array becomes an error state, never rows", async () => {
	const fetch = vi.fn(async () => ({}));
	const { node, root, dispose } = setupStats(fetch);
	try {
		await act(async () => root.render(<StatsListProbe />));
		// Storing `{}` as data makes every row expression in the route throw and the
		// whole renderer falls back to the crash screen.
		expect(node.textContent).toContain('"data":null');
		expect(node.textContent).toContain('"isLoading":false');
		expect(node.textContent).toContain("/api/stats/errors");
	} finally {
		await dispose();
	}
});
