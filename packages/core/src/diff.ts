/** One replacement in the old text's coordinates. */
export interface TextChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/**
 * The single replacement turning `before` into `after`: common prefix and
 * suffix kept, the middle replaced. Enough for an editor to keep the cursor
 * outside the changed region in place and to highlight what changed.
 */
export function diffText(before: string, after: string): TextChange[] {
  if (before === after) return []
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--
    endAfter--
  }
  return [{ from: start, to: endBefore, insert: after.slice(start, endAfter) }]
}
