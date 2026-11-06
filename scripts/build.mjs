import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode"]
};

const webviewConfig = {
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "dist/webview.js"
};

async function run() {
  if (watch) {
    const extensionCtx = await context(extensionConfig);
    const webviewCtx = await context(webviewConfig);
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    console.log("Watching iEdit prototype extension...");
    return [extensionCtx, webviewCtx];
  }
  await Promise.all([build(extensionConfig), build(webviewConfig)]);
  console.log("Build complete.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
