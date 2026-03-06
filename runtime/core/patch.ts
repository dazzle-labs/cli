import type { PatchOp } from "./spec"

type SpecObj = Record<string, unknown>

/**
 * Resolve a JSON Pointer (RFC 6901) path against a Spec.
 * Returns [parent, key] for the caller to read or write.
 */
function resolve(obj: SpecObj, path: string): [SpecObj | unknown[], string] {
  const parts = path.split("/").slice(1)
  const key = parts.pop()!
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      throw new Error(`Cannot traverse path: ${path}`)
    }
    current = (current as SpecObj)[part]
  }
  if (current == null || typeof current !== "object") {
    throw new Error(`Cannot resolve parent for path: ${path}`)
  }
  return [current as SpecObj | unknown[], key]
}

function applyOne(obj: SpecObj, op: PatchOp): void {
  const [parent, key] = resolve(obj, op.path)

  switch (op.op) {
    case "add": {
      if (Array.isArray(parent)) {
        if (key === "-") {
          parent.push(op.value)
        } else {
          parent.splice(Number(key), 0, op.value)
        }
        break
      }
      // Guard: agents frequently write { path: "/elements/x/children", value: "childId" }
      // intending to append, but this replaces the array with a string.
      // Auto-correct: if target is an array and value is a primitive, append.
      const existing = parent[key]
      if (Array.isArray(existing) && !Array.isArray(op.value) && typeof op.value !== "object") {
        existing.push(op.value)
      } else {
        parent[key] = op.value
      }
      break
    }
    case "replace":
      (parent as SpecObj)[key] = op.value
      break

    case "remove":
      if (Array.isArray(parent)) {
        parent.splice(Number(key), 1)
      } else {
        delete (parent as SpecObj)[key]
      }
      break
  }
}

/** Apply JSON Patch operations to a Spec. Returns a deep clone with patches applied. */
export function applyPatches<T>(obj: T, patches: PatchOp[]): T {
  const clone = structuredClone(obj)
  for (const patch of patches) {
    applyOne(clone as SpecObj, patch)
  }
  return clone
}
