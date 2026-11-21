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
      const [loyaltyResult, tiersResult, historyResult, couponsResult, rewardConfigResult] = await Promise.all([
        sb.from("customer_loyalty").select("points_balance,lifetime_earned").eq("user_id", user.id).maybeSingle(),
        sb.from("loyalty_tiers").select("tier_code,tier_name,min_lifetime_points,badge_emoji,benefits").eq("is_active", true).order("min_lifetime_points", {ascending:true}),
        sb.from("loyalty_transactions").select("points,transaction_type,description,created_at").eq("user_id", user.id).order("created_at", {ascending:false}).limit(30),
        sb.rpc("get_my_loyalty_coupons"),
        Promise.resolve(sb.rpc("get_my_loyalty_reward_config")).catch(error => ({data:null,error}))
      ]);
      if (loyaltyResult.error) throw loyaltyResult.error;
      if (tiersResult.error) throw tiersResult.error;
      if (historyResult.error) throw historyResult.error;
      if (couponsResult.error) throw couponsResult.error;

      const rewardConfig = rewardConfigResult?.data || null;
      const rewardReady = rewardConfig?.program_version === 2
        && Number(rewardConfig?.points_per_coupon) === 1000
        && Number(rewardConfig?.coupon_value_usd) === 1;
      const loyalty = loyaltyResult.data || {points_balance:0,lifetime_earned:0};
      const balance = Number(loyalty.points_balance || 0);
      const earned = Number(loyalty.lifetime_earned || 0);
      const tiers = tiersResult.data || [];
      const tier = tiers.filter(t => earned >= Number(t.min_lifetime_points)).at(-1);
      const nextTier = tiers.find(t => Number(t.min_lifetime_points) > earned);
      tierBox.replaceChildren(
        node("strong", "baran-club-tier-name", (tier?.badge_emoji || "✦") + " " + (tier?.tier_name || "عضو BARAN")),
        node("p", "small baran-club-tier-benefits", tier?.benefits?.join(" · ") || "استمر بالشراء المؤهل لجمع النقاط والارتقاء بمستواك.")
      );
      if (nextTier) {
        const target = Number(nextTier.min_lifetime_points) || 0;
        const progress = Math.max(0, Math.min(100, Math.floor((earned / Math.max(1, target)) * 100)));
        const progressWrap = node("div", "baran-club-tier-progress");
        const progressCopy = node("div", "baran-club-progress-copy",
          "باقي " + Math.max(0, target - earned).toLocaleString("en-US") + " نقطة للوصول إلى " + nextTier.tier_name);
        const track = node("div", "baran-club-progress-track");
        const fill = node("span", "baran-club-progress-fill");
        fill.style.width = progress + "%";
        track.append(fill);
        progressWrap.append(progressCopy, track);
        tierBox.append(progressWrap);
      } else {
        tierBox.append(node("p", "baran-club-max-tier", "وصلت إلى أعلى مستوى عضوية! 👑"));
      }

      balanceBox.replaceChildren(
        node("strong", "baran-club-points-value", balance.toLocaleString("en-US") + " نقطة"),
        node("p", "small", "إجمالي ما جمعته حتى الآن: " + earned.toLocaleString("en-US") + " نقطة")
      );

      catalog.replaceChildren();
      const rewardHeading = node("div", "baran-club-panel-heading");
      rewardHeading.append(node("span", "", "🎁"));
      const rewardHeadingCopy = node("div");
      rewardHeadingCopy.append(
        node("h3", "", "مكافآتك وقسائمك"),
        node("p", "", rewardReady ? "كل 1,000 نقطة تمنحك قسيمة حتى 1$." : "رصيد نقاطك محفوظ. تفعيل الاستبدال الجديد سيظهر هنا بعد اكتمال تحديث النظام.")
      );
      rewardHeading.append(rewardHeadingCopy);
      catalog.append(rewardHeading);
      const rewardNotice = node("div", "baran-club-reward-notice");
      rewardNotice.append(
        node("strong", "", rewardReady ? "كل 1,000 نقطة = قسيمة خصم حتى 1$ 🎁" : "نجهّز لك مكافآت BARAN CLUB الجديدة ✨"),
        node("p", "small", rewardReady
          ? "النقاط منفصلة عن رصيد المحفظة، والقسيمة ليست رصيداً نقدياً. استخدامها متاح لطلبات BARO المؤهلة فقط، بعد تحقق الخادم من هامش الربح."
          : "لن نخصم أي نقطة قبل تفعيل نظام المكافآت الجديد على الخادم. رصيدك الحالي محفوظ بالكامل.")
      );
      catalog.append(rewardNotice);

      const redeem = node("button", "full baran-club-redeem-button",
        !rewardReady ? "الاستبدال الجديد قيد التفعيل" :
        balance < 1000 ? "اجمع " + (1000-balance).toLocaleString("en-US") + " نقطة لاستبدال قسيمة 1$" : "استبدال 1,000 نقطة بقسيمة 1$");
      redeem.type = "button";
      redeem.disabled = !rewardReady || balance < 1000;
      redeem.title = "تُصدر القسيمة بعد تأكيد الخادم، وتُقبل فقط على طلبات BARO المؤهلة التي تسمح أرباحها بالخصم.";
      redeem.addEventListener("click", async () => {
        if (redeem.disabled) return;
        if (!window.confirm("سيتم خصم 1,000 نقطة وإصدار قسيمة خصم حتى 1$. هل تريد المتابعة؟")) return;
        redeem.disabled = true;
        redeem.textContent = "جاري إصدار قسيمتك...";
        try {
          const {data, error} = await sb.rpc("redeem_loyalty_coupon");
          if (error) throw error;
          if (!data?.code || Number(data.discount_amount_usd) !== 1 || Number(data.points_spent) !== 1000)
            throw new Error("لم يؤكد الخادم إصدار قسيمة BARAN CLUB الجديدة؛ لم نعرضها كقسيمة 1$.");
          window.alert("مبروك! صدرت قسيمة BARAN CLUB حتى 1$:\n" + data.code + "\nاحتفظ بالرمز لاستخدامه في طلب BARO مؤهل.");
          await loadMyRewards();
        } catch (error) {
          window.alert(error?.message || "تعذر إصدار القسيمة. لم يتم تأكيد خصم النقاط.");
          redeem.disabled = false;
          redeem.textContent = "إعادة المحاولة لاستبدال 1,000 نقطة";
        }
      });
      catalog.append(redeem);

      const couponsHeading = node("h3", "", "قسائمي");
      catalog.append(couponsHeading);
      const coupons = couponsResult.data || [];
      if (!coupons.length) catalog.append(node("p", "small", "ما عندك قسائم صادرة حالياً."));
      coupons.forEach(coupon => {
        const card = node("article", "baran-club-coupon ops-item");
        const row = node("div", "baran-club-coupon-row ops-actions");
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
          node("p", "small", "خصم: " + (Number(coupon.discount_amount_usd)>=1 ? "حتى $1.00 حسب هامش ربح الباقة" : "$" + Number(coupon.discount_amount_usd).toFixed(2))),
          node("p", "small", "الحالة: " + (statusLabels[coupon.status] || coupon.status)),
          node("p", "small", "تاريخ الإصدار: " + new Date(coupon.created_at).toLocaleString("ar"))
        );
        catalog.append(card);
      });

      historyBox.replaceChildren();
      const rows = historyResult.data || [];
      if (!rows.length) historyBox.append(node("p", "small", "لا يوجد سجل نقاط بعد."));
      rows.forEach(item => {
        const card = node("article", "baran-club-history-item ops-item");
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
