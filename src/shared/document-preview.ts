export const OFFICE_DOCUMENT = /\.(docx?|pptx?|xlsx?|od[pts]|rtf)$/i;
export const HTML_DOCUMENT = /\.html?$/i;
export const TABLE_DOCUMENT = /\.(csv|tsv)$/i;

export interface DocumentPage {
	label?: string;
	html: string;
}

export type DocumentPreviewResult =
	| { kind: "image"; dataUrl: string }
	| { kind: "document"; pages: DocumentPage[]; incomplete: boolean }
	| { kind: "unavailable" };
