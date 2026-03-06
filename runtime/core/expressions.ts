/**
 * Resolve $-expressions in element props against the spec state.
 *
 * V1: Only supports { $state: "/json/pointer/path" }
 * Future: $cond, $template, $computed
 */
export function resolveExpressions(
  props: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    resolved[key] = resolveValue(value, state)
  }
  return resolved
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function resolveValue(value: unknown, state: Record<string, unknown>): unknown {
  if (value == null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, state))

  if (!isRecord(value)) return value

  // $state expression: read from state by JSON Pointer path
  if ("$state" in value && typeof value.$state === "string") {
    return getByPointer(state, value.$state)
  }

  // Recurse into nested objects
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    result[k] = resolveValue(v, state)
  }
  return result
}

function getByPointer(obj: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return obj
  const parts = pointer.split("/").slice(1)
  let current: unknown = obj
  for (const part of parts) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}
