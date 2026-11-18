import type { Nodes, Parent, Root } from "mdast";
import { looksLikeFilePath, parseFileTarget, trimAddress } from "./link-targets";

const PATH_TOKEN = /[^\s<>"'\x60()[\]{}，。；：！？、]+/g;
const PATH_SHAPE = /(?:[\\/][^\\/]+\.[\w-]{1,16}$|^~?[\\/][^\\/]+[\\/]|^[A-Za-z]:[\\/]|^\.\.?[\\/])/;

/** Use the existing resolved-path renderer for file references in prose. */
export function remarkFilePaths() {
	return (tree: Root) => {
		const visit = (parent: Parent) => {
			const children: Nodes[] = [];
			for (const node of parent.children) {
				if (node.type !== "text") {
					if ("children" in node && node.type !== "link" && node.type !== "linkReference") visit(node);
					children.push(node);
					continue;
				}
				if (!/[\\/]/.test(node.value)) {
					children.push(node);
					continue;
				}
				let offset = 0;
				for (const match of node.value.matchAll(PATH_TOKEN)) {
					const token = trimAddress(match[0]);
					if (!PATH_SHAPE.test(parseFileTarget(token).path) || !looksLikeFilePath(token)) continue;
					if (match.index > offset) children.push({ type: "text", value: node.value.slice(offset, match.index) });
					children.push({ type: "inlineCode", value: token });
					offset = match.index + token.length;
				}
				if (offset === 0) children.push(node);
				else if (offset < node.value.length) children.push({ type: "text", value: node.value.slice(offset) });
			}
			parent.children = children as Parent["children"];
		};
		visit(tree);
	};
}
