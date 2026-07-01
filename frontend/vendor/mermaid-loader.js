(async () => {
  const module = await import("./mermaid/mermaid.esm.min.mjs");
  window.mermaid = module.default;
  document.documentElement.dataset.mermaidReady = "true";
  window.dispatchEvent(new CustomEvent("mermaid-ready"));
})();
