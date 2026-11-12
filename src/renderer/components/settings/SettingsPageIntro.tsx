/**
 * The opening line of a settings page: what the page is for, and the page's
 * primary actions on the right. The page title itself lives in the Settings
 * header, so every page names itself in the same place and style.
 */

import type { ReactNode } from "react";
import { cx } from "../../lib/format";

export function SettingsPageIntro({
	description,
	actions,
	className,
}: {
	description: ReactNode;
	actions?: ReactNode;
	className?: string;
}) {
	return (
		<header className={cx("flex flex-wrap items-start justify-between gap-4", className)}>
			<p className="max-w-2xl text-omp-sm leading-relaxed text-(--omp-muted)">{description}</p>
			{actions}
		</header>
	);
}
