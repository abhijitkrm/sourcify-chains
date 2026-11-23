import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  EXPLORER_CHAIN_LIST_FILES,
  toStoredBlockscoutList,
  toStoredEtherscanList,
  toStoredRoutescanList,
  writeExplorerChainLists,
} from "./chain-lists.js";

describe("toStoredEtherscanList", () => {
  const entry = (chainid: string, extra: Record<string, unknown> = {}) => ({
    chainname: `Chain ${chainid}`,
    chainid,
    blockexplorer: `https://explorer-${chainid}.example/`,
    apiurl: `https://api.etherscan.io/v2/api?chainid=${chainid}`,
    status: 1,
    comment: "Free-tier available",
    ...extra,
  });

  it("keeps the fields the server reads and sorts by chain ID", () => {
    const stored = toStoredEtherscanList({
      comments: "List of API endpoints",
      totalcount: 2,
      result: [entry("8453"), entry("1")],
    });
    assert.deepEqual(stored, {
      result: [
        {
          chainname: "Chain 1",
          chainid: "1",
          blockexplorer: "https://explorer-1.example/",
          apiurl: "https://api.etherscan.io/v2/api?chainid=1",
          status: 1,
        },
        {
          chainname: "Chain 8453",
          chainid: "8453",
          blockexplorer: "https://explorer-8453.example/",
          apiurl: "https://api.etherscan.io/v2/api?chainid=8453",
          status: 1,
        },
      ],
    });
  });

  it("keeps entries that are not active, the server filters them", () => {
    const stored = toStoredEtherscanList({ result: [entry("1"), entry("5", { status: 0 })] });
    assert.deepEqual(
      stored.result.map((e) => [e.chainid, e.status]),
      [
        ["1", 1],
        ["5", 0],
      ],
    );
  });

  it("rejects a response without a usable entry", () => {
    assert.throws(() => toStoredEtherscanList({}), /no result array/);
    assert.throws(() => toStoredEtherscanList(null), /no result array/);
    assert.throws(() => toStoredEtherscanList({ result: [] }), /no usable entry/);
    assert.throws(() => toStoredEtherscanList({ result: [entry("1", { status: 0 })] }), /no usable entry/);
  });
});

describe("toStoredBlockscoutList", () => {
  const entry = (url: string, hostedBy = "blockscout") => ({
    name: "Some chain",
    description: "A description that changes often",
    logo: "https://example.com/logo.svg",
    isTestnet: false,
    explorers: [{ url, hostedBy }],
  });

  it("keeps the name and the explorers, sorted by chain ID", () => {
    const stored = toStoredBlockscoutList({
      "8453": entry("https://base.blockscout.com/"),
      "1": entry("https://eth.blockscout.com/"),
      // Above the range in which JavaScript sorts object keys as integers
      "11297108109": entry("https://palm.example/", "self"),
    });
    assert.deepEqual(Object.keys(stored), ["1", "8453", "11297108109"]);
    assert.deepEqual(stored["1"], {
      name: "Some chain",
      explorers: [{ url: "https://eth.blockscout.com/", hostedBy: "blockscout" }],
    });
    assert.equal(stored["11297108109"].explorers[0].hostedBy, "self");
  });

  it("does not change the explorer URL", () => {
    // The server rewrites plain HTTP to HTTPS. The stored list keeps the value of the explorer.
    const stored = toStoredBlockscoutList({ "5042002": entry("http://explorer.testnet.arc.io") });
    assert.equal(stored["5042002"].explorers[0].url, "http://explorer.testnet.arc.io");
  });

  it("leaves out keys that are not chain IDs", () => {
    const stored = toStoredBlockscoutList({
      "1": entry("https://eth.blockscout.com/"),
      "1__": entry("https://eth-2.blockscout.com/"),
      arise: entry("https://arise.example/"),
    });
    assert.deepEqual(Object.keys(stored), ["1"]);
  });

  it("rejects a response without a usable entry", () => {
    assert.throws(() => toStoredBlockscoutList(["1"]), /not an object/);
    assert.throws(() => toStoredBlockscoutList(null), /not an object/);
    assert.throws(() => toStoredBlockscoutList({}), /no usable entry/);
    assert.throws(() => toStoredBlockscoutList({ "1": { name: "x", explorers: [] } }), /no usable entry/);
  });
});

describe("toStoredRoutescanList", () => {
  const item = (chainId: string, extra: Record<string, unknown> = {}) => ({
    name: `Chain ${chainId}`,
    chainId,
    evmChainId: chainId,
    logo: "https://example.com/logo.svg",
    rpcs: ["https://rpc.example"],
    ...extra,
  });

  it("keeps the name and the two chain IDs, sorted by EVM chain ID", () => {
    const stored = toStoredRoutescanList({
      items: [item("43114"), item("1"), item("324")],
      link: {},
    });
    assert.deepEqual(stored, {
      items: [
        { name: "Chain 1", chainId: "1", evmChainId: "1" },
        { name: "Chain 324", chainId: "324", evmChainId: "324" },
        { name: "Chain 43114", chainId: "43114", evmChainId: "43114" },
      ],
    });
  });

  it("keeps the type of the chain IDs", () => {
    const stored = toStoredRoutescanList({ items: [item("1", { chainId: 1, evmChainId: 1 })] });
    assert.deepEqual(stored.items, [{ name: "Chain 1", chainId: 1, evmChainId: 1 }]);
  });

  it("rejects a response without a usable entry", () => {
    assert.throws(() => toStoredRoutescanList({}), /no items array/);
    assert.throws(() => toStoredRoutescanList(null), /no items array/);
    assert.throws(() => toStoredRoutescanList({ items: [] }), /no usable entry/);
    assert.throws(() => toStoredRoutescanList({ items: [{ name: "x" }] }), /no usable entry/);
  });
});

describe("writeExplorerChainLists", () => {
  const lists = {
    etherscan: toStoredEtherscanList({
      result: [
        {
          chainname: "Ethereum Mainnet",
          chainid: "1",
          blockexplorer: "https://etherscan.io/",
          apiurl: "https://api.etherscan.io/v2/api?chainid=1",
          status: 1,
        },
      ],
    }),
    blockscout: toStoredBlockscoutList({
      "1": { name: "Ethereum", explorers: [{ url: "https://eth.blockscout.com/", hostedBy: "blockscout" }] },
    }),
    routescanMainnet: toStoredRoutescanList({ items: [{ name: "Ethereum", chainId: "1", evmChainId: "1" }] }),
    routescanTestnet: toStoredRoutescanList({ items: [{ name: "Sepolia", chainId: "11155111", evmChainId: "11155111" }] }),
  };

  it("writes one file for each list", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explorer-chain-lists-"));
    try {
      writeExplorerChainLists(dir, lists);
      assert.deepEqual(fs.readdirSync(dir).sort(), Object.values(EXPLORER_CHAIN_LIST_FILES).sort());
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "routescan-testnet.json"), "utf8")), lists.routescanTestnet);
      assert.ok(fs.readFileSync(path.join(dir, "etherscan.json"), "utf8").endsWith("}\n"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing when a list is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explorer-chain-lists-"));
    try {
      assert.throws(
        () => writeExplorerChainLists(dir, { ...lists, routescanMainnet: undefined }),
        /missing: routescanMainnet/,
      );
      assert.deepEqual(fs.readdirSync(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
