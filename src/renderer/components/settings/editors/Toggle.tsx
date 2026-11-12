/**
 * Toggle switch component: full-width switch with label and optional description.
 * Used primarily in settings pages for boolean configuration options. A change
 * confirms itself next to the label for a moment, so a switch that applies
 * silently (a display preference, say) is not indistinguishable from one that
 * did nothing. When `onChange` returns a promise the confirmation follows it:
 * a rejection or a `false` result (a save that failed, or one whose row shows
 * a fuller outcome such as "applies after a restart") skips it.
 */

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { SwitchTrack } from "../../common/SwitchTrack";

/** How long the confirmation stays beside the label. */
const CONFIRM_MS = 1800;

export function Toggle({
	checked,
	onChange,
	label,
	description,
	disabled,
	badge,
	className,
}: {
	checked: boolean;
	/** May return a promise: the confirmation then waits for it and is skipped when it rejects or resolves `false`. */
	onChange: (value: boolean) => void | Promise<unknown>;
	label: string;
	description?: string;
	disabled?: boolean;
	badge?: React.ReactNode;
	/** Row geometry from the host; Settings passes `omp-settings-row` so its switches align with its other rows. */
	className?: string;
}) {
	const t = useT();
	const [confirmed, setConfirmed] = useState(false);
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	const confirm = () => {
		setConfirmed(true);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setConfirmed(false), CONFIRM_MS);
	};
	const toggle = () => {
		const result = onChange(!checked);
		// A save that fails reports its own error; confirming it would say the opposite.
		if (result instanceof Promise)
			result.then(
				outcome => {
					if (outcome !== false) confirm();
				},
				() => {},
			);
		else confirm();
	};

	return (
		<button
			aria-checked={checked}
			aria-label={label}
			className={cx(
				"flex w-full cursor-pointer items-start justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-(--omp-sidebar-item-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
				className,
			)}
			disabled={disabled}
			onClick={toggle}
			role="switch"
			type="button"
		>
			<span className="min-w-0">
				<span className="flex items-center gap-2">
					<span className="block text-omp-md font-medium text-(--omp-text)">{label}</span>
					{badge}
					{confirmed && (
						<span
							className="omp-fade-in flex items-center gap-0.5 text-omp-xs font-normal text-(--omp-success)"
							role="status"
						>
							<Check aria-hidden size={11} />
							{t("common.saved")}
						</span>
					)}
				</span>
				{description && (
					<span className="mt-0.5 block text-omp-sm leading-snug text-(--omp-muted)">{description}</span>
				)}
			</span>
			<SwitchTrack className="mt-0.5" on={checked} />
		</button>
	);
}
