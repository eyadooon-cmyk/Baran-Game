import { LEO_MANUAL_CATALOG, flattenLeoManualCatalog } from "./leo-manual-catalog.js";

const rootId = "leoManualCatalog";
const escapeText = (value) => String(value ?? "");
function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderLeoManualCatalog() {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.replaceChildren();
  const intro = make("p", "small", "هذا كتالوج مستقل للتنفيذ اليدوي. الأسعار قيد المراجعة، والشراء والشحن غير مفعّلين حالياً.");
  root.append(intro);

  LEO_MANUAL_CATALOG.categories.forEach(category => {
    const section = make("section", "leo-category");
    section.dataset.leoCategory = category.id;
    section.append(make("h3", "", category.title));
    section.append(make("p", "small", "المعرّف المطلوب: " + category.inputLabel));
    category.groups.forEach(group => {
      const groupBox = make("div", "leo-product-group");
      groupBox.append(make("h4", "", group.title));
      const grid = make("div", "leo-product-grid");
      group.products.forEach(product => {
        const card = make("article", "leo-product-card");
        card.dataset.productCode = product.code;
        card.append(make("strong", "", product.name));
        card.append(make("span", "leo-price-pending", "السعر قيد الاعتماد"));
        const button = make("button", "secondary leo-disabled-button", "غير متاح حالياً");
        button.type = "button";
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
        card.append(button);
        grid.append(card);
      });
      groupBox.append(grid);
      section.append(groupBox);
    });
    root.append(section);
  });
  root.dataset.productCount = String(flattenLeoManualCatalog().length);
  root.dataset.fulfilmentMode = "manual";
  root.dataset.purchaseEnabled = "false";
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderLeoManualCatalog, { once: true });
} else {
  renderLeoManualCatalog();
}
