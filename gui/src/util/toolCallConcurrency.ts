/**
 * Runs tool calls while preserving their original order.
 *
 * Consecutive read-only calls are dispatched together, since they cannot
 * conflict. A call that mutates state runs on its own, so two edits never
 * overlap and clobber each other's file writes.
 */
export async function runToolCallsOrdered<T>(
  calls: T[],
  isReadOnly: (call: T) => boolean,
  run: (call: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  while (index < calls.length) {
    if (!isReadOnly(calls[index])) {
      await run(calls[index]);
      index++;
      continue;
    }

    let end = index;
    while (end < calls.length && isReadOnly(calls[end])) {
      end++;
    }
    await Promise.all(calls.slice(index, end).map(run));
    index = end;
  }
}
