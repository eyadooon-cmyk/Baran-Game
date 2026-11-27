import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261127000200_homscard_fixed_order_lifecycle.sql", import.meta.url), "utf8");

// Isolated in-memory transaction model. It deliberately has no Supabase client,
// credentials, network calls, supplier adapter, or production wallet access.
function fixture() {
  return {
    wallet: { USD: 100, SYP: 10000 },
    orders: [],
    ledger: [],
    queue: [],
    requests: new Map(),
  };
}

function simulateFixedOrder(state, input, gates = {}) {
  const before = structuredClone(state);
  try {
    if (!input || input.quantity !== 1 || input.catalogGroup !== "homscard_fixed") {
      throw new Error("fixed product only");
    }
    const prior = state.requests.get(input.requestId);
    if (prior) {
      if (prior.productCode !== input.productCode ||
          prior.playerId !== input.playerId ||
          prior.currency !== input.currency) {
        throw new Error("request id reused with different payload");
      }
      return { duplicate: true, orderId: prior.orderId };
    }
    if (gates.integrationEnabled !== true ||
        gates.executionEnabled !== true ||
        gates.connectionStatus !== "ready") {
      throw new Error("supplier execution disabled");
    }

    const order = {
      orderId: "sim-" + (state.orders.length + 1),
      productCode: input.productCode,
      playerId: input.playerId,
      quantity: 1,
      currency: input.currency,
      amount: input.amount,
      supplier: "HomsCard",
    };
    state.orders.push(order);

    if (!Number.isFinite(input.amount) || input.amount <= 0 ||
        state.wallet[input.currency] < input.amount) {
      throw new Error("insufficient balance");
    }
    state.wallet[input.currency] -= input.amount;
    state.ledger.push({ orderId: order.orderId, amount: input.amount, currency: input.currency });

    // Simulates the server-side supplier preparation result; never calls HomsCard.
    if (gates.preparedSupplier !== "HomsCard" || gates.queued !== true) {
      throw new Error("supplier mismatch or queue failure");
    }
    state.queue.push({ orderId: order.orderId, supplier: "HomsCard" });
    state.requests.set(input.requestId, {
      orderId: order.orderId,
      productCode: input.productCode,
      playerId: input.playerId,
      currency: input.currency,
    });
    return { duplicate: false, orderId: order.orderId };
  } catch (error) {
    // PostgreSQL transaction semantics: restore every touched collection/value.
    Object.keys(state).forEach((key) => { state[key] = before[key]; });
    throw error;
  }
}

const valid = (overrides = {}) => ({
  requestId: "req-001",
  productCode: "PUBGM_60",
  playerId: "123456789",
  quantity: 1,
  catalogGroup: "homscard_fixed",
  currency: "USD",
  amount: 12,
  ...overrides,
});
const enabled = { integrationEnabled: true, executionEnabled: true, connectionStatus: "ready", preparedSupplier: "HomsCard", queued: true };

test("disabled supplier gate creates no order and makes no wallet or ledger change", () => {
  const s = fixture();
  const before = structuredClone(s);
  assert.throws(() => simulateFixedOrder(s, valid(), { ...enabled, executionEnabled: false }), /disabled/);
  assert.deepEqual(s, before);
});

test("insufficient balance rolls back order, debit, ledger, queue and idempotency key", () => {
  const s = fixture();
  const before = structuredClone(s);
  assert.throws(() => simulateFixedOrder(s, valid({ amount: 101 }), enabled), /insufficient balance/);
  assert.deepEqual(s, before);
});

test("supplier identity mismatch rolls back the complete transaction", () => {
  const s = fixture();
  const before = structuredClone(s);
  assert.throws(() => simulateFixedOrder(s, valid(), { ...enabled, preparedSupplier: "OtherSupplier" }), /supplier mismatch/);
  assert.deepEqual(s, before);
});

test("successful fixed order debits once and writes one ledger and queue record", () => {
  const s = fixture();
  const result = simulateFixedOrder(s, valid(), enabled);
  assert.equal(result.duplicate, false);
  assert.equal(s.wallet.USD, 88);
  assert.equal(s.orders.length, 1);
  assert.equal(s.ledger.length, 1);
  assert.equal(s.queue.length, 1);
  assert.equal(s.ledger[0].amount, 12);
});

test("repeating the identical request is idempotent and does not debit twice", () => {
  const s = fixture();
  const first = simulateFixedOrder(s, valid(), enabled);
  const second = simulateFixedOrder(s, valid(), enabled);
  assert.equal(second.duplicate, true);
  assert.equal(second.orderId, first.orderId);
  assert.equal(s.wallet.USD, 88);
  assert.equal(s.orders.length, 1);
  assert.equal(s.ledger.length, 1);
  assert.equal(s.queue.length, 1);
});

test("reusing a request id for different player or product is rejected without mutation", () => {
  const s = fixture();
  simulateFixedOrder(s, valid(), enabled);
  const before = structuredClone(s);
  assert.throws(() => simulateFixedOrder(s, valid({ playerId: "different-player" }), enabled), /different payload/);
  assert.deepEqual(s, before);
});

test("variable catalog and quantities cannot enter the fixed transaction model", () => {
  const s = fixture();
  assert.throws(() => simulateFixedOrder(s, valid({ catalogGroup: "homscard_variable" }), enabled), /fixed product only/);
  assert.throws(() => simulateFixedOrder(s, valid({ quantity: 50 }), enabled), /fixed product only/);
  assert.equal(s.orders.length, 0);
});

test("fixed-order RPC validates supplier SKU and supplier attempt UUID before commit", () => {
  const skuCheck = migration.indexOf("translate(v_mapping.supplier_sku, '0123456789', '') <> ''");
  const orderInsert = migration.indexOf("insert into public.orders");
  const attemptCheck = migration.indexOf("if v_attempt_id is null or v_supplier_uuid is null");
  const returnObject = migration.indexOf("return jsonb_build_object('success',true,'duplicate',false");
  assert.ok(skuCheck >= 0 && skuCheck < orderInsert, "supplier SKU must be validated before financial writes");
  assert.ok(attemptCheck >= 0 && returnObject > attemptCheck, "attempt id and UUID must be validated before returning/committing");
});

test("production RPC keeps execution server-only and checks supplier gate before order insert", () => {
  assert.match(migration, /revoke all on function public\.baran_create_homscard_fixed_order[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.baran_create_homscard_fixed_order[\s\S]*to service_role/i);
  const gate = migration.indexOf("not v_config.integration_enabled");
  const orderInsert = migration.indexOf("insert into public.orders");
  assert.ok(gate >= 0 && orderInsert > gate, "supplier gate must precede order insertion and wallet debit");
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /client_request_id/);
});
