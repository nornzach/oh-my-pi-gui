import { useEffect, useState } from "react";
import { CONFIG_EDITOR_PREF, CONFIG_EDITORS, type ConfigEditor, readConfigEditor } from "../../../shared/config-editor";
import { saveGuiPreference } from "../../lib/display-preferences";
import { useT } from "../../lib/i18n";
import { Section } from "./editors/Section";

export function ConfigEditorSetting() {
	const t = useT();
	const [editor, setEditor] = useState<ConfigEditor | null>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		let active = true;
		const update = (value?: unknown) => {
			if (active) setEditor(readConfigEditor(value));
		};
		void window.omp.prefs.get(CONFIG_EDITOR_PREF).then(update, () => update());
		return () => {
			active = false;
		};
	}, []);

	const select = async (value: string) => {
		const next = readConfigEditor(value);
		setSaving(true);
		await saveGuiPreference(CONFIG_EDITOR_PREF, next, () => setEditor(next));
		setSaving(false);
	};

	const label = t("settings.gui.configEditor");
	return (
		<Section id="setting-gui-configEditor" title={label}>
			<select
				aria-label={label}
				className="max-w-full rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-2.5 py-1.5 text-omp-sm text-(--omp-text)"
				disabled={editor === null || saving}
				onChange={event => void select(event.target.value)}
				value={editor ?? "auto"}
			>
				{CONFIG_EDITORS.map(option => (
					<option key={option} value={option}>
						{t(`settings.gui.configEditor.${option}`)}
					</option>
				))}
			</select>
		</Section>
	);
}
