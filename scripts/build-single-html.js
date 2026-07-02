const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const frontendDir = path.join(root, "frontend");
const distDir = path.join(root, "dist");
const outputPath = path.join(distDir, "Claude对话展示器.html");

function readFrontendFile(relativePath) {
  return fs.readFileSync(path.join(frontendDir, relativePath), "utf8");
}

function escapeScript(content) {
  return content.replace(/<\/script/gi, "<\\/script");
}

let html = readFrontendFile("index.html");

html = html.replace(
  /<link rel="stylesheet" href="styles\.css" \/>/,
  () => `<style>\n${readFrontendFile("styles.css")}\n</style>`
);

const scripts = [
  "vendor/vue.global.prod.js",
  "vendor/jszip.min.js",
  "vendor/mermaid.min.js",
  "importer.js",
  "app.js",
];

for (const scriptPath of scripts) {
  const pattern = new RegExp(`<script src="${scriptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"><\\/script>`);
  html = html.replace(pattern, () => `<script>\n${escapeScript(readFrontendFile(scriptPath))}\n</script>`);
}

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(outputPath, html);

console.log(`Built ${path.relative(root, outputPath)}`);
