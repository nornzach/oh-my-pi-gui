/**
 * InlineMarkdown: the `code` and **bold** spans of a one-line snippet (a run
 * summary in a list row, a finding title) as React nodes. Everything else is
 * plain text, so nothing a model writes can become markup; full reports go
 * through MarkdownRenderer instead.
 */

const SPAN_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/;

export function InlineMarkdown({ text }: { text: string }) {
	return (
		<>
			{text.split(SPAN_RE).map((part, index) => {
				// split() with one capture group puts the matched spans at odd indexes.
				if (index % 2 === 0) return part;
				const key = `${index}-${part}`;
				return part.startsWith("`") ? (
					<code className="omp-inline-code" key={key}>
						{part.slice(1, -1)}
					</code>
				) : (
					<strong className="font-semibold" key={key}>
						{part.slice(2, -2)}
					</strong>
				);
			})}
		</>
	);
}
