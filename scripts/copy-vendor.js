const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "frontend", "vendor");

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

copyFile(
  path.join(root, "node_modules", "vue", "dist", "vue.global.prod.js"),
  path.join(vendorDir, "vue.global.prod.js")
);

copyFile(
  path.join(root, "node_modules", "jszip", "dist", "jszip.min.js"),
  path.join(vendorDir, "jszip.min.js")
);

copyFile(
  path.join(root, "node_modules", "mermaid", "dist", "mermaid.min.js"),
  path.join(vendorDir, "mermaid.min.js")
);

copyFile(
  path.join(root, "node_modules", "katex", "dist", "katex.min.css"),
  path.join(vendorDir, "katex", "katex.min.css")
);

copyFile(
  path.join(root, "node_modules", "katex", "dist", "katex.min.js"),
  path.join(vendorDir, "katex", "katex.min.js")
);

copyDir(
  path.join(root, "node_modules", "katex", "dist", "fonts"),
  path.join(vendorDir, "katex", "fonts")
);

console.log("Frontend vendor assets prepared.");
