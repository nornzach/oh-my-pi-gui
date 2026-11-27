/**
 * SegmentedField: tactile sliding segmented control (built on `.omp-segmented` +
 * `<Glide>`) for compact 2–3 option settings in SettingsWindow.
 */
import { cx } from "../../../lib/format";
import { Glide } from "../../common/Glide";

export interface SegmentedOption<T extends string> {
	value: T;
	label: string;
	description?: string;
}

export function SegmentedField<T extends string>({
	value,
	onChange,
	options,
	label,
	description,
	id,
}: {
	value: T;
	onChange: (value: T) => void;
	options: readonly SegmentedOption<T>[];
	label: string;
	description?: string;
	id?: string;
}) {
	const selectedOption = options.find(option => option.value === value);
	const helper = selectedOption?.description ?? description;
	return (
		<div id={id} className="omp-settings-row scroll-mt-4 py-2">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="text-omp-md font-medium text-(--omp-text)">{label}</span>
				<div role="group" aria-label={label} className="omp-segmented max-w-full">
					<Glide activeKey={value} selector='[aria-pressed="true"]' variant="thumb" />
					{options.map(option => {
						const active = option.value === value;
						return (
							<button
								key={option.value}
								type="button"
								aria-pressed={active}
								onClick={() => onChange(option.value)}
								className={cx(
									"relative z-[1] flex min-h-7 min-w-0 flex-auto items-center justify-center rounded-[7px] px-3 py-1 text-center text-omp-xs font-medium wrap-anywhere transition-colors",
									active ? "text-(--omp-text)" : "text-(--omp-muted) hover:text-(--omp-text)",
								)}
							>
								{option.label}
							</button>
						);
					})}
				</div>
			</div>
			{helper && <p className="mt-1.5 text-omp-xs leading-relaxed text-(--omp-muted)">{helper}</p>}
		</div>
	);
}
