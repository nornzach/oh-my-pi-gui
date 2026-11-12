/**
 * AdvancedTab: searchable flat list of settings without UI metadata.
 */

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SettingEntry } from "../../../../shared/rpc-types";
import { useT } from "../../../lib/i18n";
import { Input } from "../../common";
import { SchemaSettingRow } from "../SchemaSettingRow";
import { isSettingVisibleInGui, matchesSettingSearch } from "../settings-schema-utils";

function AdvancedTab({
	entries,
	values,
	onCommitted,
}: {
	entries: SettingEntry[];
	values: Record<string, unknown>;
	onCommitted: (path: string, value: unknown) => void;
}) {
	const t = useT();
	const [query, setQuery] = useState("");
	const advanced = useMemo(
		() =>
			entries.filter(
				entry => (entry.advanced === true || entry.tab === undefined) && isSettingVisibleInGui(entry, values),
			),
		[entries, values],
	);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (q.length === 0) return advanced;
		return advanced.filter(entry => matchesSettingSearch(entry, q));
	}, [advanced, query]);

	return (
		<>
			<div className="relative mb-3">
				<Search className="absolute top-1/2 left-2.5 -translate-y-1/2 text-(--omp-dim)" size={13} />
				<Input
					className="pl-7"
					onChange={event => setQuery(event.target.value)}
					placeholder={t("settings.advancedFilter", { count: advanced.length })}
					value={query}
				/>
			</div>
			{filtered.length === 0 ? (
				<div className="py-10 text-center text-omp-xs text-(--omp-dim)">{t("settings.advancedEmpty")}</div>
			) : (
				filtered.map(entry => (
					<div id={`setting-${entry.path}`} key={entry.path} className="scroll-mt-4">
						<SchemaSettingRow entry={entry} onCommitted={onCommitted} value={values[entry.path]} />
					</div>
				))
			)}
		</>
	);
}

export { AdvancedTab };
