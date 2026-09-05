/** Session-only immutable snapshots. One pointer/key gesture produces one entry. */
export function createHistory<T>(limit = 50) {
  const past: T[] = []
  const future: T[] = []
  let grouping = false
  let recorded = false
  const end = () => { grouping = false; recorded = false }
  return {
    begin() { if (!grouping) { grouping = true; recorded = false } },
    end,
    record(before: T) {
      if (!grouping || !recorded) {
        past.push(before)
        if (past.length > limit) past.shift()
      }
      recorded = true
      future.length = 0
    },
    undo(current: T, reciprocal: (current: T, target: T) => T = (value) => value) {
      end()
      const previous = past.pop()
      if (previous) future.push(reciprocal(current, previous))
      return previous
    },
    redo(current: T, reciprocal: (current: T, target: T) => T = (value) => value) {
      end()
      const next = future.pop()
      if (next) past.push(reciprocal(current, next))
      return next
    },
    update(map: (entry: T) => T) {
      past.forEach((entry, i) => { past[i] = map(entry) })
      future.forEach((entry, i) => { future[i] = map(entry) })
    },
    clear() { past.length = 0; future.length = 0; end() },
    flags() { return { canUndo: past.length > 0, canRedo: future.length > 0 } },
  }
}
