import test from "node:test";
import assert from "node:assert/strict";
import { buildCheckPath, parseHomsCardCheck, retryDelaySeconds, normalizeHomsCardCreate, homscardConfirmedRejection } from "../supabase/functions/baran-homscard-reconcile/core.mjs";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../supabase/functions/baran-homscard-reconcile/index.ts", import.meta.url), "utf8");
const attemptMigration = await readFile(new URL("../supabase/migrations/20261127200000_homscard_reconcile_attempt_rpc.sql", import.meta.url), "utf8");
const schedulerMigration = await readFile(new URL("../supabase/migrations/20261127210000_homscard_reconcile_scheduler.sql", import.meta.url), "utf8");
const settlementMigration = await readFile(new URL("../supabase/migrations/20261127190000_homscard_settlement_after_disable.sql", import.meta.url), "utf8");

const uuid = "ecbdd545-e616-4aee-8770-7eefa977bcd1";

test("order.php object response is normalized separately from check.php array response", () => {
  const normalized = normalizeHomsCardCreate({status:"OK",data:{
    order_id:"HC-CREATE-1",status:"completed",price:"4.50000001",quantity:3,delivery:"Delivered"
  }},uuid,3);
  assert.deepEqual(normalized,{status:"OK",data:[{
    order_uuid:uuid,order_id:"HC-CREATE-1",status:"completed",price:4.50000001,quantity:3,delivery:"Delivered"
  }]});
  assert.equal(normalizeHomsCardCreate({status:"OK",data:[{order_id:"HC-1"}]},uuid,1),null);
  assert.equal(normalizeHomsCardCreate({status:"OK",data:{
    order_id:"HC-1",status:"completed",price:"1",quantity:2,delivery:"X"
  }},uuid,1),null);
  assert.equal(normalizeHomsCardCreate({status:"OK",data:{
    order_id:"HC-1",status:"completed",price:"1",quantity:1,delivery:""
  }},uuid,1),null);
});

test("only documented definitive rejection codes are classified as failed", () => {
  for (const code of [100,103,109,110,112,113,114]) assert.equal(homscardConfirmedRejection(code),true);
  for (const code of [102,120,121,128,129,500,0]) assert.equal(homscardConfirmedRejection(code),false);
});

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


test("settlement keeps unknown outcomes pending and refunds only confirmed supplier cancellation", () => {
  const unknownStart = settlementMigration.indexOf("if p_result='unknown' then");
  const failedStart = settlementMigration.indexOf("elsif p_result='failed' then");
  const successStart = settlementMigration.indexOf("else\n    if p_supplier_reference", failedStart);
  assert.ok(unknownStart >= 0 && failedStart > unknownStart && successStart > failedStart);
  const unknownBranch = settlementMigration.slice(unknownStart, failedStart);
  const failedBranch = settlementMigration.slice(failedStart, successStart);
  assert.doesNotMatch(unknownBranch, /baran_refund_failed_supplier_order/);
  assert.match(unknownBranch, /dispatch_state='awaiting_result'/);
  assert.match(unknownBranch, /refunded',false/);
  assert.match(failedBranch, /baran_refund_failed_supplier_order/);
  assert.match(settlementMigration, /v_attempt_status='succeeded' and p_result<>'succeeded'/);
  assert.match(settlementMigration, /v_f\.refund_status='completed' or v_f\.dispatch_state='refunded'/);
  assert.match(settlementMigration, /if v_f\.refund_status='completed' or v_f\.dispatch_state='refunded' then[\s\S]*'refunded'/);
  assert.match(settlementMigration, /v_attempt_status='succeeded' and p_result<>'succeeded'/);
  assert.doesNotMatch(settlementMigration, /integration_enabled|execution_enabled/);
  assert.match(settlementMigration, /grant execute[\s\S]*to service_role/i);
});


const gateway = await readFile(new URL("../supabase/functions/baran-order-gateway/index.ts", import.meta.url), "utf8");

test("direct checkout and manual polling share strict UUID/status validation", () => {
  assert.match(gateway, /parseHomsCardCheck\(\{status:payload\?\.status,data:rows\},supplierUuid\)/);
  assert.match(gateway, /parseHomsCardCheck\(checked\.payload,uuid\)/);
  assert.match(gateway, /parsed\.quantity!==quantity/);
  assert.match(gateway, /parsed\.quantity!==Number\(order\.quantity\)/);
});

test("delivery is persisted before success settlement in both direct and manual paths", () => {
  const direct = gateway.indexOf('const {error:deliveryError}=await admin.from("order_fulfillment")', gateway.indexOf("const settle=async"));
  const directFinalize = gateway.indexOf('p_result:"succeeded"', direct);
  const manual = gateway.indexOf('const {error:deliveryError}=await admin.from("order_fulfillment")', gateway.indexOf('if (body?.action === "homscard_variable_check_order")'));
  const manualFinalize = gateway.indexOf('p_result:"succeeded"', manual);
  assert.ok(direct >= 0 && directFinalize > direct);
  assert.ok(manual >= 0 && manualFinalize > manual);
});

test("late failure cannot overwrite a recorded success and refund remains idempotent", () => {
  assert.match(settlementMigration, /v_attempt_status='succeeded' and p_result<>'succeeded'/);
  assert.match(settlementMigration, /v_f\.refund_status='completed' or v_f\.dispatch_state='refunded'/);
  assert.match(settlementMigration, /duplicate',true,'result','refunded'/);
  assert.match(settlementMigration, /duplicate',true,'result','succeeded'/);
});

test("supplier worker never dispatches orders and retries only status reads", () => {
  assert.doesNotMatch(worker, /\/order\.php/);
  assert.match(worker, /buildCheckPath\(uuid\)/);
  assert.match(worker, /parseHomsCardCheck\(payload, uuid\)/);
  assert.match(worker, /baran_supplier_finalize_order/);
});


test("ambiguous create-order HTTP errors never trigger automatic refunds", () => {
  const createStart = gateway.indexOf('if (body?.action === "homscard_variable_create_order")');
  const checkStart = gateway.indexOf('if (body?.action === "homscard_variable_check_order")', createStart);
  const createBlock = gateway.slice(createStart, checkStart);
  const ambiguousStart = createBlock.indexOf('if(sent.http_status>=500||code===500||code===102)');
  const ambiguousEnd = createBlock.indexOf('}catch(error){', ambiguousStart);
  const ambiguousResponse = createBlock.slice(ambiguousStart, ambiguousEnd);
  assert.ok(ambiguousStart >= 0 && ambiguousEnd > ambiguousStart);
  assert.match(ambiguousResponse, /p_result:"unknown"/);
  assert.doesNotMatch(ambiguousResponse, /p_result:"failed"/);
  assert.match(createBlock, /homscardConfirmedRejection\(code\)/);
  assert.match(createBlock, /دون إعادة إرسال أو استرداد/);
});

test("supplier response parser receives the complete payload and searches exact UUID", () => {
  assert.match(gateway, /Array\.isArray\(payload\?\.data\)\?payload\.data/);
  assert.match(gateway, /settle\(checked\.payload\)/);
  assert.match(gateway, /normalizeHomsCardCreate\(sent\.payload,supplierUuid,quantity\)/);
});


const precisionMigration = await readFile(new URL("../supabase/migrations/20261128010000_homscard_supplier_cost_precision.sql", import.meta.url), "utf8");

test("supplier settlement preserves eight-decimal unit and total cost precision with service-only execution", () => {
  assert.match(precisionMigration, /supplier_unit_cost type numeric\(20,8\)/);
  assert.match(precisionMigration, /supplier_total_cost type numeric\(20,8\)/);
  assert.match(precisionMigration, /v_total_cost:=round\(p_supplier_unit_cost\*v_order\.quantity,8\)/);
  assert.match(precisionMigration, /revoke all on function public\.baran_supplier_finalize_order[\s\S]*from public, anon, authenticated/i);
  assert.match(precisionMigration, /grant execute on function public\.baran_supplier_finalize_order[\s\S]*to service_role/i);
});
