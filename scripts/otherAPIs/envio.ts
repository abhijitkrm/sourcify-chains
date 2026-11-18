/** `fetchContractCreationTxUsing.hyperSyncApi` in the output format. */
export interface HyperSyncApi {
  /** Chain endpoint. The server sends its queries to `${url}/query`. */
  url: string;
  /** Trace endpoint. Only some chains have one. */
  tracesUrl?: string;
}

const ENVIO_ACTIVE_CHAINS_URL = "https://chains.hyperquery.xyz/active_chains";
const TRACES_SUFFIX = "-traces";

/** Removes trailing slashes. The server appends a path to the URL. */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Returns a hyperSyncApi entry whose URLs have no trailing slash.
 * Used for manual entries from chain-overrides.json.
 */
export function normalizeHyperSyncApi(api: HyperSyncApi): HyperSyncApi {
  return {
    ...api,
    url: stripTrailingSlashes(api.url),
    ...(api.tracesUrl ? { tracesUrl: stripTrailingSlashes(api.tracesUrl) } : {}),
  };
}

/**
 * Parses the Envio `active_chains` response into hyperSyncApi entries.
 *
 * - Only `ecosystem: "evm"` entries are used.
 * - An entry whose name ends with `-traces` is the trace endpoint of its chain
 *   id. It sets `tracesUrl` and is not a chain endpoint.
 * - Each other entry sets `url` to the numeric alias
 *   `https://<chainId>.hypersync.xyz`.
 * - A trace endpoint without a chain endpoint gives no entry.
 * - Chains in `ignoredChainIds` give no entry.
 *
 * When a chain id appears more than once, the first occurrence wins.
 */
export function parseEnvioActiveChains(
  data: unknown,
  ignoredChainIds: ReadonlySet<number> = new Set(),
): Map<number, HyperSyncApi> {
  if (!Array.isArray(data)) {
    throw new Error("Envio active_chains response is not an array");
  }

  const chainIds = new Set<number>();
  const tracesUrls = new Map<number, string>();

  for (const entry of data as Array<Record<string, unknown> | null>) {
    if (entry?.ecosystem !== "evm") continue;
    const chainId = entry.chain_id;
    if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) continue;
    if (ignoredChainIds.has(chainId)) continue;

    const name = entry.name;
    if (typeof name === "string" && name.endsWith(TRACES_SUFFIX)) {
      // The name becomes a host name. Accept only one DNS label.
      if (/^[a-z0-9-]+$/.test(name) && !tracesUrls.has(chainId)) {
        tracesUrls.set(chainId, `https://${name}.hypersync.xyz`);
      }
      continue;
    }
    chainIds.add(chainId);
  }

  const result = new Map<number, HyperSyncApi>();
  for (const chainId of chainIds) {
    const tracesUrl = tracesUrls.get(chainId);
    result.set(chainId, {
      url: `https://${chainId}.hypersync.xyz`,
      ...(tracesUrl ? { tracesUrl } : {}),
    });
  }
  return result;
}

/**
 * Fetches the chains that Envio HyperSync serves.
 * Used to auto-set fetchContractCreationTxUsing.hyperSyncApi.
 *
 * Throws if the request fails or the response is not a list.
 */
export async function fetchEnvioChains(
  ignoredChainIds: ReadonlySet<number> = new Set(),
): Promise<Map<number, HyperSyncApi>> {
  const response = await fetch(ENVIO_ACTIVE_CHAINS_URL, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Envio active_chains API returned ${response.status}: ${await response.text()}`,
    );
  }

  return parseEnvioActiveChains(await response.json(), ignoredChainIds);
}
