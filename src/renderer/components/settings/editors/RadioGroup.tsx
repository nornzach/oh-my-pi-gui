/**
 * RadioGroup component: a styled radio button group with label and optional description.
 * Used in settings pages for single-choice configuration options.
 */

export function RadioGroup<T extends string>({
	value,
	onChange,
	options,
	name,
}: {
	value: T;
	onChange: (value: T) => void;
	options: { value: T; label: string; description?: string }[];
	name: string;
}) {
	return (
		<div className="space-y-1.5" role="radiogroup">
			{options.map(option => (
				<label
					className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
						value === option.value
							? "border-(--omp-border-accent) bg-[color-mix(in_srgb,var(--omp-accent)_8%,transparent)]"
							: "border-(--omp-border-muted) hover:bg-(--omp-selected-bg)"
					}`}
					key={option.value}
				>
					<input
						checked={value === option.value}
						className="mt-0.5 accent-(--omp-accent)"
						name={name}
						onChange={() => onChange(option.value)}
						type="radio"
					/>
					<span className="min-w-0">
						<span className="block text-omp-md font-medium text-(--omp-text)">{option.label}</span>
						{option.description && (
							<span className="mt-0.5 block text-omp-xs leading-relaxed text-(--omp-muted)">
								{option.description}
							</span>
						)}
					</span>
				</label>
			))}
		</div>
	);
}
