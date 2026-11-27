import test from "node:test";
import assert from "node:assert/strict";
import { buildCheckPath, parseHomsCardCheck, retryDelaySeconds } from "../supabase/functions/baran-homscard-reconcile/core.mjs";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../supabase/functions/baran-homscard-reconcile/index.ts", import.meta.url), "utf8");
const attemptMigration = await readFile(new URL("../supabase/migrations/20261127200000_homscard_reconcile_attempt_rpc.sql", import.meta.url), "utf8");
const schedulerMigration = await readFile(new URL("../supabase/migrations/20261127210000_homscard_reconcile_scheduler.sql", import.meta.url), "utf8");

const uuid = "ecbdd545-e616-4aee-8770-7eefa977bcd1";

test("completed order requires exact UUID, price, quantity, supplier reference and delivery", () => {
  assert.deepEqual(parseHomsCardCheck({status:"OK",data:[{order_uuid:uuid,status:"completed",order_id:"HC-1",price:"4.50",quantity:1,delivery:"CODE"}]},uuid),
    {kind:"completed",supplierOrderId:"HC-1",totalCost:4.5,quantity:1,delivery:"CODE"});
});

test("cancelled is a confirmed failure; no other terminal labels are guessed", () => {
  assert.equal(parseHomsCardCheck({status:"OK",data:[{order_uuid:uuid,status:"cancelled"}]},uuid).kind,"failed");
  assert.equal(parseHomsCardCheck({status:"OK",data:[{order_uuid:uuid,status:"failed"}]},uuid).kind,"unknown");
});

test("pending remains pending and is never settled", () => {
  assert.equal(parseHomsCardCheck({status:"OK",data:[{order_uuid:uuid,status:"pending"}]},uuid).kind,"pending");
});

test("malformed, missing, mismatched and incomplete responses remain unknown", () => {
  assert.equal(parseHomsCardCheck(null,uuid).kind,"unknown");
  assert.equal(parseHomsCardCheck({status:"ERROR",data:[]},uuid).kind,"unknown");
  assert.equal(parseHomsCardCheck({status:"OK",data:[{order_uuid:"00000000-0000-4000-8000-000000000000",status:"completed"}]},uuid).kind,"unknown");
  assert.equal(parseHomsCardCheck({status:"OK",data:[{order_uuid:uuid,status:"completed",order_id:"HC-2",price:"x",quantity:1,delivery:"X"}]},uuid).kind,"unknown");
  assert.equal(parseHomsCardCheck({status:"OK",data:[{order_uuid:uuid,status:"completed",order_id:"HC-2",price:"1",quantity:1,delivery:null}]},uuid).kind,"unknown");
});

test("retry delays are bounded and respect supplier Retry-After", () => {
  assert.equal(retryDelaySeconds("pending"),30);
  assert.equal(retryDelaySeconds("timeout"),60);
  assert.equal(retryDelaySeconds("rate_limited","120"),120);
  assert.equal(retryDelaySeconds("rate_limited","900"),300);
  assert.equal(retryDelaySeconds("rate_limited","bad"),60);
});

test("check path is read-only and validates UUID", () => {
  assert.equal(buildCheckPath(uuid),"/reseller/check.php?uuid=1&orders="+uuid);
  assert.throws(()=>buildCheckPath("not-a-uuid"),TypeError);
});


test("worker authenticates cron with a Vault-backed signature and reads attempts through a service-only RPC", () => {
  assert.match(worker, /baran_verify_homscard_reconcile_signature/);
  assert.match(worker, /baran_get_homscard_reconcile_attempt/);
  assert.doesNotMatch(worker, /schema\(["']private["']\)/);
  assert.doesNotMatch(worker, /\/order\.php/);
  assert.match(worker, /\.limit\(3\)/);
});

test("private attempt bridge is executable only by service_role", () => {
  assert.match(attemptMigration, /security definer/i);
  assert.match(attemptMigration, /auth\.jwt\(\)->>'role'/);
  assert.match(attemptMigration, /revoke all .* from public, anon, authenticated/i);
  assert.match(attemptMigration, /grant execute .* to service_role/i);
});

test("scheduler signs requests in Vault and schedules only the read-only reconciler", () => {
  assert.match(schedulerMigration, /vault\.create_secret/);
  assert.match(schedulerMigration, /baran_homscard_reconcile_hmac/);
  assert.match(schedulerMigration, /extensions\.hmac/);
  assert.match(schedulerMigration, /baran_verify_homscard_reconcile_signature/);
  assert.match(schedulerMigration, /cron\.schedule/);
  assert.match(schedulerMigration, /baran-homscard-reconcile-every-minute/);
  assert.doesNotMatch(schedulerMigration, /order\.php/);
});
