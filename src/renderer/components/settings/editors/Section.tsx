/**
 * Section component: a labeled section container with a sentence-case heading.
 * Used in settings pages to group related configuration options.
 */

export function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
	return (
		<section id={id} className="mb-7 scroll-mt-4">
			<h3 className="mb-2 text-omp-md font-semibold text-(--omp-text)">{title}</h3>
			{children}
		</section>
	);
}
