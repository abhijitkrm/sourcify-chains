/** This is the `fetchContractCreationTxUsing.hyperSyncApi` value in the output file. */
export interface HyperSyncApi {
  /** The server sends its queries to `${url}/query`. */
  url: string;
  /** Only some chains have a trace endpoint. */
  tracesUrl?: string;
}

const ENVIO_ACTIVE_CHAINS_URL = "https://chains.hyperquery.xyz/active_chains";
const TRACES_SUFFIX = "-traces";

// The server appends a path to the URL.
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Selects the hyperSyncApi entry of a chain.
 *
 * - A manual entry from chain-overrides.json replaces the Envio entry.
 *   The function removes the trailing slashes from its URLs.
 * - A manual entry without a `url` causes an error.
 * - A falsy manual entry does not disable the Envio entry.
 */
export function resolveHyperSyncApi(
  chainId: number,
  override: HyperSyncApi | undefined,
  envio: HyperSyncApi | undefined,
): HyperSyncApi | undefined {
  if (!override) return envio;
  if (typeof override.url !== "string") {
    throw new Error(`chain-overrides.json: hyperSyncApi of chain ${chainId} has no url`);
  }
  return {
    ...override,
    url: stripTrailingSlashes(override.url),
    ...(override.tracesUrl ? { tracesUrl: stripTrailingSlashes(override.tracesUrl) } : {}),
  };
}

/**
 * Converts the Envio `active_chains` response into hyperSyncApi entries.
 *
 * - The function uses only the `ecosystem: "evm"` entries.
 * - A name that ends with `-traces` identifies the trace endpoint of a chain
 *   id. This entry sets `tracesUrl`. It is not a chain endpoint.
 * - Each other entry sets `url` to the numeric alias
 *   `https://<chainId>.hypersync.xyz`.
 * - A trace endpoint without a chain endpoint gives no entry.
 * - A chain in `ignoredChainIds` gives no entry.
 * - The first entry wins when a chain id occurs more than one time.
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
 * Gets the chains that Envio HyperSync serves.
 * The function throws an error if the request fails or the response is not an array.
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
