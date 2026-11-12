import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RootErrorBoundary } from "./components/common/RootErrorBoundary";
import { I18nProvider } from "./lib/i18n";
import { startKeyboardLayoutSync } from "./lib/keyboard-layout";
import { installGlobalRuntimeErrorHandlers, reportRuntimeError } from "./lib/runtime-errors";
import { startWindowChrome } from "./lib/window-chrome";
import "./styles/global.css";
import "./styles/theme-dark.css";
import "./styles/theme-light.css";
import "./styles/components.css";

installGlobalRuntimeErrorHandlers();
startWindowChrome();
startKeyboardLayoutSync();

const container = document.getElementById("root");
if (!container) {
	const error = new Error("Root container #root not found");
	reportRuntimeError("react-uncaught", error, { url: window.location.href });
	throw error;
}

createRoot(container, {
	onCaughtError: (error, info) => {
		reportRuntimeError("react-render", error, { componentStack: info.componentStack });
	},
	onUncaughtError: (error, info) => {
		reportRuntimeError("react-uncaught", error, { componentStack: info.componentStack });
	},
	onRecoverableError: (error, info) => {
		reportRuntimeError("react-recoverable", error, { componentStack: info.componentStack });
	},
}).render(
	<RootErrorBoundary>
		<I18nProvider>
			<App />
		</I18nProvider>
	</RootErrorBoundary>,
);
