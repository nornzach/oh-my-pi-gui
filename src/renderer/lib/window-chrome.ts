/**
 * The window has no native title bar on any platform: the header runs to the top
 * edge and the window's own controls sit over it. This tells the styles which
 * controls to leave room for (`--omp-caption-*` in global.css), and keeps the ones
 * Electron draws on Windows and Linux in the header's colors, through every theme.
 */
export function startWindowChrome(): void {
	const root = document.documentElement;
	const { platform, windowChrome } = window.omp;
	root.dataset.platform = platform;
	const setFullScreen = (fullScreen: boolean) => {
		if (fullScreen) root.dataset.fullscreen = "";
		else delete root.dataset.fullscreen;
	};
	windowChrome.onFullScreenChange(setFullScreen);
	void windowChrome
		.isFullScreen()
		.then(setFullScreen)
		.catch(() => {});
	if (platform === "darwin") return;

	const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!pixel) return;
	// Tokens can be any CSS color; the window controls only take plain ones.
	const toHex = (color: string): string => {
		pixel.clearRect(0, 0, 1, 1);
		pixel.fillStyle = color;
		pixel.fillRect(0, 0, 1, 1);
		const [red = 0, green = 0, blue = 0] = pixel.getImageData(0, 0, 1, 1).data;
		return `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
	};
	let sent = "";
	const sync = () => {
		const style = getComputedStyle(root);
		const background = style.getPropertyValue("--omp-titlebar-bg").trim();
		const text = style.getPropertyValue("--omp-titlebar-text").trim();
		if (!background || !text) return;
		const colors = { color: toHex(background), symbolColor: toHex(text) };
		const key = `${colors.color}${colors.symbolColor}`;
		if (key === sent) return;
		sent = key;
		windowChrome.setCaptionColors(colors);
	};
	// Themes land on the root: its theme attribute, or tokens set inline.
	new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme", "style"] });
	sync();
}

/** Windows and Linux have no menu bar without a native title bar, so the header offers the menu itself. */
export function headerHasAppMenu(): boolean {
	const platform = document.documentElement.dataset.platform;
	return platform === "win32" || platform === "linux";
}
