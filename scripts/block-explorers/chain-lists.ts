/**
 * The chain lists of the block explorers, stored for the Sourcify server.
 *
 * The server submits verified contracts to Etherscan, Blockscout and
 * Routescan, and it needs the chain list of each explorer for that. It reads
 * the copies that this repository keeps in `explorer-chain-lists/`, not the
 * endpoints of the explorers: a broken explorer endpoint must not affect the
 * server (argotorg/sourcify#3081).
 *
 * A stored list has the shape of the explorer's response, reduced to the
 * fields that the server reads, plus the chain name for review. The entries
 * are sorted by chain ID, so a change of the list gives a small diff.
 *
 * Each function throws when the response does not have the expected shape or
 * has no usable entry. The generation then stops and the stored list stays as
 * it is.
 */

import fs from "fs";
import path from "path";

export interface StoredEtherscanList {
  result: {
    chainname?: string;
    chainid: string;
    blockexplorer?: string;
    apiurl?: string;
    status?: number;
  }[];
}

export type StoredBlockscoutList = Record<
  string,
  {
    name?: string;
    explorers: { url?: string; hostedBy?: string }[];
  }
>;

export interface StoredRoutescanList {
  items: {
    name?: string;
    chainId?: string | number;
    evmChainId?: string | number;
  }[];
}

export interface ExplorerChainLists {
  etherscan?: StoredEtherscanList;
  blockscout?: StoredBlockscoutList;
  routescanMainnet?: StoredRoutescanList;
  routescanTestnet?: StoredRoutescanList;
}

/** The file of each list inside the `explorer-chain-lists` directory. */
export const EXPLORER_CHAIN_LIST_FILES: Record<keyof ExplorerChainLists, string> = {
  etherscan: "etherscan.json",
  blockscout: "blockscout.json",
  routescanMainnet: "routescan-mainnet.json",
  routescanTestnet: "routescan-testnet.json",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function idOrUndefined(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

/** Reduces the response of the Etherscan chainlist API. */
export function toStoredEtherscanList(data: unknown): StoredEtherscanList {
  if (!isObject(data) || !Array.isArray(data.result)) {
    throw new Error("Etherscan chain list has no result array");
  }

  const result: StoredEtherscanList["result"] = [];
  for (const entry of data.result) {
    if (!isObject(entry) || typeof entry.chainid !== "string") continue;
    result.push({
      chainname: stringOrUndefined(entry.chainname),
      chainid: entry.chainid,
      blockexplorer: stringOrUndefined(entry.blockexplorer),
      apiurl: stringOrUndefined(entry.apiurl),
      status: typeof entry.status === "number" ? entry.status : undefined,
    });
  }

  // The server uses an entry only when it is active and has both URLs
  if (!result.some((entry) => entry.status === 1 && entry.apiurl && entry.blockexplorer)) {
    throw new Error("Etherscan chain list has no usable entry");
  }

  result.sort((a, b) => Number(a.chainid) - Number(b.chainid));
  return { result };
}

/**
 * Reduces the response of the Blockscout chains API. The response keys are
 * chain IDs. Keys that are not chain IDs (for example "1__") are left out:
 * the server looks up a list by chain ID, so it never reads them.
 */
export function toStoredBlockscoutList(data: unknown): StoredBlockscoutList {
  if (!isObject(data)) {
    throw new Error("Blockscout chain list is not an object");
  }

  const chainIds = Object.keys(data)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b));

  const result: StoredBlockscoutList = {};
  for (const chainId of chainIds) {
    const entry = data[chainId];
    if (!isObject(entry)) continue;
    const explorers = Array.isArray(entry.explorers) ? entry.explorers : [];
    result[chainId] = {
      name: stringOrUndefined(entry.name),
      explorers: explorers.filter(isObject).map((explorer) => ({
        url: stringOrUndefined(explorer.url),
        hostedBy: stringOrUndefined(explorer.hostedBy),
      })),
    };
  }

  if (!Object.values(result).some((entry) => entry.explorers.some((explorer) => explorer.url))) {
    throw new Error("Blockscout chain list has no usable entry");
  }

  return result;
}

/** Reduces the response of a Routescan blockchains API (mainnet or testnet). */
export function toStoredRoutescanList(data: unknown): StoredRoutescanList {
  if (!isObject(data) || !Array.isArray(data.items)) {
    throw new Error("Routescan chain list has no items array");
  }

  const items: StoredRoutescanList["items"] = [];
  for (const item of data.items) {
    if (!isObject(item)) continue;
    items.push({
      name: stringOrUndefined(item.name),
      chainId: idOrUndefined(item.chainId),
      evmChainId: idOrUndefined(item.evmChainId),
    });
  }

  // The server uses an item only when it has both IDs
  if (!items.some((item) => item.chainId !== undefined && item.evmChainId !== undefined)) {
    throw new Error("Routescan chain list has no usable entry");
  }

  items.sort(
    (a, b) =>
      Number(a.evmChainId) - Number(b.evmChainId) ||
      String(a.chainId).localeCompare(String(b.chainId)),
  );
  return { items };
}

/**
 * Writes the four lists to `dir`. All of them must be present: a run that
 * could not download a list must stop before it replaces any stored list.
 */
export function writeExplorerChainLists(dir: string, lists: ExplorerChainLists): void {
  const names = Object.keys(EXPLORER_CHAIN_LIST_FILES) as (keyof ExplorerChainLists)[];
  const missing = names.filter((name) => lists[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Explorer chain lists are missing: ${missing.join(", ")}`);
  }

  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(
      path.join(dir, EXPLORER_CHAIN_LIST_FILES[name]),
      JSON.stringify(lists[name], null, 2) + "\n",
    );
  }
}
