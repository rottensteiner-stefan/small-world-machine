/**
 * Definition of a single configurable field surfaced to a property-editing UI (Gadget
 * Inspector today, Maker later -- see docs/adr/0010-maker-editor-architecture.md). Declared
 * per-class as a `static readonly inspector` map, keyed by an arbitrary field id.
 */
export interface InspectorField {
  type: "number" | "boolean" | "string" | "choice" | "color" | "vec3" | "vec2";
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[] | Record<string, string | number>;
  /** Dotted path to the actual value when it isn't a direct own property, e.g. "position.x". */
  path?: string;
  /** Optional row identifier to group multiple consecutive fields onto a single horizontal line. */
  row?: string;
}

/** Shape a constructor must have to participate: the static schema lives on the class itself. */
interface InspectableConstructor {
  inspector?: Record<string, InspectorField>;
}

/**
 * Walks an instance's prototype chain (via its constructor's own `Object.getPrototypeOf` chain,
 * which mirrors `extends`) collecting every ancestor's `static inspector` map, applied base
 * class first so a subclass's own entries win on key collision. This is what lets e.g.
 * `AbstractMaterial`'s common fields (color, transparent, ...) and a concrete `StandardMaterial`
 * subclass's own fields (metallic, roughness, ...) both surface from a single call, without
 * either class needing to know about the other's fields.
 */
export function collectInspectorSchema(instance: object): Record<string, InspectorField> {
  const chain: InspectableConstructor[] = [];
  let ctor: unknown = instance.constructor;
  while ("function" === typeof ctor) {
    chain.unshift(ctor as InspectableConstructor);
    ctor = Object.getPrototypeOf(ctor);
  }

  const schema: Record<string, InspectorField> = {};
  for (const level of chain) {
    if (level.inspector) Object.assign(schema, level.inspector);
  }
  return schema;
}
