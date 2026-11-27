"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const number = (value, digits = 2) => Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });
  const syp = (value) => Math.round(Number(value || 0)).toLocaleString("en-US") + " ل.س";
  const usd = (value) => number(value, 2) + " $";
  let latestPayload = null;

  const style = document.createElement("style");
  style.textContent = [
    "#financePricingPolicyMount .pricing-policy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}",
    "#financePricingPolicyMount .pricing-policy-field{display:flex;flex-direction:column;gap:6px;min-width:0}",
    "#financePricingPolicyMount .pricing-policy-field label{font-size:12px;color:#cbb8dd}",
    "#financePricingPolicyMount .pricing-policy-field input{width:100%;min-width:0;box-sizing:border-box}",
    "#financePricingPolicyMount .pricing-policy-result{padding:12px;border:1px solid #6a4b82;border-radius:12px;background:#21182b}",
    "#financePricingPolicyMount .pricing-policy-result strong{display:block;color:#f0e4fa;font-size:19px;margin-top:5px}",
    "#financePricingPolicyMount .pricing-preview-wrap{overflow-x:auto;margin-top:12px}",
    "#financePricingPolicyMount table{width:100%;min-width:760px;border-collapse:collapse;font-size:12px}",
    "#financePricingPolicyMount th,#financePricingPolicyMount td{padding:9px;border-bottom:1px solid #40334b;text-align:right;white-space:nowrap}",
    "#financePricingPolicyMount th{background:#211a2b;color:#d7c4e8}",
    "#financePricingPolicyMount .pricing-policy-status{min-height:22px;color:#d7c4e8;font-size:12px;margin-top:8px}",
    "@media(max-width:620px){#financePricingPolicyMount .pricing-policy-grid{grid-template-columns:1fr 1fr}}",
    "@media(max-width:380px){#financePricingPolicyMount .pricing-policy-grid{grid-template-columns:1fr}}"
  ].join("");
  document.head.appendChild(style);

  function getRows(payload, policy) {
    const suppliers = Array.isArray(payload?.suppliers) ? payload.suppliers : [];
    const links = Array.isArray(payload?.supplier_products) ? payload.supplier_products : [];
    const products = Array.isArray(payload?.products) ? payload.products : [];
    const homsCard = suppliers.find((supplier) =>
      supplier.is_active === true && String(supplier.name || "").trim().toLowerCase() === "homscard"
    );
    if (!homsCard) return [];
    const byId = new Map(products.map((product) => [product.id, product]));
    const market = Number(policy.market_exchange_rate || 15300);
    const buffer = Number(policy.fx_buffer_percent || 0);
    const markup = Number(policy.product_markup_percent || 0);
    const commercial = market * (1 + buffer / 100);
    return links.filter((link) =>
      link.supplier_id === homsCard.id && String(link.currency || "").toUpperCase() === "USD"
    ).map((link) => {
      const product = byId.get(link.product_id);
      if (!product || product.is_active !== true) return null;
      const costUsd = Number(link.unit_cost || 0);
      const saleUsd = costUsd * (1 + markup / 100);
      return {
        code: product.product_code,
        name: product.name,
        costUsd,
        costAtMarket: costUsd * market,
        currentUsd: Number(product.price_usd || 0),
        currentSyp: Number(product.price_syp || 0),
        saleUsd,
        saleSyp: saleUsd * commercial,
        profitUsd: saleUsd * commercial / market - costUsd,
        profitSyp: saleUsd * commercial - costUsd * market,
        currency: link.currency
      };
    }).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name, "ar"));
  }

  function renderTable(rows) {
    const box = $("financePricingPreview");
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<p class="small">لم نعثر على منتجات نشطة مرتبطة بحمص كارد بتكلفة بالدولار. لم يتم تعديل أي سعر.</p>';
      return;
    }
    box.innerHTML = '<div class="pricing-preview-wrap"><table><thead><tr>' +
      '<th>المنتج</th><th>تكلفة حمص كارد</th><th>التكلفة بسعر السوق</th>' +
      '<th>سعر البيع المقترح USD</th><th>سعر البيع المقترح SYP</th>' +
      '<th>الفارق الإجمالي قبل الرسوم</th><th>السعر الحالي USD / SYP</th></tr></thead><tbody>' +
      rows.map((row) => '<tr><td>' + esc(row.name) + '<small style="display:block;color:#a998b8">' + esc(row.code) + '</small></td>' +
        '<td dir="ltr">' + usd(row.costUsd) + '</td><td dir="ltr">' + syp(row.costAtMarket) + '</td>' +
        '<td dir="ltr">' + usd(row.saleUsd) + '</td><td dir="ltr">' + syp(row.saleSyp) + '</td>' +
        '<td dir="ltr">' + syp(row.profitSyp) + '</td><td dir="ltr">' + usd(row.currentUsd) + ' / ' + syp(row.currentSyp) + '</td></tr>'
      ).join("") + '</tbody></table></div>';
  }

  function previewFromInputs() {
    if (!latestPayload) return;
    const policy = {
      market_exchange_rate: Number($("financeMarketRate")?.value),
      fx_buffer_percent: Number($("financeFxBuffer")?.value),
      product_markup_percent: Number($("financeProductMarkup")?.value)
    };
    const commercial = policy.market_exchange_rate * (1 + policy.fx_buffer_percent / 100);
    const output = $("financeCommercialRate");
    if (output) output.textContent = Number.isFinite(commercial) ? number(commercial, 2) + " ل.س" : "—";
    renderTable(getRows(latestPayload, policy));
  }

  window.renderFinancePricingPolicy = function (payload) {
    latestPayload = payload || {};
    const mount = $("financePricingPolicyMount");
    if (!mount) return;
    const policy = payload?.pricing_policy || {};
    const market = Number(policy.market_exchange_rate || 15300);
    const buffer = Number(policy.fx_buffer_percent ?? 2);
    const markup = Number(policy.product_markup_percent ?? 3);
    const commercial = Number(policy.commercial_exchange_rate || market * (1 + buffer / 100));
    const updated = policy.updated_at ? new Date(policy.updated_at).toLocaleString("ar") : "الإعدادات الأولية";
    mount.innerHTML =
      '<div class="finance-section-heading"><div><span class="finance-kicker">PRICING POLICY</span><h3>سياسة التسعير وسعر الصرف</h3>' +
      '<p class="small">تكلفة المورد من حمص كارد بالدولار فقط. سعر السوق وفرق التحويل وهامش المنتج إعدادات مستقلة.</p></div><span class="finance-section-icon">💱</span></div>' +
      '<div class="pricing-policy-grid">' +
      '<div class="pricing-policy-field"><label for="financeMarketRate">سعر الدولار بالسوق السورية (ل.س)</label><input id="financeMarketRate" type="number" min="1" step="1" value="' + esc(market) + '"></div>' +
      '<div class="pricing-policy-field"><label for="financeFxBuffer">فرق التحويل التجاري (%)</label><input id="financeFxBuffer" type="number" min="0" max="25" step="0.1" value="' + esc(buffer) + '"></div>' +
      '<div class="pricing-policy-field"><label for="financeProductMarkup">الزيادة على تكلفة المنتج (%)</label><input id="financeProductMarkup" type="number" min="0" max="100" step="0.1" value="' + esc(markup) + '"></div>' +
      '</div>' +
      '<div class="pricing-policy-result" style="margin-top:12px"><span class="small">سعر التحويل التجاري الناتج</span><strong id="financeCommercialRate" dir="ltr">' + number(commercial,2) + ' ل.س</strong>' +
      '<p class="small">سعر السوق × (1 + فرق التحويل التجاري). هذا الفرق ليس ربحاً صافياً قبل احتساب رسوم الدفع وتكلفة إعادة شراء الدولار.</p></div>' +
      '<div class="finance-grid" style="margin-top:12px"><div class="pricing-policy-result"><span class="small">المنتج المقترح</span><strong>تكلفة المورد + ' + number(markup,1) + '%</strong></div>' +
      '<div class="pricing-policy-result"><span class="small">المورد المعتمد للمعاينة</span><strong>HomsCard · USD</strong></div></div>' +
      '<div class="ops-actions" style="margin-top:12px"><button type="button" id="financePricingSave">حفظ سياسة التسعير</button><button type="button" class="secondary" id="financePricingExport">تصدير معاينة الأسعار CSV</button></div>' +
      '<div id="financePricingStatus" class="pricing-policy-status" role="status" aria-live="polite"></div>' +
      '<div class="finance-section-heading" style="margin-top:18px"><div><span class="finance-kicker">HOMSCARD COST PREVIEW</span><h3>معاينة أسعار منتجات حمص كارد</h3>' +
      '<p class="small">اقتراحات للعرض فقط. الفارق الإجمالي يشمل أثر فرق التحويل والزيادة على التكلفة، قبل رسوم الدفع وإعادة شراء الدولار. لا يتم تغيير أسعار المنتجات الحالية أو فتح الشحن تلقائياً.</p></div><span class="finance-section-icon">🧮</span></div>' +
      '<div id="financePricingPreview"></div>' +
      '<p class="small" style="margin-top:10px">آخر حفظ لسياسة التسعير: ' + esc(updated) + '. سعر الصرف القديم المستخدم في أجزاء المتجر الأخرى يبقى منفصلاً ولا يتغير من هنا.</p>';

    ["financeMarketRate","financeFxBuffer","financeProductMarkup"].forEach((id) => $(id)?.addEventListener("input", previewFromInputs));
    $("financePricingSave")?.addEventListener("click", async () => {
      const marketRate = Number($("financeMarketRate")?.value);
      const fxBuffer = Number($("financeFxBuffer")?.value);
      const markup = Number($("financeProductMarkup")?.value);
      const status = $("financePricingStatus");
      const button = $("financePricingSave");
      if (!Number.isFinite(marketRate) || marketRate <= 0 || marketRate > 100000000 ||
          !Number.isFinite(fxBuffer) || fxBuffer < 0 || fxBuffer > 25 ||
          !Number.isFinite(markup) || markup < 0 || markup > 100) {
        status.textContent = "تحقق من سعر السوق وفرق التحويل والزيادة على التكلفة.";
        return;
      }
      button.disabled = true;
      status.textContent = "جاري حفظ سياسة التسعير...";
      try {
        if (typeof window.callAdminApi !== "function") throw new Error("واجهة الإدارة غير جاهزة. حدّث الصفحة وحاول مجدداً.");
        const result = await window.callAdminApi("POST", {
          action: "pricing_policy_update",
          market_exchange_rate: marketRate,
          fx_buffer_percent: fxBuffer,
          product_markup_percent: markup
        });
        if (!result?.pricing_policy) throw new Error("لم يؤكد الخادم حفظ سياسة التسعير.");
        status.textContent = "تم حفظ سياسة التسعير. لم يتم تغيير أسعار المنتجات.";
        if (typeof window.loadAdminPanel === "function") await window.loadAdminPanel();
      } catch (error) {
        status.textContent = "تعذر الحفظ: " + (error?.message || "خطأ غير معروف");
      } finally {
        if (button) button.disabled = false;
      }
    });
    $("financePricingExport")?.addEventListener("click", () => {
      const rows = getRows(latestPayload, {
        market_exchange_rate: Number($("financeMarketRate")?.value),
        fx_buffer_percent: Number($("financeFxBuffer")?.value),
        product_markup_percent: Number($("financeProductMarkup")?.value)
      });
      const csv = [
        ["product_code","product_name","supplier_cost_usd","cost_at_market_syp","suggested_sale_usd","suggested_sale_syp","expected_profit_syp","current_sale_usd","current_sale_syp"],
        ...rows.map((row) => [row.code,row.name,row.costUsd,row.costAtMarket,row.saleUsd,row.saleSyp,row.profitSyp,row.currentUsd,row.currentSyp])
      ].map((line) => line.map((value) => '"' + String(value == null ? "" : value).replace(/"/g,'""') + '"').join(",")).join("\r\n");
      const blob = new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "baran-homscard-pricing-preview.csv"; anchor.click();
      URL.revokeObjectURL(url);
    });
    previewFromInputs();
  };
})();
