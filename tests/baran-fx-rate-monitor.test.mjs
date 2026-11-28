import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20261127173000_baran_fx_rate_monitor.sql");
const worker = read("../supabase/functions/baran-fx-rates/index.ts");
const ui = read("../finance-pricing.js");
const index = read("../index.html");

test("FX monitor stores new and old Syrian pound units separately", () => {
  assert.match(migration, /buy_new numeric/);
  assert.match(migration, /sell_new numeric/);
  assert.match(migration, /buy_old numeric/);
  assert.match(migration, /sell_old numeric/);
  assert.match(worker, /const OLD_FACTOR = 100/);
  assert.match(worker, /redenomination_factor\)!==100/);
});

test("FX monitor reads two documented Damascus market providers", () => {
  assert.match(worker, /https:\/\/liraty\.com\/api\/v1\/latest\?city=damascus/);
  assert.match(worker, /https:\/\/lirascope\.syria-cloud\.sy\/api\/v1\/rates\/latest/);
  assert.match(worker, /Promise\.allSettled\(\[liraty\(\),lirascope\(\)\]\)/);
});

test("Provider mismatch or stale data never replaces the last applied rate", () => {
  assert.match(worker, /MAX_AGE = 24 \* 60 \* 60 \* 1000/);
  assert.match(worker, /divergence>2/);
  assert.match(worker, /retained_previous_rate:true/);
  assert.match(worker, /status:"source_disagreement"/);
});

test("Automatic refresh is scheduled conservatively within the free LiraScope monthly quota", () => {
  assert.match(migration, /'0 \*\/6 \* \* \*'/);
  assert.match(migration, /baran-fx-market-rate-refresh/);
  assert.match(worker, /MANUAL_MIN_GAP = 6 \* 60 \* 60 \* 1000/);
  assert.match(worker, /CRON_MIN_GAP = 15 \* 60 \* 1000/);
});

test("The store uses the dealer sell quote to calculate USD acquisition cost", () => {
  assert.match(worker, /average_of_two_provider_sell_quotes/);
  assert.match(worker, /market_exchange_rate:applied/);
  assert.match(worker, /products_changed:false,wallets_changed:false,orders_changed:false/);
});

test("Admin FX monitor UI provides a manual check and shows both sources", () => {
  assert.match(index, /callFxRatesApi/);
  assert.match(ui, /مراقب سعر الصرف السوري التلقائي/);
  assert.match(ui, /financeFxRefresh/);
  assert.match(ui, /Liraty/);
  assert.match(ui, /LiraScope/);
  assert.match(ui, /\/100/);
});

test("Automatic FX refresh only raises the stored market rate and holds decreases", () => {
  assert.match(worker, /\.lt\("market_exchange_rate",applied\)/);
  assert.match(worker, /const candidate=Number\(\(\(a\.sell_old\+b\.sell_old\)\/2\)\.toFixed\(2\)\)/);
  assert.match(worker, /const decreased=candidate<applied/);
  assert.match(worker, /status:nextStatus/);
  assert.match(worker, /nextStatus=decreased\?"rate_decrease_pending":"success"/);
  assert.match(worker, /retained_previous_rate:decreased/);
  assert.match(worker, /candidate_rate_old:candidate/);
  assert.match(worker, /last_error:decreased\?/);
  assert.match(ui, /rate_decrease_pending:/);
});
