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

copyDir(
  path.join(root, "node_modules", "mermaid", "dist"),
  path.join(vendorDir, "mermaid")
);

console.log("Frontend vendor assets prepared.");
