/**
 * The look of every on/off switch in the app: one track, one thumb, one size
 * and one glide. The element that carries `role="switch"` (a row button, a
 * bare button, a label) wraps this and owns the semantics and focus.
 */

import { cx } from "../../lib/format";

export function SwitchTrack({ on, className }: { on: boolean; className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cx(
				"omp-switch-track relative block h-5 w-9 shrink-0 rounded-full",
				on ? "bg-(--omp-switch-on)" : "bg-(--omp-switch-off)", // surface-ok: toggle switch track fill
				className,
			)}
		>
			<span
				className={cx(
					"omp-switch-thumb absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow",
					on ? "translate-x-4" : "translate-x-0",
				)}
			/>
		</span>
	);
}
