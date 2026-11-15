import type * as acp from "@agentclientprotocol/sdk";

export const TNT_SETUP_AUTH_METHOD_ID = "tnt-setup";

export function authMethodsFor(
  capabilities: acp.ClientCapabilities | undefined,
): acp.AuthMethod[] {
  if (!capabilities?.auth?.terminal) return [];
  return [
    {
      id: TNT_SETUP_AUTH_METHOD_ID,
      name: "Configure TNT",
      description:
        "Open TNT in a terminal to configure a model and credentials",
      type: "terminal",
      args: [],
    },
  ];
}
