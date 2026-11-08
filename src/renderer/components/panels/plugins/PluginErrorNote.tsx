import { useT } from "../../../lib/i18n";
import { TechnicalDetails } from "../../common/TechnicalDetails";
import { CopyableError } from "../inventory/ErrorNote";
import type { PluginCatalogError } from "./use-plugin-catalog";

export function PluginErrorNote({ error }: { error: PluginCatalogError }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-1">
			<CopyableError copyLabel={t("marketplace.copyError")} message={error.message} />
			<TechnicalDetails raw={error.raw} shown={error.message} />
		</div>
	);
}
