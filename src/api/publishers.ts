import { getApiBaseUrl } from "./resources";
import { getApiKey } from "../services/secureStorage";
import { extractApiErrorMessage } from "../utils/errorLogger";

/** Shape returned by `GET /publishers/me`. */
export interface PublisherProfile {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  createdAt: string;
}

/** Shape returned by `GET /publishers/me/analytics`; amounts have four decimals. */
export interface PublisherAnalytics {
  summary: {
    totalEarned: string;
    currency: string;
    totalSales: number;
    totalResources: number;
    listedResources: number;
    verification: { verified: number; rejected: number; pending: number };
  };
  resources: {
    id: string;
    title: string;
    price: string;
    totalSales: number;
    totalEarned: string;
    recentPayments: { payerAddress: string; amount: string; paidAt: string }[];
  }[];
}

/**
 * Fetches the publisher that owns an API key. Uses the stored key by default;
 * pass `apiKey` to check a new key against the server before storing it.
 */
export async function fetchMe(apiKey?: string): Promise<PublisherProfile> {
  return fetchPublisherData("/publishers/me", "Failed to load publisher profile", apiKey);
}

export async function fetchAnalytics(apiKey?: string): Promise<PublisherAnalytics> {
  return fetchPublisherData("/publishers/me/analytics", "Failed to load publisher analytics", apiKey);
}

async function fetchPublisherData<T>(path: string, fallback: string, apiKey?: string): Promise<T> {
  const key = apiKey ?? (await getApiKey());
  if (!key) {
    throw new Error("No API key configured");
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: { "x-api-key": key },
  });

  if (res.status === 401) {
    throw new Error("Unauthorized: Invalid API key");
  }
  if (!res.ok) {
    const message = await extractApiErrorMessage(res, fallback);
    // Never let a server that echoes the key leak it into the UI.
    throw new Error(message.split(key).join("[redacted]"));
  }

  return res.json();
}
