import { Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../lib/i18n";
import { actionChords, SHORTCUT_SECTIONS, shortcutSectionRows } from "../../lib/keymap";
import { useEffectiveKeymapOverrides, useUiStore } from "../../stores/ui";
import { Button, Input, Modal } from "../common";

interface ResolvedRow {
	id: string;
	label: string;
	/** Empty when the user turned the shortcut off. */
	keys: string;
}

/**
 * Searchable shortcut reference (plan/17 §6.2): every row of the shortcut list
 * with the chords in effect. Changing or turning shortcuts off happens on the
 * Keyboard shortcuts settings page, which the header button opens.
 */
export function HotkeysDialog({ open }: { open: boolean }) {
	const t = useT();
	const close = useUiStore(s => s.closeHotkeys);
	const overrides = useEffectiveKeymapOverrides();
	const [query, setQuery] = useState("");

	// Stays mounted through its exit animation, so every open starts from a clean filter.
	useEffect(() => {
		if (open) setQuery("");
	}, [open]);

	const groups = useMemo(() => {
		const q = query.trim().toLowerCase();
		const off = t("hotkeys.off").toLowerCase();
		return SHORTCUT_SECTIONS.map(section => ({
			section,
			rows: shortcutSectionRows(section)
				.map(
					(row): ResolvedRow =>
						row.kind === "entry"
							? {
									id: row.entry.id,
									label: t(row.entry.labelKey),
									keys: actionChords(row.entry, overrides).join(" / "),
								}
							: { id: row.row.labelKey, label: t(row.row.labelKey), keys: row.row.keys },
				)
				.filter(row => !q || row.label.toLowerCase().includes(q) || (row.keys || off).toLowerCase().includes(q)),
		})).filter(group => group.rows.length > 0);
	}, [query, t, overrides]);

	const customize = () => {
		close();
		useUiStore.getState().openSettings("shortcuts");
	};

	return (
		<Modal onClose={close} open={open} title={t("hotkeys.title")}>
			<div className="mb-3 flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<Input
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder={t("hotkeys.search")}
					/>
				</div>
				<Button icon={<Settings2 size={13} />} onClick={customize} size="sm" variant="ghost">
					{t("hotkeys.customize")}
				</Button>
			</div>

			{groups.length === 0 && (
				<div className="py-6 text-center text-omp-md text-[var(--omp-dim)]">{t("hotkeys.empty")}</div>
			)}
			{groups.map(group => (
				<div key={group.section} className="mb-4 last:mb-0">
					<div className="mb-1.5 text-omp-sm font-semibold text-[var(--omp-dim)]">
						{t(`hotkeys.group.${group.section}`)}
					</div>
					<div className="overflow-hidden rounded-lg border border-[var(--omp-border-muted)]">
						{group.rows.map(row => (
							<div key={row.id} className="flex items-center justify-between gap-4 px-3 py-2 text-omp-md">
								<span className="text-[var(--omp-text)]">{row.label}</span>
								{row.keys ? (
									<kbd className="shrink-0 rounded-md border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] px-2 py-0.5 font-mono text-omp-sm text-[var(--omp-muted)]">
										{row.keys}
									</kbd>
								) : (
									<span className="shrink-0 text-omp-sm text-[var(--omp-dim)]">{t("hotkeys.off")}</span>
								)}
							</div>
						))}
					</div>
				</div>
			))}
		</Modal>
	);
}
