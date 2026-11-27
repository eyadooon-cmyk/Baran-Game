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
