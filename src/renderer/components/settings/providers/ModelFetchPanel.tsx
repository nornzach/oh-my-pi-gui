/**
 * ModelFetchPanel: what an endpoint offers, as a checklist. What you pick lands
 * in the form as ordinary model rows, to adjust like any other before saving.
 */

import { useMemo, useState } from "react";
import type { DiscoveredModel } from "../../../../shared/rpc-types";
import { formatTokens } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { Button } from "../../common";
import type { ModelRow } from "./ModelEditor";

/** A list this short is probably all wanted; a gateway's hundreds are not. */
const PRESELECT_LIMIT = 20;

function modelRowFrom(model: DiscoveredModel, key: number): ModelRow {
	return {
		key,
		id: model.id,
		...(model.name && model.name !== model.id ? { name: model.name } : {}),
		...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
		...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
		...(model.reasoning ? { reasoning: true } : {}),
		// Text only is what a row means when it says nothing.
		...(model.input.includes("image") ? { input: ["text", "image"] as ("text" | "image")[] } : {}),
	};
}

/** `rows` with `picked` added after them: a row you already have stays as you left it, and an empty one makes way. */
export function mergeFetchedModels(
	rows: readonly ModelRow[],
	picked: readonly DiscoveredModel[],
	nextKey: () => number,
): ModelRow[] {
	const have = new Set(rows.map(row => row.id.trim()));
	const added = picked.filter(model => !have.has(model.id)).map(model => modelRowFrom(model, nextKey()));
	if (added.length === 0) return [...rows];
	return [...rows.filter(row => row.id.trim() || row.name?.trim()), ...added];
}

interface ModelFetchPanelProps {
	models: readonly DiscoveredModel[];
	/** Ids already in the form: shown as added, not offered again. */
	existingIds: ReadonlySet<string>;
	onAdd: (picked: DiscoveredModel[]) => void;
	onClose: () => void;
}

export function ModelFetchPanel({ models, existingIds, onAdd, onClose }: ModelFetchPanelProps) {
	const t = useT();
	const [query, setQuery] = useState("");
	const offered = useMemo(() => models.filter(model => !existingIds.has(model.id)), [models, existingIds]);
	const [selected, setSelected] = useState<ReadonlySet<string>>(() =>
		offered.length <= PRESELECT_LIMIT ? new Set(offered.map(model => model.id)) : new Set(),
	);
	const needle = query.trim().toLowerCase();
	const visible = needle
		? models.filter(model => model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle))
		: models;
	const setPicked = (ids: readonly string[], picked: boolean) => {
		setSelected(previous => {
			const next = new Set(previous);
			for (const id of ids) {
				if (picked) next.add(id);
				else next.delete(id);
			}
			return next;
		});
	};
	const visibleOffered = visible.filter(model => !existingIds.has(model.id)).map(model => model.id);
	const picked = offered.filter(model => selected.has(model.id));

	return (
		<div className="mb-2 rounded-lg border border-(--omp-border-muted)" data-model-fetch-panel>
			<div className="flex items-center gap-2 border-b border-(--omp-border-muted) px-3 py-2">
				<span className="shrink-0 text-omp-sm text-(--omp-muted)">
					{t("providerCfg.fetch.found", { count: models.length })}
				</span>
				<input
					aria-label={t("providerCfg.fetch.filter")}
					className="h-7 min-w-0 flex-1 rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-2 text-omp-sm text-(--omp-text) outline-none transition-colors placeholder:text-(--omp-dim) focus:border-(--omp-input-focus-border)"
					onChange={event => setQuery(event.target.value)}
					placeholder={t("providerCfg.fetch.filter")}
					type="text"
					value={query}
				/>
				<Button onClick={() => setPicked(visibleOffered, true)} size="sm" variant="ghost">
					{t("providerCfg.fetch.selectAll")}
				</Button>
				<Button onClick={() => setPicked(visibleOffered, false)} size="sm" variant="ghost">
					{t("providerCfg.fetch.selectNone")}
				</Button>
			</div>
			<div className="max-h-56 overflow-y-auto p-1">
				{visible.length === 0 && (
					<p className="px-2 py-3 text-center text-omp-sm text-(--omp-dim)">{t("providerCfg.fetch.noMatch")}</p>
				)}
				{visible.map(model => {
					const added = existingIds.has(model.id);
					return (
						<label
							className={`flex items-center gap-2 rounded-md px-2 py-1 text-omp-sm ${added ? "text-(--omp-dim)" : "cursor-pointer text-(--omp-text) hover:bg-(--omp-selected-bg)"}`}
							key={model.id}
						>
							<input
								checked={added || selected.has(model.id)}
								className="h-3.5 w-3.5 shrink-0 rounded border-(--omp-input-border)"
								disabled={added}
								onChange={event => setPicked([model.id], event.target.checked)}
								type="checkbox"
							/>
							<span className="min-w-0 truncate font-mono">{model.id}</span>
							{model.name && model.name !== model.id && (
								<span className="min-w-0 truncate text-(--omp-dim)">{model.name}</span>
							)}
							<span className="ml-auto shrink-0 text-omp-xs text-(--omp-dim)">
								{added
									? t("providerCfg.fetch.added")
									: model.contextWindow
										? formatTokens(model.contextWindow)
										: ""}
							</span>
						</label>
					);
				})}
			</div>
			<div className="flex items-center justify-end gap-2 border-t border-(--omp-border-muted) px-3 py-2">
				<Button onClick={onClose} size="sm" variant="ghost">
					{t("providerCfg.form.cancel")}
				</Button>
				<Button disabled={picked.length === 0} onClick={() => onAdd(picked)} size="sm" variant="primary">
					{t("providerCfg.fetch.add", { count: picked.length })}
				</Button>
			</div>
		</div>
	);
}
