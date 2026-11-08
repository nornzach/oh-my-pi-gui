import { useT } from "../../../lib/i18n";
import { humanizePluginName } from "./catalog-model";

/** A catalog's category in the person's language, or as the catalog spells it when we don't know the word. */
export function usePluginCategoryLabel(): (category: string) => string {
	const t = useT();
	return category => {
		const key = `plugins.category.${category}`;
		const label = t(key);
		return label === key ? humanizePluginName(category) : label;
	};
}

export function PluginCategoryLabel({ category }: { category: string }) {
	const label = usePluginCategoryLabel();
	return <span className="truncate">{label(category)}</span>;
}
