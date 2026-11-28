import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const gateway = await readFile(new URL("../supabase/functions/baran-order-gateway/index.ts", import.meta.url), "utf8");
const walletFlow = html.match(/<script id="baran-wallet-two-step-logic-20261128">([\s\S]*?)<\/script>/)?.[1] ?? "";

test("wallet receipt flow keeps the requested field order", () => {
  const fields = [
    "current.field",
    "رقم الحوالة / رمز التحويل",
    "صورة إيصال التحويل",
    "مبلغ الشحن بالدولار",
    "function refreshReview()",
  ];
  let previous = -1;
  for (const field of fields) {
    const index = walletFlow.indexOf(field);
    assert.ok(index > previous, `wallet field order missing or incorrect: ${field}`);
    previous = index;
  }
});

test("wallet flow previews receipt locally and does not upload it", () => {
  assert.match(walletFlow, /URL\.createObjectURL\(file\)/);
  assert.match(walletFlow, /URL\.revokeObjectURL/);
  assert.match(walletFlow, /معاينة محلية فقط/);
  assert.doesNotMatch(walletFlow, /\.storage\.from\(|\.upload\(|functions\.invoke\(/);
});

test("wallet calculator applies supplier unit pricing and the selected currency", () => {
  assert.ok(walletFlow.includes("baranWalletCurrency"));
  assert.ok(walletFlow.includes("دولار أمريكي (USD)"));
  assert.ok(walletFlow.includes("ليرة سورية جديدة (SYP)"));
  assert.ok(walletFlow.includes('currency==="SYP"?current.marketRateNew:1'));
  assert.ok(walletFlow.includes('const nominalUsd=valid?(currency==="USD"?amount:Math.round(amount/current.marketRateNew)):0'));
  assert.ok(walletFlow.includes("const totalUsd=nominalUsd*current.saleUnitUsd"));
  assert.ok(walletFlow.includes("const totalSyp=nominalUsd*current.saleUnitSyp"));
  assert.ok(walletFlow.includes("المبلغ التقديري للخصم"));
  assert.ok(walletFlow.includes("سعر البيع لكل 1 USD"));
  assert.doesNotMatch(walletFlow, /156\.6|const total=amount/);
  assert.ok(walletFlow.includes("HOMSCARD_WALLET_USDT_BEP20"));
  assert.ok(walletFlow.includes("HOMSCARD_WALLET_WHISH_MONEY"));
  assert.ok(walletFlow.includes("HOMSCARD_WALLET_SHAM_CASH"));
});


test("USDT BEP20 does not ask for a transfer receipt image", () => {
  assert.match(walletFlow, /if\(current!==cfg\.usdt&&current!==cfg\.whish\)\{[\s\S]*?رقم الحوالة \/ رمز التحويل/);
  assert.match(walletFlow, /if\(current!==cfg\.usdt&&current!==cfg\.whish\)\{[\s\S]*?صورة إيصال التحويل/);
  assert.match(walletFlow, /current===cfg\.usdt\|\|current===cfg\.whish\?\[\]:\[\["رمز التحويل"/);
  assert.match(walletFlow, /الشراء قريباً — غير متاح حالياً/);
});

test("wallet purchase remains disabled and cannot create or charge an order", () => {
  assert.match(walletFlow, /disabled\.disabled=true/);
  assert.match(walletFlow, /الشراء قريباً — غير متاح حالياً/);
  assert.doesNotMatch(walletFlow, /create_order|createOrder|wallet_transactions|baran_order_gateway/i);
});

test("wallet supplier unit costs are hidden from customer-facing wallet cards", () => {
  assert.match(html, /if\(!isWalletCategory\)card\.append\(price\)/);
  assert.match(html, /const isWalletCategory=\/محافظ\|wallet\/i\.test/);
  assert.ok(html.includes('const isWalletCategory=/محافظ|wallet/i.test(String(categoryLabel||""));'));
  assert.ok(html.includes("if(!isWalletCategory)panel.append(price)"));
});

test("fixed quote gateway declares the player ID before the quote branch uses it", () => {
  const declaration = gateway.indexOf("const requestPlayerId =");
  const quoteBranch = gateway.indexOf('body?.action === "homscard_fixed_quote"');
  assert.ok(declaration >= 0 && quoteBranch > declaration);
  assert.match(gateway, /requestPlayerId\.length < 2/);
});

test("Whish Money does not ask for a transfer code or receipt image", () => {
  assert.match(walletFlow, /if\(current!==cfg\.usdt&&current!==cfg\.whish\)\{[\s\S]*?رقم الحوالة \/ رمز التحويل/);
  assert.match(walletFlow, /current===cfg\.usdt\|\|current===cfg\.whish\?\[\]:\[\["رمز التحويل"/);
  assert.match(walletFlow, /field:"رقم محفظة Whish Money"/);
  assert.match(walletFlow, /الشراء قريباً — غير متاح حالياً/);
});
