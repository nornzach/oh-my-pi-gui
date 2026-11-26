/**
 * Pre-paint theme script — loaded synchronously from <head>, BEFORE any
 * module. The prefs IPC that resolves the real theme is async, so without
 * this every cold start painted the light default first: a white flash for
 * dark-theme users. Mirrors the scheme written by lib/themes.ts
 * (applyThemeByName → localStorage "omp.themeScheme"), and the chosen
 * theme's background ("omp.themeBackground") when it is a plain color.
 */
(function () {
	try {
		var scheme = localStorage.getItem("omp.themeScheme");
		if (scheme === "system") {
			scheme =
				window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light";
		}
		if (scheme === "dark" || scheme === "light") {
			document.documentElement.dataset.theme = scheme;
			var background = localStorage.getItem("omp.themeBackground");
			var plain = background && window.CSS && CSS.supports("color", background) && !/var\(/.test(background);
			document.documentElement.style.backgroundColor = plain ? background : scheme === "dark" ? "#1f1f1f" : "#ffffff";
			document.documentElement.style.colorScheme = scheme;
		}
		var chatWidth = localStorage.getItem("omp.chatWidth");
		if (chatWidth === "wide" || chatWidth === "full") {
			document.documentElement.dataset.chatWidth = chatWidth;
		}
		var rawFontSize = localStorage.getItem("omp.fontSize");
		if (rawFontSize) {
			var parsedSize = Number(rawFontSize);
			if (Number.isFinite(parsedSize) && parsedSize >= 10 && parsedSize <= 20) {
				document.documentElement.style.setProperty("--gui-font-size", Math.round(parsedSize) + "px");
			}
		}
		var interfaceFont = localStorage.getItem("omp.interfaceFont");
		if (interfaceFont) {
			var quotedInterfaceFont = '"' + interfaceFont.slice(0, 120).replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
			document.documentElement.style.setProperty(
				"--font-body",
				quotedInterfaceFont + ', -apple-system, BlinkMacSystemFont, "Inter Variable", "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
			);
			document.documentElement.style.setProperty("--font-display", document.documentElement.style.getPropertyValue("--font-body"));
		}
		var codeFont = localStorage.getItem("omp.codeFont");
		if (codeFont) {
			var quotedCodeFont = '"' + codeFont.slice(0, 120).replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
			document.documentElement.style.setProperty(
				"--font-mono",
				quotedCodeFont + ', ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", "Cascadia Code", Menlo, monospace',
			);
		}
		var density = localStorage.getItem("omp.compactDensity");
		if (density === "tight" || density === "comfortable") {
			document.documentElement.dataset.density = density;
		}
	} catch (e) {
		/* no localStorage — the light default background stands */
	}
})();
