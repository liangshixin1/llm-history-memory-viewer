const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const frontendDir = path.join(root, "frontend");
const distDir = path.join(root, "dist");
const outputPath = path.join(distDir, "llm-history-memory-viewer.html");

function readFrontendFile(relativePath) {
  return fs.readFileSync(path.join(frontendDir, relativePath), "utf8");
}

function readFrontendAsset(relativePath) {
  return fs.readFileSync(path.join(frontendDir, relativePath));
}

function escapeScript(content) {
  return content.replace(/<\/script/gi, "<\\/script");
}

function inlineKatexFonts(css) {
  return css.replace(/url\(fonts\/([^)]+)\)/g, (_, filename) => {
    const fontBuffer = readFrontendAsset(path.join("vendor", "katex", "fonts", filename));
    const extension = path.extname(filename).slice(1);
    const mime = extension === "ttf" ? "font/ttf" : extension === "woff" ? "font/woff" : "font/woff2";
    return `url(data:${mime};base64,${fontBuffer.toString("base64")})`;
  });
}

let html = readFrontendFile("index.html");

html = html.replace(
  /<link rel="stylesheet" href="styles\.css" \/>/,
  () => `<style>\n${readFrontendFile("styles.css")}\n</style>`
);

html = html.replace(
  /<link rel="stylesheet" href="vendor\/katex\/katex\.min\.css" \/>/,
  () => `<style>\n${inlineKatexFonts(readFrontendFile("vendor/katex/katex.min.css"))}\n</style>`
);

const scripts = [
  "vendor/vue.global.prod.js",
  "vendor/jszip.min.js",
  "vendor/mermaid.min.js",
  "vendor/katex/katex.min.js",
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
