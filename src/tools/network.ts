import type { ActionType } from "../core/types.js";

/** Simulated network tool — returns mock responses for demonstration */
export function simulateNetworkRequest(
  url: string
): { action: ActionType; description: string; result: string } {
  return {
    action: "network_request",
    description: `Network request to ${url}`,
    result:
      `[Simulated] HTTP GET ${url}\n` +
      `  Status: 200 OK\n` +
      `  Body: { "message": "simulated response" }\n` +
      `\n(This is a simulated response — real network requests not connected)`,
  };
}
