import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

describe("Badge", () => {
	it("renders one live signal in the variant color instead of an expanding duplicate halo", () => {
		const html = renderToStaticMarkup(
			<Badge dot pulse variant="success">
				Running
			</Badge>,
		);

		expect(html.match(/omp-signal-light--active/g)).toHaveLength(1);
		expect(html).toContain("text-(--omp-success)");
		expect(html).not.toContain("animate-ping");
	});
});
