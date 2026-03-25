import node_machine_id from "node-machine-id";

let _uniqueId: string | undefined;

/**
 * Returns a unique identifier for the current user/machine: `TNT_USER_ID` when
 * it is set, and the machine ID otherwise. The retired `CONTINUE_USER_ID` is not
 * read - an identity that depended on which of two variables a shell happened to
 * export would attribute one install as two users.
 */
export function getUniqueId(): string {
  if (!_uniqueId) {
    _uniqueId = process.env.TNT_USER_ID ?? node_machine_id.machineIdSync();
  }
  return _uniqueId;
}
