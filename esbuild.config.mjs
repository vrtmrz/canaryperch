import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { readFile } from "fs/promises";
const banner =
	`/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = (process.argv[2] === "production");

const nestURL = process.env.CANARY_NEST_URI;
const nestToken = process.env.CANARY_NEST_TOKEN;

/** @type esbuild.Plugin */
const sendToCanaryNest = {
	name: 'send-to-canary-nest',
	setup(build) {
		build.onEnd(async result => {
			if (nestURL) {
				console.log("Sending for canary nest..");
				try {
					await Promise.all(["main.js", "styles.css", "manifest.json"].map(async e => await (await (fetch(`${nestURL}/${e}?q=${nestToken}`, { method: "PUT", body: await readFile(e) })))));
				} catch (ex) {
					console.error(ex)
				}
				console.log("Sending done!");
			}
		});
	},
};
const context = await esbuild.context({
	banner: {
		js: banner,
	},
	entryPoints: ["main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	plugins: [sendToCanaryNest]
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}