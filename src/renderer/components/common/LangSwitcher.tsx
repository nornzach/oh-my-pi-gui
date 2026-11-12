/**
 * Language switcher: compact globe button with an explicit language menu.
 * Reads and persists the active language through useLang()
 * (localStorage LANG_KEY inside I18nProvider), so no extra wiring is needed —
 * mount it anywhere under the provider. Rendered label shows the CURRENT
 * language autonym ("EN" / "中文"), matching OS-language-picker convention.
 *
 * Mount point: the sidebar footer.
 */

import { Globe } from "lucide-react";
import { useState } from "react";
import { LANGUAGES, languageDetails } from "../../../shared/languages";
import { cx } from "../../lib/format";
import { useLang, useT } from "../../lib/i18n";
import { ContextMenu } from "./ContextMenu";

export interface LangSwitcherProps {
	className?: string;
}

export function LangSwitcher({ className }: LangSwitcherProps) {
	const { lang, setLang } = useLang();
	const t = useT();
	const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
	return (
		<>
			<button
				type="button"
				onClick={event => {
					const rect = event.currentTarget.getBoundingClientRect();
					setAnchor(anchor ? null : { x: rect.left, y: rect.bottom + 4 });
				}}
				aria-haspopup="menu"
				aria-expanded={anchor !== null}
				title={t("lang.switch")}
				aria-label={t("lang.switch")}
				className={cx(
					"no-drag omp-pressable flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-omp-md font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]",
					className,
				)}
			>
				<Globe size={16} />
				<span>{languageDetails(lang).short}</span>
			</button>
			{anchor && (
				<ContextMenu
					x={anchor.x}
					y={anchor.y}
					onClose={() => setAnchor(null)}
					items={LANGUAGES.map(language => ({
						id: language.id,
						label: language.name,
						hint: language.id === lang ? "✓" : undefined,
						onSelect: () => {
							setLang(language.id);
							setAnchor(null);
						},
					}))}
				/>
			)}
		</>
	);
}
