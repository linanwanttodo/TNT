import node_machine_id from "node-machine-id";

let _uniqueId: string | undefined;

/**
 * Returns a unique identifier for the current user/machine.
 * Uses TNT_USER_ID, then CONTINUE_USER_ID, and only then the machine ID.
 */
export function getUniqueId(): string {
  if (!_uniqueId) {
    // `TNT_USER_ID` wins; `CONTINUE_USER_ID` stays honored because it is an
    // existing contract shared with the IDE side and the upstream ecosystem.
    _uniqueId =
      process.env.TNT_USER_ID ??
      process.env.CONTINUE_USER_ID ??
      node_machine_id.machineIdSync();
  }
  return _uniqueId;
}
