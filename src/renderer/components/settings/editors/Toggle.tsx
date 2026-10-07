/**
 * Toggle switch component: full-width switch with label and optional description.
 * Used primarily in settings pages for boolean configuration options.
 */

export function Toggle({
	checked,
	onChange,
	label,
	description,
	disabled,
	badge,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
	description?: string;
	disabled?: boolean;
	badge?: React.ReactNode;
}) {
	return (
		<button
			aria-checked={checked}
			aria-label={label}
			className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-md px-2 py-2 text-left transition-colors hover:bg-(--omp-bg-tertiary) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
			disabled={disabled}
			onClick={() => onChange(!checked)}
			role="switch"
			type="button"
		>
			<span className="min-w-0">
				<span className="flex items-center gap-2">
					<span className="block text-xs font-medium text-(--omp-text)">{label}</span>
					{badge}
				</span>
				{description && (
					<span className="mt-0.5 block text-omp-sm leading-snug text-(--omp-muted)">{description}</span>
				)}
			</span>
			<span
				aria-hidden
				className={`relative mt-0.5 h-4.5 w-8 shrink-0 rounded-full transition-colors duration-150 ${
					checked ? "bg-(--omp-switch-on)" : "bg-(--omp-switch-off)" // surface-ok: toggle switch track fill
				}`}
			>
				<span
					className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-[left] duration-150 ${
						checked ? "left-4" : "left-0.5"
					}`}
				/>
			</span>
		</button>
	);
}
