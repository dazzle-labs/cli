import { z } from "zod"
import type { Spec } from "./spec"

export interface CatalogEntry {
  props: z.ZodType
  description?: string
  hasChildren?: boolean
  slots?: string[]
  category?: string
}

/** Validation issue returned by validate() */
export interface ValidationIssue {
  elementKey: string
  type: "unknown_component" | "missing_required_prop" | "invalid_prop" | "unknown_prop"
  message: string
  fix?: { prop: string; defaultValue: unknown }
}

/** Structured validation result */
export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  /** Spec with auto-fixes applied (only if autoFix was requested and there were fixable issues) */
  fixed?: Spec
}

export interface Catalog {
  components: Record<string, CatalogEntry>
  /** Generate a system prompt describing available components and the spec format. */
  prompt(): string
  /** Generate a compact index of component names, descriptions, and categories. */
  index(): string
  /** Generate full schemas for a specific category. */
  categoryDetail(category: string): string
  /** Generate full schema for a specific component. */
  componentDetail(component: string): string
  /** Validate a spec against catalog schemas. */
  validate(spec: Spec, autoFix?: boolean): ValidationResult
}

/**
 * Define a component catalog.
 *
 * The catalog is the agent's design education. It should enable broadcast-quality
 * output by default without scenario-specific guidance.
 *
 * This is the LLM-facing description of what components are available and how
 * to use them well on a 1920x1080 broadcast canvas. The agent reads this at
 * the start of every session via catalogRead.
 */
export function defineCatalog(components: Record<string, CatalogEntry>): Catalog {
  return {
    components,

    prompt() {
      const lines: string[] = [
        "# Available Stream Components",
        "",
        "## Design Principles — 1920×1080 Broadcast Canvas",
        "",
        "**Canvas & Scale:**",
        "The canvas is 1920×1080 (16:9 broadcast). Design for a large screen, not a phone.",
        "- Hero headings: 64–120px (6–11% of viewport height). These should command the frame.",
        "- Subheadings: 36–56px. Body text: 24–36px. Captions/badges: 16–24px.",
        "- Never use font sizes below 16px — they are invisible on broadcast displays.",
        "",
        "**Space Utilization:**",
        "- Fill the frame. Use full-bleed backgrounds (Gradient/Image with width: 100%, height: 100%).",
        "- Avoid maxWidth constraints that box content into a narrow column. The canvas is 1920px wide — use it.",
        "- If content is centered, it should still span at least 60–80% of the frame width.",
        "- Edge-to-edge layouts (Grid, Split) are preferred over centered stacks for multi-element scenes.",
        "",
        "**Composition:**",
        "- Think broadcast/keynote, not web page. Reference: Apple Keynote, ESPN graphics, Bloomberg terminals.",
        "- Every element should feel intentional at scale. If it would not be visible from 10 feet away, make it bigger.",
        "- Use padding (48–80px) instead of maxWidth for breathing room.",
        "",
        "**Color:**",
        "- Each scene should use ONE primary color family with at most 2 accent colors. Do not mix 4–5 different hues in one scene.",
        "- Broadcast color: backgrounds are deep and saturated (not grey). Text is white or near-white. Accent colors are bold and limited. Think CNN red, Bloomberg blue, ESPN yellow — one dominant brand color per segment.",
        "- Avoid web-UI grey palettes (#161b22, #0d1117, #30363d). These read as GitHub dark mode, not broadcast. Use rich darks: deep navy (#0a1628), broadcast black (#101820), or warm dark (#1a1412).",
        "- When in doubt, fewer colors is better. A scene with one bold color and white text always looks more professional than a rainbow.",
        "",
        "**Visual Sizing Rules:**",
        "- Emoji as visual icons: When using emoji as a decorative/hero element (not inline text), set fontSize to at least 80px (standalone hero) or 48px (inside cards/badges). Emoji render at the font-size of their container.",
        "- Minimum element size: No informational element should be smaller than 40px in its smallest dimension on the 1920x1080 canvas.",
        "- Decorative opacity: Never go below 0.5 opacity — it becomes invisible noise on broadcast. Either commit (0.7+) or remove the element.",
        "",
        "**Animation:**",
        "- Use Animate/Stagger for entrance animations. Static scenes feel cheap.",
        "- Keep durations 400–1000ms. Faster = snappy, slower = cinematic.",
        "",
        "---",
        "",
        "## Workflow — Broadcast Delivery",
        "",
        "- After reading this catalog, call sceneSet for your first scene IMMEDIATELY. Do not plan everything upfront.",
        "- Build scenes incrementally with scenePatch. Don't front-load all elements into sceneSet — establish the background and hero element, then patch in supporting elements (lower thirds, data, tickers) one at a time.",
        "- Pacing: aim for a new visual element every 3-5 seconds. Think about what a narrator would say for each beat.",
        "- Use sceneSet only for the first scene and major segment transitions. Use scenePatch for everything else.",
        "",
        "**Broadcast aesthetic — NOT web design:**",
        "- Full-bleed, edge-to-edge. Broadcast fills the frame aggressively. No centered cards with padding and border-radius.",
        "- Use the entire 1920x1080 canvas. Content should span 80%+ of the frame width.",
        "- No visible containers, no card borders, no box shadows. Content floats directly on rich backgrounds.",
        "- This is motion graphics, not a website. Think CNN/ESPN/Apple Keynote, not a dashboard.",
        "",
        "You can compose scenes using sceneSet and scenePatch MCP tools.",
        "A scene is a flat map of elements, each referencing a component by type name.",
        "",
        "## Spec Format",
        '```',
        '{',
        '  "root": "element-key",',
        '  "elements": {',
        '    "element-key": {',
        '      "type": "ComponentName",',
        '      "props": { ... },',
        '      "children": ["child-key-1", "child-key-2"],',
        '      "slot": "main" | "sidebar" | "status" | "lower_third"',
        '    }',
        '  },',
        '  "state": { ... }',
        '}',
        '```',
        "",
        "## Components",
        "",
      ]

      for (const [name, entry] of Object.entries(components)) {
        lines.push(`### ${name}`)
        if (entry.description) lines.push(entry.description)
        if (entry.hasChildren) lines.push("Supports children.")

        if (entry.props instanceof z.ZodObject) {
          const shape = entry.props.shape as Record<string, z.ZodType>
          lines.push("Props:")
          for (const [prop, schema] of Object.entries(shape)) {
            const desc = schema.description ?? ""
            const opt = schema.isOptional() ? " (optional)" : ""
            lines.push(`- ${prop}${opt}: ${desc}`)
          }
        }

        lines.push("")
      }

      lines.push(
        "## State Expressions",
        'Use { "$state": "/path/to/value" } in props to bind to live state.',
        'Update state with stateSet tool using JSON Pointer paths.',
        "",
      )

      return lines.join("\n")
    },

    index() {
      const lines: string[] = [
        "# Component Catalog Index",
        "",
        "Use `catalogRead` with `detail: \"full\"` and `category` or `component` to see full schemas.",
        "",
      ]

      // Group by category
      const groups = new Map<string, [string, CatalogEntry][]>()
      const uncategorized: [string, CatalogEntry][] = []
      for (const [name, entry] of Object.entries(components)) {
        const cat = entry.category
        if (cat) {
          if (!groups.has(cat)) groups.set(cat, [])
          groups.get(cat)!.push([name, entry])
        } else {
          uncategorized.push([name, entry])
        }
      }

      for (const [category, entries] of groups) {
        lines.push(`## ${category}`)
        for (const [name, entry] of entries) {
          const children = entry.hasChildren ? " [container]" : ""
          lines.push(`- **${name}**${children} -- ${entry.description ?? ""}`)
        }
        lines.push("")
      }

      if (uncategorized.length > 0) {
        lines.push("## Other")
        for (const [name, entry] of uncategorized) {
          const children = entry.hasChildren ? " [container]" : ""
          lines.push(`- **${name}**${children} -- ${entry.description ?? ""}`)
        }
        lines.push("")
      }

      lines.push(
        "All components accept an optional `style` prop (CSS overrides).",
        'Use `{ "$state": "/path" }` in any prop to bind to live state.',
      )

      return lines.join("\n")
    },

    categoryDetail(category: string) {
      const matching: [string, CatalogEntry][] = []
      for (const [name, entry] of Object.entries(components)) {
        if (entry.category?.toLowerCase() === category.toLowerCase()) {
          matching.push([name, entry])
        }
      }

      if (matching.length === 0) {
        return `No components found in category "${category}".`
      }

      const lines: string[] = [`# ${category} Components`, ""]

      for (const [name, entry] of matching) {
        formatComponentFull(lines, name, entry)
      }

      return lines.join("\n")
    },

    componentDetail(component: string) {
      const entry = components[component]
      if (!entry) {
        return `Unknown component "${component}". Use catalogRead to see available components.`
      }

      const lines: string[] = []
      formatComponentFull(lines, component, entry)
      return lines.join("\n")
    },

    validate(spec: Spec, autoFix = false): ValidationResult {
      const issues: ValidationIssue[] = []
      const fixedSpec: Spec = autoFix
        ? { root: spec.root, elements: JSON.parse(JSON.stringify(spec.elements)), state: { ...spec.state } }
        : spec

      for (const [key, element] of Object.entries(spec.elements)) {
        const entry = components[element.type]

        // Check for unknown component type
        if (!entry) {
          issues.push({
            elementKey: key,
            type: "unknown_component",
            message: `Unknown component type "${element.type}".`,
          })
          continue
        }

        // Validate props against Zod schema
        if (entry.props instanceof z.ZodObject) {
          const shape = entry.props.shape as Record<string, z.ZodType>

          // Resolve state expressions before validation -- skip props that are state bindings
          const propsToValidate: Record<string, unknown> = {}
          for (const [prop, value] of Object.entries(element.props)) {
            if (isStateExpression(value)) continue
            propsToValidate[prop] = value
          }

          // Check for missing required props
          for (const [prop, schema] of Object.entries(shape)) {
            if (!schema.isOptional() && !(prop in propsToValidate)) {
              // Check if it's a state expression
              if (prop in element.props && isStateExpression(element.props[prop])) continue

              const defaultVal = getDefaultForSchema(schema)
              issues.push({
                elementKey: key,
                type: "missing_required_prop",
                message: `Missing required prop "${prop}" on ${element.type}.`,
                fix: defaultVal !== undefined ? { prop, defaultValue: defaultVal } : undefined,
              })

              if (autoFix && defaultVal !== undefined) {
                fixedSpec.elements[key].props[prop] = defaultVal
              }
            }
          }

          // Validate each non-state prop value against its schema
          for (const [prop, value] of Object.entries(propsToValidate)) {
            if (prop in shape) {
              const result = shape[prop].safeParse(value)
              if (!result.success) {
                issues.push({
                  elementKey: key,
                  type: "invalid_prop",
                  message: `Invalid value for prop "${prop}" on ${element.type}: ${result.error.issues[0]?.message ?? "validation failed"}.`,
                })
              }
            }
          }
        }
      }

      const result: ValidationResult = {
        valid: issues.length === 0,
        issues,
      }

      if (autoFix && issues.some(i => i.fix)) {
        result.fixed = fixedSpec
      }

      return result
    },
  }
}

/** Format a single component with full prop detail. */
function formatComponentFull(lines: string[], name: string, entry: CatalogEntry) {
  lines.push(`### ${name}`)
  if (entry.description) lines.push(entry.description)
  if (entry.hasChildren) lines.push("Supports children.")

  if (entry.props instanceof z.ZodObject) {
    const shape = entry.props.shape as Record<string, z.ZodType>
    lines.push("Props:")
    for (const [prop, schema] of Object.entries(shape)) {
      const desc = schema.description ?? ""
      const opt = schema.isOptional() ? " (optional)" : ""
      lines.push(`- ${prop}${opt}: ${desc}`)
    }
  }

  lines.push("")
}

/** Check if a value is a state expression like { "$state": "/path" } */
function isStateExpression(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "$state" in value &&
    typeof (value as Record<string, unknown>)["$state"] === "string"
  )
}

/** Try to derive a sensible default value for a Zod schema. */
function getDefaultForSchema(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodString) return ""
  if (schema instanceof z.ZodNumber) return 0
  if (schema instanceof z.ZodBoolean) return false
  if (schema instanceof z.ZodArray) return []
  if (schema instanceof z.ZodEnum) {
    const values = schema.options as unknown[]
    return values[0]
  }
  return undefined
}
