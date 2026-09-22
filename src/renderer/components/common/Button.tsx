/**
 * Button primitive: primary / secondary / ghost / danger variants,
 * three sizes, icon slots, loading state.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** Subtle top-edge highlight derived from the variant's own text token. */
const innerHighlight = (textToken: string) =>
	`shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(${textToken})_12%,transparent),var(--omp-shadow-sm)]`;

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
	primary: `border-transparent bg-(--omp-btn-primary-bg) text-(--omp-btn-primary-text) ${innerHighlight("--omp-btn-primary-text")} hover:brightness-110 active:brightness-95 disabled:hover:brightness-100`,
	secondary:
		"border-(--omp-border) bg-(--omp-btn-secondary-bg) text-(--omp-btn-secondary-text) shadow-(--omp-shadow-sm) hover:border-(--omp-border-strong) hover:bg-(--omp-selected-bg) active:brightness-[0.96]",
	ghost: "border-transparent bg-transparent text-(--omp-muted) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)",
	danger: `border-transparent bg-(--omp-btn-danger-bg) text-(--omp-btn-danger-text) ${innerHighlight("--omp-btn-danger-text")} hover:brightness-110 active:brightness-95 disabled:hover:brightness-100`,
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
	sm: "h-7 gap-1.5 rounded-lg px-2.5 text-omp-md",
	md: "h-8 gap-1.5 rounded-lg px-3.5 text-omp-lg",
	lg: "h-10 gap-2 rounded-lg px-[18px] text-omp-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	/** Icon rendered before the label (lucide component or element). */
	icon?: ReactNode;
	/** Icon rendered after the label. */
	trailingIcon?: ReactNode;
	/** Show a spinner and disable interaction. */
	loading?: boolean;
}

export function Button({
	variant = "secondary",
	size = "md",
	icon,
	trailingIcon,
	loading,
	disabled,
	className,
	children,
	type,
	...rest
}: ButtonProps) {
	return (
		<button
			type={type ?? "button"}
			className={`inline-flex select-none items-center justify-center border font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,filter,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--omp-accent) active:translate-y-px disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none disabled:active:translate-y-0 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className ?? ""}`.trim()}
			disabled={disabled || loading}
			{...rest}
		>
			{loading ? <Spinner size="sm" /> : icon}
			{children}
			{trailingIcon}
		</button>
	);
}
