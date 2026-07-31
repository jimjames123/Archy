/**
 * The building graph and the transaction API that mutates it.
 *
 * Every change goes through a Transaction so we get, for free:
 *  - an append-only edit log (undo/redo, audit, provenance history),
 *  - a precise `changed` set per commit, which the rules engine uses to
 *    re-validate only the affected neighbourhood instead of the whole model.
 */
import type { Edge, EdgeKind, Element, ElementType } from "./schema.js";

export type Id = string;

export type EditOp =
  | { op: "addElement"; element: Element }
  | { op: "updateElement"; id: Id; patch: Partial<Element> }
  | { op: "removeElement"; id: Id }
  | { op: "addEdge"; edge: Edge }
  | { op: "removeEdge"; edge: Edge };

export interface EditLogEntry {
  txId: number;
  ops: EditOp[];
  changed: Id[];
  timestamp: number;
}

export interface CommitResult {
  txId: number;
  /** Ids of every element touched (added, updated, removed, or edge-adjacent). */
  changed: Set<Id>;
  /**
   * Element types involved in the commit — including the types of REMOVED
   * elements, captured at mutation time. The rules engine dispatches on this so
   * a deletion still triggers the rules that depended on the deleted type.
   */
  changedTypes: Set<ElementType>;
}

/** In-memory building model. Serialises to a plain JSON document per revision. */
export class BuildingModel {
  private elements = new Map<Id, Element>();
  private edges: Edge[] = [];
  private log: EditLogEntry[] = [];
  private txCounter = 0;

  getElement(id: Id): Element | undefined {
    return this.elements.get(id);
  }

  allElements(): Element[] {
    return [...this.elements.values()];
  }

  elementsOfType<T extends ElementType>(type: T): Extract<Element, { type: T }>[] {
    return this.allElements().filter(
      (e): e is Extract<Element, { type: T }> => e.type === type,
    );
  }

  allEdges(): readonly Edge[] {
    return this.edges;
  }

  edgesOfKind<K extends EdgeKind>(kind: K): Extract<Edge, { kind: K }>[] {
    return this.edges.filter(
      (e): e is Extract<Edge, { kind: K }> => e.kind === kind,
    );
  }

  editLog(): readonly EditLogEntry[] {
    return this.log;
  }

  /**
   * Apply a set of ops atomically. Returns the ids touched plus the element
   * TYPES involved (see `changedTypes`), which callers hand to the rules
   * engine. Bumps `version` on every mutated element so downstream consumers
   * can detect staleness.
   */
  commit(ops: EditOp[]): CommitResult {
    const changed = new Set<Id>();
    // Types are tracked separately so a REMOVED element still triggers the
    // rules that depended on its type — its type is gone from the model by the
    // time the engine runs, so we capture it here at mutation time.
    const changedTypes = new Set<ElementType>();
    const noteType = (id: Id) => {
      const el = this.elements.get(id);
      if (el) changedTypes.add(el.type);
    };

    for (const op of ops) {
      switch (op.op) {
        case "addElement": {
          this.elements.set(op.element.id, { ...op.element });
          changed.add(op.element.id);
          changedTypes.add(op.element.type);
          break;
        }
        case "updateElement": {
          const existing = this.elements.get(op.id);
          if (!existing) throw new Error(`updateElement: unknown id ${op.id}`);
          // Discriminated-union-safe merge: patch cannot change `type`.
          const merged = {
            ...existing,
            ...op.patch,
            type: existing.type,
            version: existing.version + 1,
          } as Element;
          this.elements.set(op.id, merged);
          changed.add(op.id);
          changedTypes.add(existing.type);
          break;
        }
        case "removeElement": {
          const removed = this.elements.get(op.id);
          if (!removed) throw new Error(`removeElement: unknown id ${op.id}`);
          this.elements.delete(op.id);
          changed.add(op.id);
          changedTypes.add(removed.type); // capture before it's unreachable
          // Cascade: drop edges that referenced the element, and mark the
          // elements on the other end of those edges as changed so their
          // rules re-run (e.g. removing a wall re-validates its openings).
          this.edges = this.edges.filter((edge) => {
            const refs = edgeRefs(edge);
            if (!refs.includes(op.id)) return true;
            for (const r of refs)
              if (r !== op.id) {
                changed.add(r);
                noteType(r);
              }
            return false;
          });
          break;
        }
        case "addEdge": {
          this.edges.push(op.edge);
          for (const r of edgeRefs(op.edge)) {
            changed.add(r);
            noteType(r);
          }
          break;
        }
        case "removeEdge": {
          const key = edgeKey(op.edge);
          this.edges = this.edges.filter((e) => edgeKey(e) !== key);
          for (const r of edgeRefs(op.edge)) {
            changed.add(r);
            noteType(r);
          }
          break;
        }
      }
    }
    const txId = ++this.txCounter;
    this.log.push({ txId, ops, changed: [...changed], timestamp: Date.now() });
    return { txId, changed, changedTypes };
  }

  toJSON() {
    return { elements: this.allElements(), edges: this.edges };
  }
}

/** The element ids an edge references. */
export function edgeRefs(edge: Edge): Id[] {
  switch (edge.kind) {
    case "bounds":
      return [edge.wall, edge.space];
    case "hostedBy":
      return [edge.opening, edge.wall];
    case "supports":
      return [edge.beam, edge.carries];
  }
}

function edgeKey(edge: Edge): string {
  return `${edge.kind}:${edgeRefs(edge).join("|")}`;
}
