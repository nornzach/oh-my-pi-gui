import DOMPurify from "dompurify";
import { useMemo, useState } from "react";
import type { DocumentPage } from "../../../shared/document-preview";
import { useT } from "../../lib/i18n";

function sandboxSource(html: string): string {
	const sanitized = DOMPurify.sanitize(html, {
		WHOLE_DOCUMENT: true,
		ADD_TAGS: ["style"],
		FORBID_TAGS: [
			"script",
			"base",
			"link",
			"meta",
			"iframe",
			"frame",
			"frameset",
			"form",
			"object",
			"embed",
			"audio",
			"video",
			"svg",
			"math",
		],
		FORBID_ATTR: ["href", "srcset", "action", "formaction", "background", "poster", "ping"],
		ALLOWED_URI_REGEXP: /^data:image\/(?:png|jpeg|gif|webp);base64,/i,
	});
	const policy =
		"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'\">";
	const styles =
		"<style>html{background:#fff;color:#1c2024}body{margin:18px;font-family:system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:inherit}hr{border:0;border-top:1px solid #ddd}</style>";
	return sanitized.replace(/<head\b[^>]*>/i, tag => tag + policy + styles);
}

/** Script-free isolated preview for local HTML and Quick Look's generated Office pages. */
export function DocumentPreview({
	pages,
	title,
	incomplete = false,
}: {
	pages: DocumentPage[];
	title: string;
	incomplete?: boolean;
}) {
	const t = useT();
	const [selected, setSelected] = useState(0);
	const page = pages[selected] ?? pages[0];
	const source = useMemo(() => sandboxSource(page?.html ?? ""), [page]);
	return (
		<div className="flex h-full min-h-0 flex-col">
			{pages.length > 1 && (
				<div className="flex shrink-0 gap-1 overflow-x-auto border-b border-(--omp-border-muted) px-2 py-1.5">
					{pages.map((item, index) => (
						<button
							aria-pressed={selected === index}
							className="omp-pressable shrink-0 rounded-md px-2.5 py-1 text-omp-sm hover:bg-(--omp-bg-tertiary) aria-pressed:bg-(--omp-selected-bg) aria-pressed:text-(--omp-accent)"
							key={index}
							onClick={() => setSelected(index)}
							type="button"
						>
							{item.label || t("filesPanel.documentPage", { page: index + 1 })}
						</button>
					))}
				</div>
			)}
			{incomplete && (
				<p
					role="status"
					className="shrink-0 border-b border-(--omp-border-muted) px-3 py-1.5 text-omp-xs text-(--omp-dim)"
				>
					{t("filesPanel.documentIncomplete")}
				</p>
			)}
			<iframe
				data-document-preview
				className="min-h-0 w-full flex-1 border-0 bg-white"
				sandbox=""
				srcDoc={source}
				title={title}
			/>
		</div>
	);
}

function separatedRows(content: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	const addField = () => {
		row.push(field);
		field = "";
	};
	for (let index = content.charCodeAt(0) === 0xfeff ? 1 : 0; index < content.length; index++) {
		const char = content[index];
		if (char === '"') {
			if (quoted && content[index + 1] === '"') {
				field += '"';
				index++;
			} else if (quoted || field === "") quoted = !quoted;
			else field += char;
		} else if (!quoted && char === delimiter) addField();
		else if (!quoted && (char === "\n" || char === "\r")) {
			addField();
			rows.push(row);
			row = [];
			if (char === "\r" && content[index + 1] === "\n") index++;
		} else field += char;
	}
	if (row.length || field.length) {
		addField();
		rows.push(row);
	}
	return rows;
}

export function DelimitedTable({ content, path }: { content: string; path: string }) {
	const rows = useMemo(() => separatedRows(content, /\.tsv$/i.test(path) ? "\t" : ","), [content, path]);
	const [head = [], ...body] = rows;
	return (
		<table className="min-w-full border-collapse text-left text-omp-sm" data-table-preview>
			<thead
				className="sticky top-0 bg-(--omp-bg-secondary)" // surface-ok: sticky table headers cover scrolled cell text
			>
				<tr>
					{head.map((cell, index) => (
						<th className="border border-(--omp-border-muted) px-2 py-1.5" key={index}>
							{cell}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{body.map((row, index) => (
					<tr key={index}>
						{row.map((cell, column) => (
							<td
								className="min-w-12 border border-(--omp-border-muted) px-2 py-1 whitespace-pre-wrap"
								key={column}
							>
								{cell}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}
