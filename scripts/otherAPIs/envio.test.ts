import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchEnvioChains, normalizeHyperSyncApi, parseEnvioActiveChains } from "./envio.js";

// A trimmed-down https://chains.hyperquery.xyz/active_chains response.
const response = [
  { name: "arbitrum", tier: "SILVER", chain_id: 42161, ecosystem: "evm" },
  { name: "base-traces", tier: "BRONZE", chain_id: 8453, ecosystem: "evm" },
  { name: "eth", tier: "GOLD", chain_id: 1, ecosystem: "evm" },
  { name: "eth-traces", tier: "GOLD", chain_id: 1, ecosystem: "evm" },
  { name: "fuel-mainnet", tier: "GOLD", chain_id: 9889, ecosystem: "fuel" },
  { name: "fuel-testnet", tier: "BRONZE", ecosystem: "fuel" },
  { name: "moonbeam", tier: "STONE", chain_id: 1284, ecosystem: "evm" },
  { name: "solana-462h", tier: "TESTNET", ecosystem: "solana" },
];

describe("parseEnvioActiveChains", () => {
  it("builds the URL of a chain from its chain id", () => {
    const chains = parseEnvioActiveChains(response);
    assert.deepEqual(chains.get(42161), { url: "https://42161.hypersync.xyz" });
  });

  it("adds tracesUrl when the chain has a -traces entry", () => {
    const chains = parseEnvioActiveChains(response);
    assert.deepEqual(chains.get(1), {
      url: "https://1.hypersync.xyz",
      tracesUrl: "https://eth-traces.hypersync.xyz",
    });
  });

  it("does not depend on the order of the chain and the -traces entry", () => {
    const chains = parseEnvioActiveChains([...response].reverse());
    assert.deepEqual(chains.get(1), {
      url: "https://1.hypersync.xyz",
      tracesUrl: "https://eth-traces.hypersync.xyz",
    });
  });

  it("ignores a -traces entry without a chain entry", () => {
    const chains = parseEnvioActiveChains(response);
    assert.equal(chains.has(8453), false);
  });

  it("ignores non-EVM entries", () => {
    const chains = parseEnvioActiveChains(response);
    assert.deepEqual([...chains.keys()].sort((a, b) => a - b), [1, 1284, 42161]);
  });

  it("skips the ignored chains", () => {
    const chains = parseEnvioActiveChains(response, new Set([1, 1284]));
    assert.deepEqual([...chains.keys()], [42161]);
  });

  it("ignores entries without a valid chain id or with an unsafe -traces name", () => {
    const chains = parseEnvioActiveChains([
      null,
      { name: "no-id", ecosystem: "evm" },
      { name: "string-id", chain_id: "5", ecosystem: "evm" },
      { name: "zero", chain_id: 0, ecosystem: "evm" },
      { name: "eth", chain_id: 1, ecosystem: "evm" },
      { name: "evil.example/x-traces", chain_id: 1, ecosystem: "evm" },
    ]);
    assert.deepEqual([...chains.entries()], [[1, { url: "https://1.hypersync.xyz" }]]);
  });

  it("rejects a response that is not an array", () => {
    assert.throws(() => parseEnvioActiveChains({ error: "x" }));
    assert.throws(() => parseEnvioActiveChains(null));
  });
});

describe("fetchEnvioChains", () => {
  it("returns the parsed chains and applies the ignore list", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json(response));
    const chains = await fetchEnvioChains(new Set([1284]));
    assert.deepEqual([...chains.keys()].sort((a, b) => a - b), [1, 42161]);
  });

  it("throws on an HTTP error", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("down", { status: 503 }));
    await assert.rejects(fetchEnvioChains(), /Envio active_chains API returned 503: down/);
  });

  it("throws on a network error", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(fetchEnvioChains(), /fetch failed/);
  });

  it("throws on a body that is not a chain list", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: "x" }));
    await assert.rejects(fetchEnvioChains(), /not an array/);
  });
});

describe("normalizeHyperSyncApi", () => {
  it("removes trailing slashes from both URLs", () => {
    assert.deepEqual(
      normalizeHyperSyncApi({ url: "https://1.hypersync.xyz/", tracesUrl: "https://eth-traces.hypersync.xyz//" }),
      { url: "https://1.hypersync.xyz", tracesUrl: "https://eth-traces.hypersync.xyz" },
    );
  });

  it("leaves clean URLs untouched and adds no tracesUrl", () => {
    assert.deepEqual(normalizeHyperSyncApi({ url: "https://10.hypersync.xyz" }), {
      url: "https://10.hypersync.xyz",
    });
  });
});
