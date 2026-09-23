const fs = require("node:fs/promises");
const path = require("node:path");
const plist = require("plist");

/**
 * electron-builder enables arbitrary ATS loads after applying mac.extendInfo so
 * its localhost updater exception works. Restore the app's explicit policy
 * after that mutation and before the bundle is signed.
 */
async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") return;

	const infoPath = path.join(context.appOutDir, "omp.app", "Contents", "Info.plist");
	const info = plist.parse(await fs.readFile(infoPath, "utf8"));
	const transport = info.NSAppTransportSecurity;
	info.NSAppTransportSecurity = {
		...(transport && typeof transport === "object" ? transport : {}),
		NSAllowsArbitraryLoads: false,
		NSAllowsLocalNetworking: true,
	};
	await fs.writeFile(infoPath, plist.build(info));
}

module.exports = { afterPack };
