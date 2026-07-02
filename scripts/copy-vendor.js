const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "frontend", "vendor");

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
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

console.log("Frontend vendor assets prepared.");
