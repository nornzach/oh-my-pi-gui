/**
 * A plugin's logo: the avatar of the GitHub organization behind it, fetched by the
 * main process only once the card is near the screen, with a coloured initial until
 * then and for any plugin without one, which includes every personal account.
 */

import { useEffect, useRef, useState } from "react";
import { avatarHue, cx } from "../../../lib/format";

/** Survives the page closing, so reopening doesn't flash initials. */
const loadedLogos = new Map<string, string>();

export function PluginLogo({ owner, title, size = 40 }: { owner: string | null; title: string; size?: number }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [src, setSrc] = useState<string | null>(() => (owner ? (loadedLogos.get(owner) ?? null) : null));

	useEffect(() => {
		const known = owner ? (loadedLogos.get(owner) ?? null) : null;
		setSrc(known);
		if (!owner || known) return;
		let cancelled = false;
		const load = (): void => {
			window.omp.pluginCatalog.logo(owner).then(
				url => {
					if (!url) return;
					loadedLogos.set(owner, url);
					if (!cancelled) setSrc(url);
				},
				() => {},
			);
		};
		const element = ref.current;
		if (!element || typeof IntersectionObserver === "undefined") {
			load();
			return () => {
				cancelled = true;
			};
		}
		const observer = new IntersectionObserver(
			entries => {
				if (!entries.some(entry => entry.isIntersecting)) return;
				observer.disconnect();
				load();
			},
			{ rootMargin: "200px" },
		);
		observer.observe(element);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [owner]);

	const style = { width: size, height: size };
	return (
		<span
			aria-hidden="true"
			className={cx(
				"flex shrink-0 items-center justify-center overflow-hidden rounded-lg font-semibold text-white",
				src && "bg-white",
			)}
			ref={ref}
			style={src ? style : { ...style, backgroundColor: `hsl(${avatarHue(title)} 45% 42%)`, fontSize: size * 0.42 }}
		>
			{src ? (
				<img alt="" className="size-full object-cover" onError={() => setSrc(null)} src={src} />
			) : (
				(title[0]?.toUpperCase() ?? "?")
			)}
		</span>
	);
}
