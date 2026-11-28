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

test("wallet calculator uses approved preview values and shows USD plus new SYP", () => {
  assert.match(walletFlow, /unitUsd:1\.04545/);
  assert.match(walletFlow, /unitSyp:163\.6861065/);
  assert.match(walletFlow, /unitUsd:1\.03515/);
  assert.match(walletFlow, /unitSyp:162\.0734355/);
  assert.match(walletFlow, /unitUsd:1\.0506/);
  assert.match(walletFlow, /unitSyp:164\.492442/);
  assert.match(walletFlow, /amount\*current\.unitUsd/);
  assert.match(walletFlow, /amount\*current\.unitSyp/);
  assert.match(walletFlow, /الليرة السورية الجديدة/);
});

test("wallet purchase remains disabled and cannot create or charge an order", () => {
  assert.match(walletFlow, /disabled\.disabled=true/);
  assert.match(walletFlow, /الشراء قريباً — غير متاح حالياً/);
  assert.doesNotMatch(walletFlow, /create_order|createOrder|wallet_transactions|baran_order_gateway/i);
});

test("wallet supplier unit costs are hidden from customer-facing wallet cards", () => {
  assert.match(html, /if\(!isWalletCategory\)card\.append\(price\)/);
  assert.match(html, /!\(\/محافظ\|wallet\/i\.test\(String\(category\|\|""\)\)\)/);
});

test("fixed quote gateway declares the player ID before the quote branch uses it", () => {
  const declaration = gateway.indexOf("const requestPlayerId =");
  const quoteBranch = gateway.indexOf('body?.action === "homscard_fixed_quote"');
  assert.ok(declaration >= 0 && quoteBranch > declaration);
  assert.match(gateway, /requestPlayerId\.length < 2/);
});
