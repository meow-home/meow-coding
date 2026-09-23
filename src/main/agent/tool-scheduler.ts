/**
 * Claude Code-style tool execution: read-only, concurrency-safe calls run in
 * parallel; anything that writes, prompts, or is unknown runs alone, and the
 * model's call order is preserved across batches.
 */
export const MAX_TOOL_CONCURRENCY = 10

export function scheduleBatches<T>(items: readonly T[], parallel: (item: T) => boolean): T[][] {
  const batches: T[][] = []
  for (const item of items) {
    const last = batches[batches.length - 1]
    if (last && parallel(item) && parallel(last[0])) last.push(item)
    else batches.push([item])
  }
  return batches
}

export async function runWithConcurrency(
  tasks: ReadonlyArray<() => Promise<void>>,
  limit = MAX_TOOL_CONCURRENCY
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++
      await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}
