import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helper = await readFile(new URL("../baran-homscard-player-name-check.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const fixed = await readFile(new URL("../baran-homscard-fixed-checkout.js", import.meta.url), "utf8");
const variable = await readFile(new URL("../baran-homscard-instant-apps-20261127-v3.js", import.meta.url), "utf8");

test("optional player-name lookup reuses the existing PUBG and Free Fire checkers", () => {
  assert.match(helper, /baran-pubg-check/);
  assert.match(helper, /baran-freefire-check/);
  assert.match(helper, /client\.functions\.invoke\(endpoints\[game\]/);
  assert.match(helper, /data\.player\.username/);
});

test("player-name lookup is optional and does not gate checkout", () => {
  assert.match(helper, /التحقق اختياري/);
  assert.match(helper, /يمكنك متابعة الطلب دون الفحص/);
  assert.doesNotMatch(helper, /purchase\.disabled|quoteButton\.disabled|input\.required\s*=/);
  assert.match(fixed, /BaranPlayerNameCheck\?\.attach/);
  assert.match(variable, /BaranPlayerNameCheck\?\.attach/);
  assert.match(fixed, /purchase\.disabled=true/);
});

test("player checker loads before both HomsCard checkout interfaces", () => {
  const checker = index.indexOf("baran-homscard-player-name-check.js");
  const variableCheckout = index.indexOf("baran-homscard-instant-apps-20261127-v3.js");
  const fixedCheckout = index.indexOf("baran-homscard-fixed-checkout.js");
  assert.ok(checker >= 0 && checker < variableCheckout);
  assert.ok(checker < fixedCheckout);
});


test("Jawaker variable tokens stay inside the Jawaker store and retain precise unit pricing", () => {
  assert.match(variable, /source==="جواكر"\|\|\/jawaker\|جواكر\/i\.test/);
  assert.match(variable, /maximumFractionDigits:8\}\)\+" ل\.س جديدة"/);
  assert.match(variable, /baran_homscard_variable_catalog_v3/);
  assert.match(variable, /host\.hidden=category==="ألعاب"&&!visibleProducts\.length/);
});

test("Extra game cards render verified read-only HomsCard prices", () => {
  const products = readFileSync(new URL("../products.js", import.meta.url), "utf8");
  for (const key of ["yalla-ludo","ludo-club","billiards","whiteout","mobile-legends"]) {
    assert.ok(products.includes('key:"'+key+'"'));
  }
  assert.match(products, /catalog_visible",true/);
  assert.match(products, /أسعار للعرض فقط — الطلب والشحن متوقفان حالياً/);
  assert.match(products, /HOMSCARD_GAME_\(197\|198\|199\|200\)/);
});

test("Jawaker variable orders remain blocked server-side", async () => {
  const gateway = await readFile(new URL("../supabase/functions/baran-order-gateway/index.ts", import.meta.url), "utf8");
  const start = gateway.indexOf('if (body?.action === "homscard_variable_create_order")');
  const end = gateway.indexOf('if (body?.action === "homscard_variable_check_order")', start);
  const block = gateway.slice(start, end);
  assert.match(block, /JAWAKER_TOKENS/);
  assert.match(block, /PRODUCT_NOT_READY/);
  assert.match(block, /charged: false/);
});
