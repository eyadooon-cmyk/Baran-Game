"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const number = (value, digits = 2) => Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });
  const syp = (value) => Number(value || 0).toLocaleString("en-US", {minimumFractionDigits:2,maximumFractionDigits:2}) + " ل.س جديدة";
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
    "#financePricingPolicyMount table{width:100%;min-width:980px;border-collapse:collapse;font-size:12px}",
    "#financePricingPolicyMount th,#financePricingPolicyMount td{padding:9px;border-bottom:1px solid #40334b;text-align:right;white-space:nowrap}",
    "#financePricingPolicyMount th{background:#211a2b;color:#d7c4e8}",
    "#financePricingPolicyMount .pricing-policy-status{min-height:22px;color:#d7c4e8;font-size:12px;margin-top:8px}",
    "#financePricingPolicyMount .fx-monitor-card{padding:13px;border:1px solid #554365;border-radius:13px;background:#1d1725;margin-bottom:16px}",
    "#financePricingPolicyMount .fx-monitor-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0}",
    "#financePricingPolicyMount .fx-monitor-stat{padding:10px;border-radius:10px;background:#2a2034;min-width:0}",
    "#financePricingPolicyMount .fx-monitor-stat strong{display:block;font-size:17px;margin-top:5px;color:#f2e8fa}",
    "#financePricingPolicyMount .fx-monitor-meta{font-size:11px;color:#b9a9c7;line-height:1.6}",
    "@media(max-width:500px){#financePricingPolicyMount .fx-monitor-grid{grid-template-columns:1fr 1fr}}",
    "@media(max-width:620px){#financePricingPolicyMount .pricing-policy-grid{grid-template-columns:1fr 1fr}}",
    "@media(max-width:380px){#financePricingPolicyMount .pricing-policy-grid{grid-template-columns:1fr}}"
  ].join("");
  document.head.appendChild(style);

  function renderFxMonitor(data, message) {
    const box = $("financeFxRateMount");
    if (!box) return;
    const state = data?.state || {};
    const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
    const latest = {};
    snapshots.forEach((item) => {
      if (!latest[item.provider] || new Date(item.fetched_at) > new Date(latest[item.provider].fetched_at)) latest[item.provider] = item;
    });
    const statusLabels = {
      success: "المصدران متوافقان — تم تحديث السعر",
      rate_decrease_pending: "السوق انخفض — أبقينا سعر المتجر بانتظار قرار المدير",
      source_disagreement: "اختلاف بين المصدرين — أوقفنا الاعتماد الآلي",
      source_unavailable: "تعذر الوصول للمصدرين — احتفظنا بالسعر السابق",
      stale: "مصدر واحد فقط متاح — لم نعتمد سعراً جديداً",
      waiting: "بانتظار أول تحديث",
      disabled: "التحديث التلقائي متوقف"
    };
    const sourceCard = (name, row) => '<div class="fx-monitor-stat"><span class="fx-monitor-meta">' + name + '</span>' +
      (row ? '<strong dir="ltr">' + syp(Number(row.sell_old)/100) + '</strong><span class="fx-monitor-meta">مبيع الدولار · شراء المتجر للدولار</span>' +
        '<span class="fx-monitor-meta">شراء الصراف: ' + syp(Number(row.buy_old)/100) + '</span>' +
        '<span class="fx-monitor-meta">بيانات المصدر: ' + esc(new Date(row.source_updated_at).toLocaleString("ar")) + '</span>'
        : '<strong>لا توجد قراءة</strong><span class="fx-monitor-meta">لم يتم استلام سعر موثوق</span>') + '</div>';
    box.innerHTML =
      '<div class="fx-monitor-card"><div class="finance-section-heading"><div><span class="finance-kicker">LIVE SYRIAN FX</span><h3>مراقب سعر الصرف السوري التلقائي</h3>' +
      '<p class="small">مرجع دمشق · مصدران مستقلان · تحديث كل 6 ساعات · الارتفاع تلقائي والانخفاض بقرار المدير فقط</p></div><span class="finance-section-icon">📡</span></div>' +
      '<div class="fx-monitor-grid">' +
      '<div class="fx-monitor-stat"><span class="fx-monitor-meta">سعر السوق المعتمد</span><strong dir="ltr">' + (state.applied_rate_old == null ? '—' : syp(Number(state.applied_rate_old)/100)) + '</strong><span class="fx-monitor-meta">ليرة جديدة لكل دولار قبل حماية الصرف</span></div>' +
      sourceCard("Liraty", latest.Liraty) + sourceCard("LiraScope", latest.LiraScope) +
      '</div><div class="fx-monitor-meta">الحالة: ' + esc(statusLabels[state.status] || state.status || "غير معروف") +
      ' · فرق المصدرين: ' + (state.source_difference_percent == null ? "—" : number(state.source_difference_percent,2) + "%") +
      '<br>آخر تحديث ناجح: ' + (state.last_success_at ? esc(new Date(state.last_success_at).toLocaleString("ar")) : "لم يحدث بعد") +
      '<br>آخر محاولة: ' + (state.last_attempt_at ? esc(new Date(state.last_attempt_at).toLocaleString("ar")) : "—") +
      (state.last_error ? '<br><span style="color:#e8bd83">ملاحظة: ' + esc(state.last_error) + '</span>' : '') +
      '</div><div class="ops-actions" style="margin-top:10px"><button type="button" id="financeFxRefresh">فحص السعر الآن</button></div>' +
      '<div id="financeFxStatus" class="pricing-policy-status" role="status" aria-live="polite">' + esc(message || "الأسعار استرشادية؛ عند اختلاف المصدرين بأكثر من 2% لا نغير سعر المتجر.") + '</div>' +
      '<p class="fx-monitor-meta">المصدران: <a href="https://liraty.com/developers" target="_blank" rel="noopener">Liraty</a> و <a href="https://lirascope.syria-cloud.sy/ar/api-docs" target="_blank" rel="noopener">LiraScope</a>. تُحفظ قراءات المصدر بالليرة القديمة داخلياً وتُعرض هنا بالليرة الجديدة بعد القسمة على 100. سعر المبيع هو تكلفة شراء الدولار من الصراف. الارتفاع يُعتمد تلقائياً، أما الانخفاض فلا يغيّر سعر المتجر إلا بقرار المدير.</p></div>';
    $("financeFxRefresh")?.addEventListener("click", async () => {
      const button = $("financeFxRefresh"), status = $("financeFxStatus");
      button.disabled = true; status.textContent = "جاري فحص المصدرين...";
      try {
        if (typeof window.callFxRatesApi !== "function") throw new Error("واجهة مراقب الصرف غير جاهزة.");
        let result;
        try { result = await window.callFxRatesApi({ action: "refresh", source: "admin" }); }
        catch (error) {
          const latestData = await window.callFxRatesApi();
          renderFxMonitor(latestData, error.message);
          return;
        }
        const latestData = await window.callFxRatesApi();
        renderFxMonitor(latestData, result.status === "rate_decrease_pending" ? "السوق انخفض؛ لم نخفض سعر المتجر. التخفيض يحتاج قرار المدير." : (result.status === "success" ? "تمت مطابقة المصدرين وتحديث سعر السوق عند الارتفاع فقط." : (result.message || "لم نعتمد سعراً جديداً.")));
        if (result.status === "success" || result.status === "rate_decrease_pending") {
          if (typeof window.loadAdminPanel === "function") await window.loadAdminPanel();
        }
      } catch (error) {
        status.textContent = "تعذر الفحص: " + (error?.message || "خطأ غير معروف");
      } finally {
        const current = $("financeFxRefresh");
        if (current) current.disabled = false;
      }
    });
  }

  async function loadFxMonitor() {
    const box = $("financeFxRateMount");
    if (!box || typeof window.callFxRatesApi !== "function") return;
    try {
      renderFxMonitor(await window.callFxRatesApi());
    } catch (error) {
      box.innerHTML = '<div class="fx-monitor-card"><h3>مراقب سعر الصرف السوري التلقائي</h3><p class="small">تعذر تحميل حالة مراقب الصرف: ' + esc(error?.message || "خطأ غير معروف") + '</p></div>';
    }
  }

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
      if (!product || product.is_active !== true || product.product_code === "JAWAKER_TOKENS") return null;
      const costUsd = Number(link.unit_cost || 0);
      const saleUsd = Number((costUsd * (1 + markup / 100)).toFixed(2));
      return {
        code: product.product_code,
        name: product.name,
        costUsd,
        costAtMarket: costUsd * market / 100,
        currentUsd: Number(product.price_usd || 0),
        currentSyp: Number(product.price_syp || 0),
        saleUsd,
        saleSyp: saleUsd * commercial / 100,
        fxBufferSyp: costUsd * (commercial - market) / 100,
        markupSyp: (saleUsd - costUsd) * commercial / 100,
        profitUsd: saleUsd - costUsd,
        profitSyp: (saleUsd * commercial - costUsd * market) / 100,
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
      '<th>سعر البيع المقترح USD</th><th>ربحنا المتوقع USD</th><th>سعر البيع المقترح SYP</th>' +
      '<th>مخصص فرق الصرف</th><th>زيادة المنتج</th><th>الفارق الإجمالي قبل الرسوم</th>' +
      '<th>السعر الحالي USD / SYP</th></tr></thead><tbody>' +
      rows.map((row) => '<tr><td>' + esc(row.name) + '<small style="display:block;color:#a998b8">' + esc(row.code) + '</small></td>' +
        '<td dir="ltr">' + usd(row.costUsd) + '</td><td dir="ltr">' + syp(row.costAtMarket) + '</td>' +
        '<td dir="ltr">' + usd(row.saleUsd) + '</td><td dir="ltr"><strong style="color:#8ce0b2">' + usd(row.profitUsd) + '</strong></td><td dir="ltr">' + syp(row.saleSyp) + '</td>' +
        '<td dir="ltr">' + syp(row.fxBufferSyp) + '</td><td dir="ltr">' + syp(row.markupSyp) + '</td><td dir="ltr">' + syp(row.profitSyp) + '</td><td dir="ltr">' + usd(row.currentUsd) + ' / ' + syp(row.currentSyp) + '</td></tr>'
      ).join("") + '</tbody></table></div>';
  }

  function previewFromInputs() {
    if (!latestPayload) return;
    const policy = {
      market_exchange_rate: Number($("financeMarketRate")?.value) * 100,
      fx_buffer_percent: Number($("financeFxBuffer")?.value),
      product_markup_percent: Number($("financeProductMarkup")?.value)
    };
    const commercial = policy.market_exchange_rate * (1 + policy.fx_buffer_percent / 100);
    const output = $("financeCommercialRate");
    if (output) output.textContent = Number.isFinite(commercial) ? number(commercial / 100, 2) + " ل.س جديدة" : "—";
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
      '<div id="financeFxRateMount"></div>' +
      '<div class="finance-section-heading"><div><span class="finance-kicker">PRICING POLICY</span><h3>سياسة التسعير وسعر الصرف</h3>' +
      '<p class="small">تكلفة المورد من حمص كارد بالدولار فقط. سعر السوق وفرق التحويل وهامش المنتج إعدادات مستقلة.</p></div><span class="finance-section-icon">💱</span></div>' +
      '<div class="pricing-policy-grid">' +
      '<div class="pricing-policy-field"><label for="financeMarketRate">سعر الدولار بالسوق السورية (ل.س جديدة)</label><input id="financeMarketRate" type="number" min="0.01" step="0.01" value="' + esc(market / 100) + '"></div>' +
      '<div class="pricing-policy-field"><label for="financeFxBuffer">فرق التحويل التجاري (%)</label><input id="financeFxBuffer" type="number" min="0" max="25" step="0.1" value="' + esc(buffer) + '"></div>' +
      '<div class="pricing-policy-field"><label for="financeProductMarkup">الزيادة على تكلفة المنتج (%)</label><input id="financeProductMarkup" type="number" min="0" max="100" step="0.1" value="' + esc(markup) + '"></div>' +
      '</div>' +
      '<div class="pricing-policy-result" style="margin-top:12px"><span class="small">سعر التحويل التجاري الناتج</span><strong id="financeCommercialRate" dir="ltr">' + number(commercial / 100,2) + ' ل.س جديدة</strong>' +
      '<p class="small">سعر السوق × (1 + فرق التحويل التجاري). هذا الفرق ليس ربحاً صافياً قبل احتساب رسوم الدفع وتكلفة إعادة شراء الدولار.</p></div>' +
      '<div class="finance-grid" style="margin-top:12px"><div class="pricing-policy-result"><span class="small">المنتج المقترح</span><strong>تكلفة المورد + ' + number(markup,1) + '%</strong></div>' +
      '<div class="pricing-policy-result"><span class="small">المورد المعتمد للمعاينة</span><strong>HomsCard · USD</strong></div></div>' +
      '<div class="ops-actions" style="margin-top:12px"><button type="button" id="financePricingSave">حفظ سياسة التسعير</button><button type="button" class="secondary" id="financePricingExport">تصدير معاينة الأسعار CSV</button></div>' +
      '<div id="financePricingStatus" class="pricing-policy-status" role="status" aria-live="polite"></div>' +
      '<div class="finance-section-heading" style="margin-top:18px"><div><span class="finance-kicker">HOMSCARD COST PREVIEW</span><h3>معاينة أسعار منتجات حمص كارد</h3>' +
      '<p class="small">اقتراحات للعرض فقط. الفارق الإجمالي يشمل أثر فرق التحويل والزيادة على التكلفة، قبل رسوم الدفع وإعادة شراء الدولار. لا يتم تغيير أسعار المنتجات الحالية أو فتح الشحن تلقائياً.</p></div><span class="finance-section-icon">🧮</span></div>' +
      '<div id="financePricingPreview"></div>' +
      '<p class="small" style="margin-top:10px">آخر حفظ لسياسة التسعير: ' + esc(updated) + '. تُحفظ قراءة السوق القديمة داخلياً، وتُعرض جميع الأسعار التجارية بالليرة الجديدة بعد القسمة على 100.</p>';

    ["financeMarketRate","financeFxBuffer","financeProductMarkup"].forEach((id) => $(id)?.addEventListener("input", previewFromInputs));
    $("financePricingSave")?.addEventListener("click", async () => {
      const marketRate = Number($("financeMarketRate")?.value) * 100;
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
        market_exchange_rate: Number($("financeMarketRate")?.value) * 100,
        fx_buffer_percent: Number($("financeFxBuffer")?.value),
        product_markup_percent: Number($("financeProductMarkup")?.value)
      });
      const csv = [
        ["product_code","product_name","supplier_cost_usd","cost_at_market_syp","suggested_sale_usd","suggested_sale_syp","fx_buffer_reserve_syp","product_markup_syp","gross_spread_before_fees_syp","current_sale_usd","current_sale_syp"],
        ...rows.map((row) => [row.code,row.name,row.costUsd,row.costAtMarket,row.saleUsd,row.saleSyp,row.fxBufferSyp,row.markupSyp,row.profitSyp,row.currentUsd,row.currentSyp])
      ].map((line) => line.map((value) => '"' + String(value == null ? "" : value).replace(/"/g,'""') + '"').join(",")).join("\r\n");
      const blob = new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "baran-homscard-pricing-preview.csv"; anchor.click();
      URL.revokeObjectURL(url);
    });
    previewFromInputs();
    loadFxMonitor();
  };
})();
