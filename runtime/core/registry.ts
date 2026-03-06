import type { ComponentType } from "react"
import type { Catalog } from "./catalog"

export interface RegistryComponent {
  component: ComponentType<{
    props: Record<string, unknown>
    children?: React.ReactNode
  }>
}

export type Registry = Record<string, RegistryComponent>

/**
 * Define a registry mapping catalog component names to React implementations.
 * The registry is used by the renderer to look up components at render time.
 */
export function defineRegistry(
  catalog: Catalog,
  implementations: Record<
    string,
    ComponentType<{ props: Record<string, unknown>; children?: React.ReactNode }>
  >,
): Registry {
  const registry: Registry = {}

  for (const name of Object.keys(catalog.components)) {
    if (!(name in implementations)) {
      console.warn(`Catalog component "${name}" has no registry implementation`)
      continue
    }
    registry[name] = { component: implementations[name] }
  }

  return registry
}
