export type { Spec, UIElement, PatchOp, WSMessage } from "./spec"
export { emptySpec } from "./spec"

export type { TransitionSpec, TimelineEntry, TimelinePlayback, Timeline } from "./timeline"

export { applyPatches } from "./patch"

export { resolveExpressions } from "./expressions"

export type {
  CatalogEntry,
  ValidationIssue,
  ValidationResult,
  Catalog,
} from "./catalog"
export { defineCatalog } from "./catalog"

export type { RegistryComponent, Registry } from "./registry"
export { defineRegistry } from "./registry"
