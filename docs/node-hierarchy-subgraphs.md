# Design: Node hierarchy, subgraphs & resizing

> **Status:** Proposed — awaiting review. No code yet.
> **Purpose:** Drive a multi-session feature build. Self-contained: a fresh session should be
> able to execute it without prior chat context. Companion to
> `docs/diagram-model-refactor.md` (the current model, which this extends) and
> `docs/flow-diagram-editor-spec.md` (the original spec). Where this document and the older
> spec disagree for the areas it covers (containment, node nesting, resizing, drill-down
> navigation), **this document wins**. Update the **Progress checklist** at the bottom as
> phases land.

## 1. Why

Today the model cleanly separates the **semantic layer** (graph-level `Entity` +
`Relationship`) from the **visual layer** (per-diagram `Node` + `Edge` placements, positioned
by a `Layout`). The same entity can be placed on many diagrams; styling is a snapshot on the
placement; positions are per-layout. That separation is exactly what we need — but there is no
notion of one thing **containing** another, and no node **size**.

We want to model and navigate systems that are hierarchical *and* relational at once. The
motivating example: Service **A** calls services **B** and **C** (relationships). Inside A live
classes; class **E** gets data from class **F**, then calls Service B. We want to:

- Show the **subgraph inside an expanded parent node** (E, F and their edges drawn *within*
  node A), including a **partial** subgraph (only the children you choose to reveal).
- **Drill down** from A into a diagram dedicated to A's internals, and **navigate** from any
  node to the other diagrams that reference or represent its entity.
- **Traverse the hierarchy at every level** (outline + breadcrumbs), independently of the
  relationship edges.
- **Resize** nodes.

## 2. Decision log (locked)

These were resolved in the design discussion. They are the constraints the build must honor.

| # | Decision |
|---|----------|
| **H1** | **Containment is semantic — a fact about entities.** "Class E is a child of Service A" is a graph-level truth (`Entity`→`Entity`), true across every diagram, *not* a per-diagram grouping. |
| **H2** | **Containment is a DAG** — an entity may have **multiple parents** (e.g. a shared utility class inside two services). Writes must prevent cycles and self-parenting. |
| **H3** | **Containment is a distinct axis from relationships**, stored in its own `containment` table (parent, child, ordering). It does **not** reuse `relationship`/edge styling. |
| **H4** | **Drag-to-nest authors containment (WYSIWYG).** Dragging child node E into parent node A on the canvas records "E is a child of A" in the graph (creating the containment if absent). Un-nesting offers to remove it. |
| **H5** | **Drill-down opens a distinct child diagram.** An ordinary diagram can be **tagged** as "represents entity A's interior" (`diagram.representsEntityId`). Several diagrams may represent the same entity; drilling in offers a picker (or an create-one action when none exist). |
| **H6** | **Inline expansion and the drill-down diagram are independent renderings.** The subgraph shown *inside* an expanded parent node uses that diagram's own child placements/positions; it is **not** the tagged interior diagram. The two are decoupled. |
| **H7** | **Partial subgraph = authored membership.** Which children appear inside an expanded parent is decided by which child nodes you place (nest) on *that* diagram. Un-nested children stay hidden until placed. Matches how diagram membership already works. |
| **H8** | **Node size is per-layout.** Width/height live alongside position (`node_position` gains `w`/`h`). The same node can be sized differently across layouts. Parent containers auto-fit their revealed children but a manual size overrides. |
| **H9** | **Collapsed cross-boundary edges promote to the nearest visible ancestor.** When A is collapsed so E is hidden, the edge E→B is re-routed and **bundled** as A→B (aggregated, styled distinctly, non-editable). |
| **H10** | **Hierarchy traversal surfaces:** an **outline/tree panel** (browse & jump across the containment DAG) and **breadcrumbs** (your current drill path). A whole-tree "nested-boxes" auto-layout mode is **out of scope** for now (§13). |

### Key reconciliation: DAG semantics vs. React Flow's parent tree

React Flow's `parentId` is a strict **tree** (a rendered node has at most one visual parent).
Our containment is a **DAG**. These coexist cleanly because the two live at different layers:

- The **DAG** lives at the entity level in `containment` (E may be a child of both A and X).
- The **visual nesting** lives on the placement: each `node` row has at most one
  `parentNodeId` (its visual container on that diagram). An entity with two parents simply
  gets **two node placements** — one nested under each parent (in the same or different
  diagrams). This is already how the model treats "same entity, many placements."

So `node.parentNodeId` is always a per-diagram tree; the DAG richness is expressed by choosing
*which* placements to author. No conflict with React Flow.

## 3. Model changes (`src/model/`)

Authored once in `schema.ts` (the single source — DDL, JSON validator, TS types all derive
from it). All additions are **nullable / defaulted** so they are backward compatible: existing
`.nodge.json` documents load unchanged (`parseRow` defaults missing nullable columns to `null`;
`validateDocument` treats a missing `containments` array as empty). This is **additive**, not a
clean break.

### 3.1 New table: `containment` (graph-level, the hierarchy axis — H1/H2/H3)

```ts
export const containmentTable = table('containment', {
  id: text(),
  graphId: text(),
  parentEntityId: text(),
  childEntityId: text(),
  /** Sibling ordering under a parent (fractional; for outline order). */
  ordering: real(),
  metadata: metadata(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})
export type Containment = RowOf<typeof containmentTable>
```

- PK is `id` (client UUID), consistent with every other row → LWW sync + oplog work unchanged.
- Logical uniqueness of `(parentEntityId, childEntityId)` is enforced in the **gateway**, not
  by a SQL unique constraint (concurrent offline creates could otherwise fail a hard
  constraint); duplicates are de-duplicated on read.
- Add to `ALL_TABLES` (after `relationship`, before `prototype`) and export the `Containment`
  type alias.

### 3.2 `node` gains a visual parent (per-diagram nesting — H6/H7)

```ts
// nodeTable:
parentNodeId: text().orNull(),   // the node this placement is visually nested inside, on this diagram
```

- Nullable; `null` = top level. A node may only be nested inside a node whose entity is a
  **semantic parent** (via `containment`) of this node's entity — enforced in the gateway
  (H4 lets a drag create that containment on the fly).

### 3.3 `diagram` gains an interior tag (drill-down target — H5)

```ts
// diagramTable:
representsEntityId: text().orNull(),   // this diagram depicts the interior of this entity
```

- Nullable; several diagrams may carry the same `representsEntityId`. Drill-down queries
  `diagrams where representsEntityId = A`.

### 3.4 `node_position` gains size + collapse (per-layout view state — H8)

`node_position` is already keyed `(layoutId, nodeId)` — exactly the per-layout, per-node grain
we need for size and collapse state.

```ts
export const nodePositionTable = table(
  'node_position',
  {
    layoutId: text(),
    nodeId: text(),
    x: real(),
    y: real(),
    w: real().orNull(),          // manual width; null = auto (content / fit-children)
    h: real().orNull(),          // manual height; null = auto
    collapsed: boolean(),        // parent shown collapsed in this layout (default false)
  },
  { primaryKey: ['layoutId', 'nodeId'] },
)
```

- `DocumentNodePosition` (in `document.ts`) and `parsePosition` extend to carry
  `w`/`h`/`collapsed` (all optional on read; default `null`/`null`/`false`).

### 3.5 `document.ts`

- `CURRENT_SCHEMA_VERSION` **3 → 4**.
- `NodgeDocument` gains `containments: Containment[]`.
- `validateDocument`: parse `root.containments` **tolerantly** (missing ⇒ `[]`), parse the
  extended positions, and include `representsEntityId` (rides along via `parseRow(diagramTable…)`)
  and `parentNodeId` (rides along via `parseRow(nodeTable…)`) automatically.
- `ddl.ts` regenerates from `ALL_TABLES` — no manual edits.

## 4. SQLite migration (`src/db/migrations.ts`)

Append **v5** (additive; idempotent for both fresh and legacy OPFS DBs, mirroring the v4
guard style):

```
version: 5, up:
  - createTableSql(containmentTable)                       // CREATE TABLE IF NOT EXISTS via helper
  - addColumnIfMissing(db, 'node', 'parent_node_id', 'TEXT')
  - addColumnIfMissing(db, 'diagram', 'represents_entity_id', 'TEXT')
  - addColumnIfMissing(db, 'node_position', 'w', 'REAL')
  - addColumnIfMissing(db, 'node_position', 'h', 'REAL')
  - addColumnIfMissing(db, 'node_position', 'collapsed', 'INTEGER NOT NULL DEFAULT 0')
```

- A brand-new DB is created correctly by v1's `schemaDdl()`; the `addColumnIfMissing` guards
  make v5 a no-op there. `LATEST_SQLITE_VERSION` follows automatically.
- Use the existing `createTableSql` helper for `containment` (add `containmentTable` to the
  import) — `IF NOT EXISTS` keeps it idempotent.

## 5. Gateway (`src/gateway/types.ts`, `LocalGateway.ts`)

Every mutation goes through the `command(...)` / `Mutator` seam (journalled to the oplog), same
as existing methods. New/changed surface:

### 5.1 Containment CRUD (with cycle prevention — H2/H3)

```ts
createContainment(graphId, { parentEntityId, childEntityId, ordering?, metadata? }): Promise<Containment>
updateContainment(id, { ordering?, metadata? }): Promise<Containment>   // reorder siblings
deleteContainment(id): Promise<void>
```

- `createContainment` **rejects**: self-parenting (`parent === child`); a pair that already
  exists (idempotent — return the existing); and any pair whose addition would create a
  **cycle** (i.e. `parent` is reachable from `child` following child→…→descendant edges).
  Reachability is a BFS over `containment` rows for the graph.
- `deleteEntity` cascades: remove containment rows referencing the entity as parent or child,
  and null out `parentNodeId` on placements that pointed at a now-removed nesting.

### 5.2 Visual nesting on a placement (H4/H6/H7)

```ts
setNodeParent(nodeId, parentNodeId | null): Promise<Node>
```

- Setting a non-null parent validates that the parent node's entity is a semantic parent of the
  child node's entity. **Per H4**, if that containment does not yet exist, the composite gesture
  used by the canvas (`nestNode`, below) creates it first — a single undoable command.
- Guards against making a node its own ancestor *visually* (the per-diagram tree stays acyclic).

```ts
// Composite canvas gesture (single undoable command): create containment if needed, then nest.
nestNode(diagramId, { childNodeId, parentNodeId }): Promise<{ node: Node; containment?: Containment }>
unnestNode(nodeId, { removeContainment?: boolean }): Promise<{ node: Node }>
```

### 5.3 Interior-diagram tag (H5)

- Extend `DiagramPatch` / `updateDiagram` with `representsEntityId?: Uuid | null`.
- Add a small helper for navigation: `listInteriorDiagrams(entityId): Promise<Diagram[]>`
  (diagrams where `representsEntityId === entityId`).

### 5.4 Positions carry size + collapse (H8)

- `NodePositionInput` gains optional `w?: number | null`, `h?: number | null`,
  `collapsed?: boolean`. `bulkUpsertPositions` writes them (unset ⇒ preserve/default).
- `LayoutDetail.positions` and `diagram.ts`'s `positionMap` carry them through.

### 5.5 Cross-reference index (extend `getEntityUsages`, §7.4)

`EntityUsage` gains:
- `parents: { containmentId, parentEntityId }[]` and `children: { containmentId, childEntityId, ordering }[]`
  (the containment neighborhood — powers the outline panel and breadcrumbs).
- `interiorDiagrams: { diagramId, diagramName }[]` (diagrams tagged as this entity's interior).

The existing `placements` already answer "which diagrams contain this entity" (the
"link to any diagram containing the entity" ask) — no new work there.

### 5.6 Nested fetch

- `GraphDetail` gains `containments: Containment[]`; `getGraph` loads them. `exportJson` /
  `importJson` include them.

## 6. Rendering / diagram transform (`src/editor/diagram.ts`)

Pure, unit-tested transform from relational rows → React Flow nodes/edges. Extend:

### 6.1 Node nesting, size, collapse

- `FlowNode` gains optional `parentId?: string`, `extent?: 'parent'`, `width?`, `height?`, and
  `data.isContainer` / `data.collapsed`.
- `toFlowNodes`: set `parentId = node.parentNodeId` and `extent: 'parent'` when nested. **Emit
  parents before their children** (React Flow requires parent-first ordering) — topologically
  sort by the `parentNodeId` tree.
- **Position semantics:** React Flow child positions are **relative to the parent**. Persisted
  positions stay in the parent-relative frame (what the canvas already reports for nested
  nodes), so no coordinate conversion is needed on save; the transform passes them through.
- Size: apply `w`/`h` from the position row when set; otherwise leave undefined (React Flow /
  the node component sizes to content, and containers fit children via §7.2).
- **Collapse (H7/H9):** given the layout's `collapsed` set, drop the *descendant* nodes of any
  collapsed parent from `flowNodes` (they are not rendered), and mark the parent
  `data.collapsed = true` (renders a compact, non-expanded box with an expand affordance).

### 6.2 Edge promotion / aggregation (H9)

New pure helper `promoteEdges(edges, nodeParent, hiddenNodeIds)`:
- For each edge, map each endpoint that is hidden (a descendant of a collapsed parent) to its
  **nearest visible ancestor** node id.
- Drop edges whose endpoints collapse to the **same** visible node (fully-internal edges).
- **Bundle** edges that now share `(source, target)` into one synthetic aggregated edge
  (`id: 'agg:<src>-><tgt>'`, `data.aggregated = true`, `data.count = n`), styled distinctly and
  rendered non-interactive (no style/label editing on an aggregate).
- Non-promoted edges pass through unchanged.

Unit tests cover: promote E→B to A→B when A collapsed; drop E→F when both inside collapsed A;
bundle E→B and G→B into one A→B with `count = 2`.

## 7. Canvas / editor (`src/editor/NodgeNode.tsx`, `Editor.tsx`)

### 7.1 Resizing (H8)

- `NodgeNode`: render `<NodeResizer minWidth={...} minHeight={...} />` (from `@xyflow/react`),
  visible when selected. Container nodes get a larger min size and interior padding for children.
- `Editor.onNodesChange`: already flushes `position` changes to `bulkUpsertPositions` on drag
  end (lines ~498–518). Extend the same debounced flush to persist `dimensions` changes
  (`change.type === 'dimensions'` with a resize) as `w`/`h` on the position row — one undoable
  command per resize, exactly like drag.

### 7.2 Containers & nesting (H4/H6/H7)

- Enable React Flow parent/child nesting; a node with children renders as a container (bordered
  region with a header showing the label + expand/collapse toggle + a "drill in" affordance).
- **Drag-to-nest:** on `onNodeDragStop`, detect when a node was dropped over another node and
  call `nestNode` (which creates the containment per H4). Dropping out of a parent calls
  `unnestNode` (prompt to remove the containment). React Flow's `getIntersectingNodes` /
  drop-target detection drives this.
- **Auto-fit:** when a container has no manual `w`/`h`, size it to bound its children plus
  padding (computed in the transform / a layout pass); a manual resize pins `w`/`h` and stops
  auto-fit for that layout.

### 7.3 Expand / collapse (H7/H9)

- Toggle on the container header flips the node's `collapsed` flag in the active layout
  (persisted via `bulkUpsertPositions`), re-running the transform (which hides descendants and
  promotes edges).

### 7.4 Drill-down + navigation (H5, H10)

- **Drill in** (container header action, or double-click): look up `listInteriorDiagrams(entity)`.
  If one → open it; if several → picker; if none → offer "Create interior diagram for A"
  (creates a diagram with `representsEntityId = A`, seeded from A's semantic children as an
  optional convenience, then opens it).
- **Breadcrumbs** (top of canvas): the current drill path (Root › A › E). Built from the drill
  stack (router state), click a crumb to pop up. Lightweight; shows the current path only.

## 8. Panels / UI (`src/editor/panels/`)

- **New `HierarchyPanel`** (outline/tree — H10): render the containment DAG for the graph as a
  collapsible tree (an entity with multiple parents appears under each — a DAG shown as a tree
  with repeats, de-duplicated per branch to avoid infinite nesting). Row actions: select/reveal
  the entity's node on the canvas, drill into its interior diagram, add/remove a child. Drag to
  reorder siblings (`updateContainment.ordering`) and to re-parent (`createContainment` +
  `deleteContainment`).
- **`EntityPanel`**: add a "Contained by / Contains" section (parents + children from
  `getEntityUsages`), with add/remove; and an "Interior diagrams" section listing/creating
  representing diagrams.
- **`RelationshipsPanel`**: unchanged (relationships stay a separate axis); the hierarchy has
  its own panel so the two axes read distinctly (per H3).
- **Diagram settings**: a control to set/clear `representsEntityId` ("This diagram represents
  the interior of …").

## 9. Sync / oplog

- No special handling: `containment` rows and the new columns flow through the existing
  `Mutator` → oplog → LWW path (every row has `id`/`version`/`updatedAt`). Containment
  duplicate/cycle resolution is enforced at the **command layer** on write and de-duplicated on
  read, so concurrent offline edits reconcile without a hard SQL constraint failure.

## 10. Testing

Mirror the repo's pre-push rigor; TDD where practical.
- **Unit:** `model.test` (new table + columns + document round-trip incl. `containments`),
  `diagram.test` (nesting/parent-first ordering, size passthrough, collapse hiding, **edge
  promotion/bundling**), `db.test`/`oplogSchema.test` (v5 migration; fresh + legacy).
- **Gateway:** new `phase*`/`LocalGateway.test` coverage — containment CRUD, **cycle & self-parent
  rejection**, `nestNode` creating containment (H4), `setNodeParent` semantic-parent validation,
  `representsEntityId` patch + `listInteriorDiagrams`, positions carrying `w`/`h`/`collapsed`,
  extended `getEntityUsages`, `deleteEntity` cascade.
- **Components:** `NodgeNode` (resizer + container/collapsed render), new `HierarchyPanel`,
  `EntityPanel` (parents/children/interior sections), `Editor` (drag-to-nest, resize flush,
  expand/collapse, drill-in), breadcrumbs.

## 11. Verification (end-to-end)

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green (the pre-push gate).
2. `pnpm dev` manual smoke:
   - Resize a node → size persists per layout; a second layout keeps its own size.
   - Drag class E onto service A → E nests inside A and "A contains E" appears in the panel;
     drag E out → prompt removes the containment.
   - Reveal only E and F inside A (partial subgraph); G stays hidden until placed.
   - Collapse A → E/F disappear and E→B shows as a bundled A→B; expand → restored.
   - Give E a second parent X; E appears under both in the outline; place E under each.
   - Drill into A → picker/create of A's interior diagram; breadcrumbs show Root › A.
   - Save → reload: containment, nesting, sizes, collapse state, interior tags all persist.
   - Import an **old** `.nodge.json` (no `containments`) → loads and renders as before.

## 12. Suggested sequencing (each a committable, gate-passing chunk)

1. **Model + DDL + document** — `containmentTable`; `node.parentNodeId`;
   `diagram.representsEntityId`; `node_position.w/h/collapsed`; `CURRENT_SCHEMA_VERSION` 3→4;
   `document.ts` (+ tolerant `containments`). Fix `model.test`.
2. **SQLite migration v5** + db tests (fresh + legacy).
3. **Gateway** — containment CRUD + cycle checks; `setNodeParent`/`nestNode`/`unnestNode`;
   `representsEntityId` patch + `listInteriorDiagrams`; positions w/h/collapsed; extended
   `getEntityUsages`; `deleteEntity` cascade; `GraphDetail.containments` + export/import.
4. **Transform** — `diagram.ts`: parent-first ordering, size/collapse, `promoteEdges`. Tests.
5. **Canvas** — `NodgeNode` resizer + container/collapsed; `Editor` resize flush, drag-to-nest,
   expand/collapse, drill-in.
6. **Panels + navigation** — `HierarchyPanel`, `EntityPanel` sections, diagram interior control,
   breadcrumbs.
7. **Full sweep** — gate + manual smoke (§11); update this checklist.

## Progress checklist
- [ ] 1. Model + DDL + document format
- [ ] 2. SQLite migration v5
- [ ] 3. Gateway (containment CRUD, nesting, interior tag, positions, usages)
- [ ] 4. Diagram transform (nesting, size, collapse, edge promotion)
- [ ] 5. Canvas (resize, drag-to-nest, expand/collapse, drill-in)
- [ ] 6. Panels + navigation (hierarchy outline, entity sections, breadcrumbs)
- [ ] 7. Full gate + manual smoke

## 13. Out of scope (separate follow-ups)
- **Nested-boxes layout mode** (auto-arranging the whole containment tree at once) — deferred
  per H10; the outline + breadcrumbs + per-node expand cover traversal for now.
- **Cross-diagram edge rendering** (drawing an edge whose endpoints live on different diagrams).
- **Automatic interior-diagram sync** (keeping a tagged interior diagram's membership in lockstep
  with the entity's children) — interior diagrams stay hand-authored (H5/H6).
