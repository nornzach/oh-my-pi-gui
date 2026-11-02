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
	} catch (e) {
		/* no localStorage — the light default background stands */
	}
})();
