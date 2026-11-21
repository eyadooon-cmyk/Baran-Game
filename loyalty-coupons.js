/* BARAN GAME — customer loyalty rewards and one-time discount coupons */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const node = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined) el.textContent = value;
    return el;
  };
  const statusLabels = { active: "جاهزة للاستخدام", reserved: "محجوزة لطلب قيد التنفيذ", redeemed: "مستخدمة بعد اكتمال الطلب", cancelled: "ملغاة" };

  async function loadMyRewards() {
    const tierBox = $("customerLoyaltyTier");
    const balanceBox = $("customerLoyaltyBalance");
    const catalog = $("customerRewardCatalog");
    const historyBox = $("customerLoyaltyHistory");
    if (!tierBox || !balanceBox || !catalog || !historyBox) return;
    if (!window.currentUser && typeof currentUser === "undefined") {
      tierBox.textContent = "سجّل الدخول لعرض نقاطك ومكافآتك.";
      return;
    }
    const user = typeof currentUser !== "undefined" ? currentUser : window.currentUser;
    if (!user?.id) {
      tierBox.textContent = "سجّل الدخول لعرض نقاطك ومكافآتك.";
      return;
    }
    tierBox.textContent = "جاري تحميل مستوى عضويتك...";
    balanceBox.textContent = "جاري تحميل رصيد النقاط...";
    catalog.replaceChildren(node("p", "small", "جاري تحميل قسائم الخصم..."));
    historyBox.textContent = "جاري تحميل سجل النقاط...";
    try {
      const [loyaltyResult, tiersResult, historyResult, couponsResult] = await Promise.all([
        sb.from("customer_loyalty").select("points_balance,lifetime_earned").eq("user_id", user.id).maybeSingle(),
        sb.from("loyalty_tiers").select("tier_code,tier_name,min_lifetime_points,badge_emoji,benefits").eq("is_active", true).order("min_lifetime_points", {ascending:true}),
        sb.from("loyalty_transactions").select("points,transaction_type,description,created_at").eq("user_id", user.id).order("created_at", {ascending:false}).limit(30),
        sb.rpc("get_my_loyalty_coupons")
      ]);
      if (loyaltyResult.error) throw loyaltyResult.error;
      if (tiersResult.error) throw tiersResult.error;
      if (historyResult.error) throw historyResult.error;
      if (couponsResult.error) throw couponsResult.error;

      const loyalty = loyaltyResult.data || {points_balance:0,lifetime_earned:0};
      const balance = Number(loyalty.points_balance || 0);
      const earned = Number(loyalty.lifetime_earned || 0);
      const tiers = tiersResult.data || [];
      const tier = tiers.filter(t => earned >= Number(t.min_lifetime_points)).at(-1);
      tierBox.replaceChildren(
        node("strong", "", (tier?.badge_emoji || "✦") + " " + (tier?.tier_name || "عضو BARAN")),
        node("p", "small", tier?.benefits?.join(" · ") || "استمر بالشراء المؤهل لجمع النقاط والارتقاء بمستواك.")
      );
      balanceBox.replaceChildren(
        node("strong", "", "رصيدك: " + balance.toLocaleString("en-US") + " نقطة"),
        node("p", "small", "إجمالي النقاط المكتسبة: " + earned.toLocaleString("en-US"))
      );

      catalog.replaceChildren();
      catalog.append(
        node("strong", "", "🎟️ قسيمة خصم BARAN"),
        node("p", "small", "كل 1,000 نقطة تمنحك قسيمة خصم بقيمة 1 دولار. القسيمة لمرة واحدة، ولا تتحول إلى رصيد نقدي.")
      );
      const redeem = node("button", "full", "استبدال 1,000 نقطة بقسيمة 1$");
      redeem.type = "button";
      redeem.disabled = balance < 1000;
      redeem.textContent = balance < 1000 ? "استبدل عند الوصول إلى 1,000 نقطة" : "استبدال 1,000 نقطة بقسيمة 1$";
      redeem.title = "تعمل القسائم حالياً على طلبات BARO المؤهلة فقط؛ يتحقق الخادم من تكلفة المورد وهامش الربح قبل قبولها."; 
      redeem.addEventListener("click", async () => {
        if (redeem.disabled) return;
        if (!window.confirm("سيتم خصم 1,000 نقطة وإصدار قسيمة خصم بقيمة 1 دولار. هل تريد المتابعة؟")) return;
        redeem.disabled = true;
        redeem.textContent = "جاري إصدار القسيمة...";
        try {
          const {data, error} = await sb.rpc("redeem_loyalty_coupon");
          if (error) throw error;
          const issued = data || {};
          window.alert("تم إصدار قسيمتك بنجاح: " + issued.code + "\nاحتفظ بالرمز. ستظهر القسيمة في قائمة قسائمك.");
          await loadMyRewards();
        } catch (error) {
          window.alert(error?.message || "تعذر إصدار القسيمة. لم يتم تأكيد الاستبدال.");
          redeem.disabled = false;
          redeem.textContent = "استبدال 1,000 نقطة بقسيمة 1$";
        }
      });
      catalog.append(redeem);
      catalog.append(node("p", "small", "القسائم الصادرة قابلة للاستخدام في طلبات BARO المؤهلة فقط. قد يرفض الخادم القسيمة لبعض الباقات إذا كانت تكلفة المورد أو هامش الربح لا يسمحان بخصم آمن."));
      if (balance < 1000) catalog.append(node("p", "small", "تحتاج إلى " + (1000-balance).toLocaleString("en-US") + " نقطة إضافية لبلوغ الحد الأدنى."));

      const couponsHeading = node("h3", "", "قسائمي");
      catalog.append(couponsHeading);
      const coupons = couponsResult.data || [];
      if (!coupons.length) catalog.append(node("p", "small", "ما عندك قسائم صادرة حالياً."));
      coupons.forEach(coupon => {
        const card = node("article", "ops-item");
        const row = node("div", "ops-actions");
        const code = node("strong", "", coupon.code);
        code.dir = "ltr";
        const copy = node("button", "secondary", "نسخ الرمز");
        copy.type = "button";
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(coupon.code); copy.textContent = "تم النسخ"; }
          catch (_) { window.prompt("انسخ رمز القسيمة:", coupon.code); }
        });
        row.append(code, copy);
        card.append(row,
          node("p", "small", "خصم: $" + Number(coupon.discount_amount_usd).toFixed(2)),
          node("p", "small", "الحالة: " + (statusLabels[coupon.status] || coupon.status)),
          node("p", "small", "تاريخ الإصدار: " + new Date(coupon.created_at).toLocaleString("ar"))
        );
        catalog.append(card);
      });

      historyBox.replaceChildren();
      const rows = historyResult.data || [];
      if (!rows.length) historyBox.append(node("p", "small", "لا يوجد سجل نقاط بعد."));
      rows.forEach(item => {
        const card = node("article", "ops-item");
        const positive = item.transaction_type === "earn";
        card.append(
          node("strong", "", (positive ? "+" : "−") + Number(item.points).toLocaleString("en-US") + " نقطة"),
          node("p", "small", item.description || "حركة نقاط"),
          node("time", "small", new Date(item.created_at).toLocaleString("ar"))
        );
        historyBox.append(card);
      });
    } catch (error) {
      console.error("Baran loyalty load failed", error);
      tierBox.textContent = "تعذر تحميل بيانات الولاء حالياً.";
      balanceBox.textContent = "حاول تحديث الصفحة بعد قليل.";
      catalog.replaceChildren(node("p", "small", error?.message || "تعذر تحميل القسائم."));
      historyBox.textContent = "تعذر تحميل سجل النقاط.";
    }
  }

  window.loadMyRewards = loadMyRewards;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.getElementById("rewards") && !document.getElementById("rewards").classList.contains("hidden")) void loadMyRewards();
    });
  }
})();
