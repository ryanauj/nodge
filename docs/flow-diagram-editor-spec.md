# nodge — Flow Diagram Editor: Blueprint & Specification

**Status:** Design (waterfall) — approved decisions, pre-implementation
**Repo:** `ryanauj/nodge` (`nodes-plus-edges`)
**Branch:** `claude/flow-diagram-editor-spec-4yulx0`
**Scaffold today:** Vite + React 18 + TypeScript (strict) + Vitest + ESLint + pnpm, with a pre-push gate (`typecheck → lint → test → build`). No diagram code yet.

---

## 1. Vision & Goals

nodge is a **client-side-only flow diagram editor** that runs entirely in the browser, persists locally, and is architected so a real storage server can be slotted in later **without touching call sites**. It models its data after the proven "flows" feature in `ryanauj/site`, but reimplements it standalone (clean-room, inspired-only) with three deliberate upgrades:

1. **A two-layer graph model** — abstract *base entities/relationships* (the things and how they truly connect) separated from *visual placements* (how they're drawn), so the same component can appear in many subgraphs/views while all connections trace back to one canonical entity.
2. **A rich, nodge-native styling system** (inspired by `ryanauj/iux`) — palettes that go beyond color (borders, patterns, backgrounds, shapes, elevation, engine effects), swappable **per view**, plus a customizable app theme.
3. **First-class mobile UX** — a single responsive app with a deliberate touch interaction model, not a desktop port.

### Primary goals
- Simplest path first: draw a diagram, autosave locally, save/load a file.
- Node & edge customization: color, border, background, pattern, shape, plus reusable **prototypes** (typed templates carrying style **and** metadata defaults).
- **Quick edge-drop creation**: drag an edge into empty space → pick/create the thing it connects to, pre-filled from a prototype.
- **Link nodes to the abstract things they describe** (URLs, files, other diagrams/entities, records).
- **Multiple views** of the same diagram and **subgraphs** of the same components, all tracked back to base entities.
- **Sync-ready**: a clean data-access seam so a future server is a config change, not a rewrite.

### Non-goals (for now)
- Real-time multi-user collaboration (the architecture leaves the door open; see §6.6 and Phase 6).
- A hosted backend (Phase 6 is "readiness," not "build the server").
- Importing/round-tripping site's exact DB (data model is *compatible in spirit*, not byte-identical).

---

## 2. Decision Log (the 15 locked choices)

Every choice below was deliberately selected during design. Rationale is summarized; details live in the referenced sections.

| # | Decision | Choice | Section |
|---|----------|--------|---------|
| 1 | Server seam | **REST-shaped async `DataGateway`** — typed interface, methods modeled 1:1 on REST endpoints; Local adapter now, HTTP/Service-Worker later, zero call-site changes | §6.1 |
| 2 | Local store | **SQLite-WASM (OPFS-persisted) from the start** — real SQL over the relational model; schema ports directly to a future server | §6.2 |
| 3 | IDs & change tracking | **Client UUIDs + per-row `version` + `updatedAt`**, all writes routed through a **command layer** (oplog upgrade stays additive) | §6.3 |
| 4 | Entity links | **Typed `links[]` + open `metadata` bag on the base Entity** — `kind: url\|file\|diagram\|entity\|record\|note` | §5.4 |
| 5 | Views / subgraphs | **Hybrid 3-tier**: base **Graph** → **Boards** (curated subgraph membership) → **Views** (per-view positions + optional filter/focus + palette) | §7 |
| 6 | Palette system origin | **Nodge-native, iux-inspired** — own token contract & palettes, borrowing iux's structure (not its code) | §8 |
| 7 | Node/edge style model | **Token-referenced cascade**: palette → prototype → entity override → node override, with **pin-to-raw** escape hatch | §8.3 |
| 8 | Palette scope | **Two scopes** (app-chrome palette + per-view canvas palette) from a shared library, plus a **palette editor**; phased (selection first, editor as fast-follow) | §8.4 |
| 9 | Prototypes | **First-class prototype library** — templates carry style + shape + default label + metadata + typed-link scaffolding; `Save as prototype`; edge-drop quick-picker | §9 |
| 10 | Copy/paste | **Node paste = always another placement of the same entity** (never forks identity); prototypes can be duplicated; entities link to prototypes | §9.3 |
| 11 | Entity↔Prototype link | **One-time seed, link persists**: no auto-propagation on prototype edit; opt-in **refresh from prototype** (per node/entity or batched) | §9.2 |
| 12 | Edges & relationships | **Full parallel to nodes**: base **Relationship** between entities + **RelationshipPrototype** (relationship *types*); edges are placements | §5.3, §9 |
| 13 | File format | **JSON primary** (`.nodge.json`, versioned/diffable/sync-aligned) **+ raw `.sqlite` export**; JSON always loads *into* the WASM SQLite runtime | §6.4 |
| 14 | Mobile UX | **One responsive app, deliberate touch model** — mode-less gesture disambiguation (tap/double-tap/long-press marquee/handle-drag), big targets, bottom-sheet panels | §10 |
| 15 | Build sequencing | **Thin vertical slice first, then layer** (Phases 0→6) | §12 |

---

## 3. Architecture Overview

nodge is a layered single-page app. Data flows **only** through the gateway; the UI never touches storage or `fetch` directly.

```
┌──────────────────────────────────────────────────────────────┐
│  UI Layer (React + @xyflow/react)                            │
│  Canvas · Boards/Views · Panels (bottom sheets) · Palette     │
│  editor · Prototype picker · Cross-reference panel            │
└───────────────▲───────────────────────────┬──────────────────┘
                │ React Query (cache)        │ commands
                │                            ▼
┌───────────────┴──────────────┐   ┌──────────────────────────┐
│  DataGateway (interface)     │   │  Command Layer            │
│  REST-shaped async methods   │◀──│  every mutation; stamps   │
│  getDiagram(), createNode()… │   │  UUID, version, updatedAt │
└───────────────▲──────────────┘   └──────────────────────────┘
                │ implemented by
   ┌────────────┴────────────┐
   │  LocalGateway (now)     │     HttpGateway / SW (Phase 6)
   │  runs SQL on…           │     same interface, real server
   └────────────▲────────────┘
                │
   ┌────────────┴────────────┐     ┌──────────────────────────┐
   │  SQLite-WASM (OPFS)     │◀───▶│  JSON import/export       │
   │  the live runtime store │     │  (.nodge.json) + .sqlite  │
   └─────────────────────────┘     └──────────────────────────┘
```

**Key invariants**
- **SQLite-WASM is always the live store.** Files (JSON or `.sqlite`) are an import/export/sync boundary; opening a project *loads it into* SQLite, all edits run against SQLite, saving serializes out.
- **One model definition, three artifacts.** The schema is authored once and generates: (a) the SQLite DDL, (b) the JSON DTO shapes + validator, (c) the TypeScript types. They cannot drift.
- **All writes go through the command layer**, which assigns/maintains identity (`id`, `version`, `updatedAt`). This is the single seam where an append-only oplog could later be added for true sync/collaboration without changing call sites.

---

## 4. Glossary / Vocabulary

| Term | Layer | Meaning |
|------|-------|---------|
| **Graph** | Base | The top-level container; the canonical set of entities & relationships (the "project's truth"). |
| **Entity** | Base | An abstract *thing* the diagram describes. Has a name, typed links, a metadata bag, and an optional linked **Prototype**. Exists independent of any drawing. |
| **Relationship** | Base | A canonical connection between two entities, optionally typed by a **RelationshipPrototype**. |
| **Prototype** | Base (library) | A reusable **template / type** for an entity (`NodePrototype`) or relationship (`RelationshipPrototype`): default style, shape, label, metadata, link scaffolding. |
| **Board** | Visual | A curated **subgraph** — *which* entities/relationships are placed for display. |
| **Node** | Visual | A *placement* of an entity on a board (the box you see). Many nodes can reference one entity. |
| **Edge** | Visual | A *placement* of a relationship between two nodes on a board. |
| **View** | Visual | A named presentation of a board: per-view node **positions**, viewport, applied **palette**, optional **filter/focus** lens. |
| **Palette** | Style | A set of semantic style tokens (color/border/pattern/typography/effect). Applies to app chrome and/or per view. |
| **StyleProfile** | Style | A named reusable bundle of style overrides (a "look") referenced by prototypes/entities/nodes. |
| **Cross-reference index** | Derived | For any entity/relationship: every node/edge/board/view that draws it. Powers "find everywhere this is used." |

---

## 5. Domain Model (Base Layer)

### 5.1 Graph
The project root. Holds entities, relationships, boards, the prototype library, palettes, and style profiles.

```
Graph {
  id: Uuid
  name: string
  description: string
  schemaVersion: int          // for JSON migration
  createdAt, updatedAt, version
}
```

### 5.2 Entity (the abstract thing)
```
Entity {
  id: Uuid
  graphId: Uuid
  name: string
  prototypeId: Uuid | null     // linked template/type (seed-on-create; see §9.2)
  styleOverride: StyleDelta     // entity-level overrides above the prototype
  links: ExternalLink[]         // typed links — see §5.4
  metadata: Record<string, unknown>   // open bag
  createdAt, updatedAt, version
}
```
- Editing an entity (name, links, metadata) reflects on **every** node that places it.
- `styleOverride` sits between the prototype and per-node overrides in the cascade (§8.3).

### 5.3 Relationship (the abstract connection)
```
Relationship {
  id: Uuid
  graphId: Uuid
  sourceEntityId: Uuid
  targetEntityId: Uuid
  prototypeId: Uuid | null      // RelationshipPrototype (relationship type)
  directed: boolean
  label: string
  styleOverride: StyleDelta
  metadata: Record<string, unknown>
  createdAt, updatedAt, version
}
```
- No uniqueness constraint on `(source, target)` — multiple relationships between the same pair are allowed.
- The cross-reference index (§7.4) lets any entity enumerate all relationships it participates in, across all boards.

### 5.4 External links & metadata
The mechanism for "linking nodes to the abstract things they describe." Links live on the **Entity** (so every placement inherits them).

```
ExternalLink {
  id: Uuid
  kind: 'url' | 'file' | 'diagram' | 'entity' | 'record' | 'note'
  target: string               // URI, entity/board Uuid, external record id, or note text
  label: string
}
```
- `kind: 'diagram'` → drill into a subgraph board (powers nested navigation).
- `kind: 'entity'` → cross-reference another entity (builds a backlink graph).
- `kind: 'url' | 'file'` → open externally.
- `kind: 'record'` → reference to an external system's row (foundation for future server integrations, e.g. a site record).
- `metadata` (open bag) absorbs anything not worth a typed link.

---

## 6. Persistence & Sync Architecture

### 6.1 The DataGateway seam (Decision 1)
A single typed, async interface is the only way the app reads/writes data. Methods are modeled 1:1 on REST endpoints so an HTTP backend (or a Service Worker mock) drops in behind the same interface.

```ts
interface DataGateway {
  // Graphs
  listGraphs(): Promise<Graph[]>
  getGraph(id: Uuid): Promise<GraphDetail>          // GET /graphs/:id
  createGraph(input: GraphInput): Promise<Graph>    // POST /graphs
  updateGraph(id: Uuid, patch: GraphPatch): Promise<Graph>
  deleteGraph(id: Uuid): Promise<void>

  // Entities / Relationships
  createEntity(graphId: Uuid, input: EntityInput): Promise<Entity>
  updateEntity(id: Uuid, patch: EntityPatch): Promise<Entity>
  deleteEntity(id: Uuid): Promise<void>
  createRelationship(graphId: Uuid, input: RelationshipInput): Promise<Relationship>
  // …updateRelationship, deleteRelationship

  // Boards / Nodes / Edges / Views
  getBoard(id: Uuid): Promise<BoardDetail>          // nested nodes/edges/views
  createNode(boardId: Uuid, input: NodeInput): Promise<Node>
  updateNode(id: Uuid, patch: NodePatch): Promise<Node>
  createEdge(boardId: Uuid, input: EdgeInput): Promise<Edge>
  createView(boardId: Uuid, input: ViewInput): Promise<View>
  bulkUpsertPositions(viewId: Uuid, positions: NodePosition[]): Promise<NodePosition[]>

  // Prototypes / Palettes / StyleProfiles
  listPrototypes(graphId: Uuid): Promise<Prototype[]>
  createPrototype(graphId: Uuid, input: PrototypeInput): Promise<Prototype>
  refreshFromPrototype(req: RefreshRequest): Promise<RefreshResult>   // §9.2
  listPalettes(graphId: Uuid): Promise<Palette[]>
  // …

  // Cross-reference (derived)
  getEntityUsages(entityId: Uuid): Promise<EntityUsage>              // §7.4

  // Project I/O
  exportJson(graphId: Uuid): Promise<NodgeDocument>
  importJson(doc: NodgeDocument): Promise<Graph>
}
```

- The UI consumes the gateway via React context + React Query. Swapping `LocalGateway` → `HttpGateway` is a one-line provider change.
- Gateway methods return **DTOs** (serializable, REST-shaped), not ORM rows.

### 6.2 Local store: SQLite-WASM (Decision 2)
- Real SQLite compiled to WASM (e.g. `wa-sqlite` or the official SQLite WASM build), persisted to **OPFS** (Origin Private File System) with IndexedDB fallback.
- Runs in a **Web Worker** to keep the main thread responsive and to satisfy OPFS sync-access-handle requirements.
- The relational schema mirrors the domain model (one table per type) and ports almost directly to a future server DB. Indented DDL sketch:

```sql
CREATE TABLE graph        (id TEXT PRIMARY KEY, name TEXT, description TEXT,
                           schema_version INT, created_at TEXT, updated_at TEXT, version INT);
CREATE TABLE entity       (id TEXT PRIMARY KEY, graph_id TEXT, name TEXT, prototype_id TEXT,
                           style_override TEXT /*json*/, links TEXT /*json*/, metadata TEXT /*json*/,
                           created_at TEXT, updated_at TEXT, version INT);
CREATE TABLE relationship (id TEXT PRIMARY KEY, graph_id TEXT, source_entity_id TEXT,
                           target_entity_id TEXT, prototype_id TEXT, directed INT, label TEXT,
                           style_override TEXT, metadata TEXT, created_at TEXT, updated_at TEXT, version INT);
CREATE TABLE prototype    (id TEXT PRIMARY KEY, graph_id TEXT, kind TEXT /*node|relationship*/,
                           name TEXT, shape TEXT, default_label TEXT, style TEXT, metadata TEXT,
                           link_scaffold TEXT, created_at TEXT, updated_at TEXT, version INT);
CREATE TABLE board        (id TEXT PRIMARY KEY, graph_id TEXT, name TEXT, description TEXT, …);
CREATE TABLE node         (id TEXT PRIMARY KEY, board_id TEXT, entity_id TEXT, label TEXT,
                           style_override TEXT, …);
CREATE TABLE edge         (id TEXT PRIMARY KEY, board_id TEXT, relationship_id TEXT,
                           source_node_id TEXT, target_node_id TEXT, source_handle TEXT,
                           target_handle TEXT, label TEXT, style_override TEXT, …);
CREATE TABLE view         (id TEXT PRIMARY KEY, board_id TEXT, name TEXT, palette_id TEXT,
                           filter TEXT /*json*/, viewport TEXT /*json*/, …);
CREATE TABLE node_position(view_id TEXT, node_id TEXT, x REAL, y REAL,
                           PRIMARY KEY (view_id, node_id));
CREATE TABLE palette      (id TEXT PRIMARY KEY, graph_id TEXT, name TEXT, tokens TEXT /*json*/,
                           builtin INT, …);
CREATE TABLE style_profile(id TEXT PRIMARY KEY, graph_id TEXT, name TEXT, target TEXT /*node|edge*/,
                           style TEXT, …);
-- Optional, Phase 6: CREATE TABLE oplog(...);
```

### 6.3 Identity & change tracking (Decision 3)
- Every row gets a **client-generated UUID** at creation, an integer **`version`** (bumped each write), and an **`updatedAt`** ISO timestamp.
- All mutations flow through a **command layer** (`type Command = { kind, payload }` → executed → returns updated DTO). The command layer:
  - assigns identity + stamps version/timestamp,
  - drives **undo/redo** (inverse commands / snapshots),
  - is the single place an **append-only oplog** can be introduced later for sync/CRDT (Phase 6) without changing any call site.
- Sync model (future): last-write-wins by `version`/`updatedAt`; "changed since T" pulls. No ID remap needed because IDs are globally unique from birth.

### 6.4 File format (Decision 13)
- **Primary: `.nodge.json`** — the whole graph serialized as JSON with `schemaVersion`. Human-readable, diffable, git-friendly, and **the same shape as the REST/sync DTOs**, so the file format and the future server payload converge.
- **Secondary: `.sqlite` export** — raw DB bytes for exact full-fidelity backup.
- **Import** accepts either. JSON import **loads into the live SQLite runtime** (validating + migrating older `schemaVersion`s first); `.sqlite` import swaps the DB file.
- Autosave: the OPFS-backed SQLite *is* the durable local store; explicit "Save to file" produces a downloadable `.nodge.json`. A lightweight localStorage pointer records the active graph + recovery metadata.

`NodgeDocument` (JSON) shape:
```jsonc
{
  "schemaVersion": 1,
  "graph": { "id": "…", "name": "…", … },
  "entities": [ … ], "relationships": [ … ],
  "prototypes": [ … ],
  "boards": [ { "id": "…", "nodes": [ … ], "edges": [ … ],
                "views": [ { "id": "…", "paletteId": "…", "filter": …,
                             "positions": [ { "nodeId": "…", "x": 0, "y": 0 } ] } ] } ],
  "palettes": [ … ], "styleProfiles": [ … ]
}
```

### 6.5 Migrations
- JSON: a numbered migration chain keyed on `schemaVersion` runs on import.
- SQLite: a `PRAGMA user_version`-gated migration runner on DB open.

### 6.6 Toward a server (Phase 6, future)
- Implement `HttpGateway` against the same interface; OR a **Service Worker** that intercepts `fetch('/api/...')` and serves from SQLite — making the local app indistinguishable from a real backend, then flipping to a real one by changing the base URL.
- The oplog (if enabled) becomes the sync protocol: push unsynced events, pull remote events, resolve by version. CRDT is a later option if true concurrent multi-user editing is needed.

---

## 7. Multi-View & Subgraphs (Decision 5)

A **hybrid three-tier** model:

```
Graph (base truth: entities + relationships)
  └── Board  (a curated subgraph: which entities/relationships are placed)
        ├── Node (placement of an entity)  ├── Edge (placement of a relationship)
        └── View (presentation of the board)
              ├── per-view NodePositions   ├── applied Palette
              └── optional Filter/Focus lens
```

### 7.1 Boards = subgraph membership
- A board materializes a chosen subset of entities (as nodes) and relationships (as edges). The **same entity can be placed on many boards** → "the same component connected in different subgraphs."
- Adding a node either places an existing entity or creates a new one (§9.4). Removing a node from a board does **not** delete the underlying entity (it still exists in the base graph and possibly on other boards).

### 7.2 Views = presentation of a board
- Each board has ≥1 view. A view stores: **per-view node positions** (so the same node can sit differently across views — like site's `NodePosition` per `DiagramView`), the active **palette**, the **viewport** (pan/zoom), and an optional **filter/focus** lens.
- **Filter/focus lens** (optional): show only nodes matching a tag/prototype, or only nodes within *N* hops of a focus node. This yields instant ad-hoc subgraphs *within* a board without re-curating membership.

### 7.3 Two complementary subgraph workflows
- **Deliberate subgraph** → make a new **Board** with chosen membership.
- **Filtered lens** → add a **View** with a filter/focus on an existing board.

### 7.4 Cross-reference index (the connective tissue)
A derived, always-available index answering, for any entity or relationship:
- every **node/edge** that places it, and on which **boards/views**;
- every **relationship** an entity participates in (across all boards);
- backlinks from `kind: 'entity' | 'diagram'` external links.

Surfaced as a "Used in / Connections" panel and as drill-down navigation. This is what guarantees *all connections trace back to base entities* no matter how many subgraphs/views exist.

---

## 8. Styling & Palette System

### 8.1 Origin (Decision 6)
Nodge-native, **iux-inspired**: we build our own semantic **token contract** and palette set, borrowing iux's *structure* (a complete token contract, CSS-variable application via a `PaletteRoot` boundary, and engine-level effects beyond color) without importing iux's code. This keeps nodge standalone while delivering iux-grade richness.

### 8.2 Token contract (beyond color)
The nodge token contract covers, at minimum:
- **Color:** `surface` (canvas/base/raised/sunken), `content` (text primary/secondary/muted/inverse), `border` (subtle/default/strong/focus), `intent` ramp (primary/neutral/success/warning/danger/info, each with bg/content/border/hover/active), plus an **accent ramp** for node categorization.
- **Geometry:** `space`, `radius`, `borderWidth`.
- **Stroke/pattern:** border styles (solid/dashed/dotted/double), **background patterns** (none/dots/grid/hatch/diagonal), node **shapes** (rect/rounded/pill/ellipse/diamond).
- **Typography:** family + role scale (display/title/heading/body/label/caption/code).
- **Elevation:** flat/low/medium/high/overlay shadows.
- **Effects (engine-level):** a curated subset of iux-style engines — e.g. sketch wobble, CRT/phosphor, glass blur, pixel grid — applied at the `PaletteRoot` boundary for whole-canvas looks.

Palettes are validated (shape completeness + WCAG contrast on intent/content pairs), echoing iux's validators.

### 8.3 Style resolution: token-referenced cascade (Decision 7)
A style value is **by default a reference to a semantic token**, resolved through this cascade (later wins):

```
active View's Palette  →  Entity's Prototype style  →  Entity.styleOverride
                       →  Node.styleOverride
```
(Edges: `Palette → RelationshipPrototype → Relationship.styleOverride → Edge.styleOverride`.)

- Because values reference tokens, **swapping a view's palette re-skins everything not pinned**.
- Any value can be **pinned** to a raw literal (`#ff0000`, `2px`) as an escape hatch. The editor shows a **link/unlink** affordance per control so "follows palette" vs "pinned" is always legible.
- `StyleProfile`s are named bundles that prototypes/entities/nodes can reference for a shared "look."

### 8.4 Palette scopes & authoring (Decision 8)
Two independent `PaletteRoot` boundaries:
1. **App-chrome palette** — themes toolbars, panels, dialogs (stored in app settings).
2. **Per-view canvas palette** — each view wraps its canvas in its own `PaletteRoot`; two views of one board can look entirely different.

Both draw from a **palette library** in SQLite: built-ins seeded at first run + user-created palettes. A **palette editor** lets users duplicate a palette, tweak tokens (color/border/pattern/effect), name it, and assign it. Palettes export/import with the project.

**Phasing:** per-view palette **selection** + built-in library land first (Phase 3); the full token-level **palette editor** and **app-chrome theming** are a fast-follow (Phase 4) behind the same machinery.

---

## 9. Prototypes, Identity & Creation Flows

### 9.1 Prototypes are first-class types (Decision 9, 12)
- `NodePrototype` — a reusable **template/type** for entities: default StyleProfile/look, default **shape**, starting **label/placeholder**, default **metadata**, and typed-**link scaffolding**.
- `RelationshipPrototype` — a relationship **type** (e.g. "depends on", "calls", "flows to"): default edge style, default label, directionality.
- Stored in the SQLite prototype library, reusable across boards, exported with the project. A few **built-in prototypes** are seeded so the tool is useful on first run.
- **Authoring:** `Save as prototype` from any selected node/edge snapshots its style + metadata into a new template. Prototypes can be **duplicated** to fork a new type.

### 9.2 Entity↔Prototype link: seed + manual refresh (Decision 11)
- An entity links to a prototype via `prototypeId`. On creation, the prototype **seeds** the entity's style + metadata. 
- **No auto-propagation:** later edits to a prototype do **not** automatically change existing entities/nodes.
- The link **persists** and enables an explicit, opt-in **"Refresh from prototype"** — applied per node/entity or as a **batch** ("update all nodes of prototype X to its current style"). Never automatic.
- The prototype link also serves as a **grouping key** (select/refresh/filter "everything of type X").

### 9.3 Copy / paste (Decision 10)
- **Node copy/paste = always another placement of the same entity.** Pasting a node creates a new `Node` referencing the **same** `Entity` — never forks identity. Entity-level edits keep converging on one canonical thing.
- **Multi-select copy** captures a subgraph (selected nodes + internal edges) and re-places them (still same entities) — with **clipboard JSON** for cross-document paste.
- To get a *new* thing, you don't "duplicate a node" — you **create a new entity** (optionally from a prototype) via the create flow below, or **duplicate a prototype** to fork a type.

### 9.4 Quick edge-drop creation ("drag to create")
The fast prototyping flow, especially on touch. Dragging an edge from a node into empty space (React Flow `onConnectEnd`) opens a **quick-picker** with two paths:

1. **Use an existing entity** → place a **new node** for a chosen existing entity; it inherits *that entity's* prototype/style. The dragged edge becomes a new relationship+edge placement.
2. **Create a new entity** → enter a **name** + pick the **prototype to link**; creates entity (seeded from the prototype) + node + the connecting relationship/edge.

The picker supports **recents / favorites / search** so common prototypes and entities are one tap. On mobile it's a bottom sheet.

---

## 10. UI / UX & Mobile (Decision 14)

A **single responsive app** with a deliberate touch interaction model — mobile is first-class, not a CSS afterthought.

### 10.1 Layout
- **Canvas-first.** React Flow canvas fills the viewport; chrome is minimal and edge-anchored.
- **Desktop:** collapsible side panels (properties, prototype library, cross-reference, palette).
- **Mobile:** **bottom-sheet** panels that slide up over the bottom edge, leaving the canvas visible; a **thumb-reach bottom toolbar**; a **FAB** for add-node.

### 10.2 Touch interaction model (mode-less)
The canvas is **mode-less** — there is no Select / Connect / Add tool switch. Gestures disambiguate by *what you touch and how*, so "draw an edge" never fights "pan" without a mode toggle to remember:

- **Tap** a node/edge = **select** it (single). **Double-tap** a node/edge = **add/remove** it from the current selection (touch parity with ⌘/ctrl-click). Tap empty canvas = deselect.
- **Drag a node** = **move** it. **Drag from a node's handle** = **connect**; dragging a connection into empty canvas opens the drag-to-create prototype picker (§9.4).
- **Long-press then drag** on empty canvas = **marquee** multi-select (hold ~380 ms, then drag a box).
- **One-finger drag** on empty canvas = **pan**; **pinch** = **zoom**.
- **Adding a node** is an explicit action — the dock's **Add** button — which opens the entity picker (§9 / D6) and drops the node in the current view.

Because React Flow decides pan-vs-select at pointer-down (and its pan can't be interrupted mid-gesture), the editor **owns the pane pointer gestures itself** (`panOnDrag`/`selectionOnDrag` off): one code path detects the long-press to split pan from marquee and drives the viewport/selection directly. This is the single seam guaranteeing the gestures never conflict.

- **Big touch targets:** ≥44px hit areas; enlarged connect affordances appear on the selected node; handles are finger-sized, not hover-tiny.
- **Bottom-sheet editing** for node/edge/prototype/palette properties; swipe to dismiss.

### 10.3 Core editor features (across phases)
- Pan/zoom, minimap (toggle), snap-to-grid (optional), multi-select, marquee.
- **Selection is always legible:** a selected node/edge is visibly marked; the dock's Copy/Delete reflect whether anything is selected.
- **Delete selection** — a dock action (and Delete/Backspace on desktop) removes the selected node/edge placements in one undoable command; deleting a node drops its incident edges but never the base entity/relationship (§7.1).
- **Undo/redo** (from the command layer), keyboard shortcuts on desktop.
- **Auto-layout** (Dagre-style hierarchical) producing/updating a view's positions.
- Node/edge property panels with the **link/unlink** (token vs pinned) affordance.
- **Cross-reference / "Used in"** panel and drill-down navigation.
- Prototype library browser; palette switcher (per view) + palette editor (Phase 4).
- Optional **Mermaid/text export** of a board (nice-to-have, later).

### 10.4 Accessibility
- Keyboard navigation for node/edge selection and editing; focus-visible rings from the palette's `border.focus`.
- Contrast-validated palettes (intent/content pairs meet WCAG AA, mirroring iux's contrast lint).
- Respect `prefers-reduced-motion` for engine effects/animated edges.

---

## 11. Tech Stack & Dependencies

| Concern | Choice | Notes |
|---------|--------|-------|
| App | Vite + React 18 + TypeScript (strict) | existing scaffold |
| Canvas | **`@xyflow/react`** (React Flow) | same as site; nodes/edges/handles/minimap/pan-zoom |
| Local DB | **SQLite-WASM** (`wa-sqlite` or official SQLite WASM) + **OPFS** | runs in a Web Worker |
| Server state/cache | **React Query** | wraps the gateway |
| Client/UI state | lightweight store (**Zustand**) | selection, open bottom sheet, transient canvas state |
| Routing | **React Router** | graphs / boards / views URLs |
| Forms | React Hook Form (panels) | |
| IDs | UUID v4 (client) | |
| Styling | CSS variables via `PaletteRoot` + token contract | nodge-native |
| Testing | Vitest + React Testing Library (unit/integration); Playwright (smoke/E2E) | mirror the pre-push gate |
| Tooling | pnpm, ESLint, Husky pre-push (`typecheck → lint → test → build`) | existing |

> Bundle note: SQLite-WASM (~0.5–1 MB) is the heaviest dependency; load it from the worker and lazy-init so first paint isn't blocked.

---

## 12. Waterfall Phase Plan (Decision 15)

**Strategy:** thin vertical slice first, then layer. Each phase is independently shippable and ends green on the pre-push gate (typecheck/lint/test/build) plus its own acceptance criteria.

### Phase 0 — Foundations
**Goal:** the data spine, no rich UI.
- Add deps (`@xyflow/react`, SQLite-WASM, React Query, Zustand, React Router, uuid).
- Author the **single model definition**; generate SQLite DDL + JSON DTOs + TS types.
- Build `DataGateway` interface + `LocalGateway` (SQLite-WASM in a Worker, OPFS persistence).
- Build the **command layer** (UUID/version/updatedAt, undo/redo scaffold).
- JSON **import/export** (`NodgeDocument`) + `.sqlite` export; migration runner.
- **Acceptance:** unit tests create a graph/entity/node via the gateway, persist to OPFS, export JSON, re-import into a fresh DB, and round-trip identically.

### Phase 1 — Core editor (the simplest-path MVP)
**Goal:** draw, persist, save/load — end to end.
- One board, one view, React Flow canvas.
- Create/move/connect nodes; base Entity/Relationship created behind node/edge placements.
- Basic **token-referenced styling** on a single default palette (color/border/shape).
- **Autosave** to OPFS + **Save/Load `.nodge.json`**.
- Responsive shell (desktop + usable mobile baseline).
- **Acceptance:** create a small diagram, reload the page (state restored from OPFS), export a file, import it elsewhere, see the same diagram. Playwright smoke: page loads, no console errors, can add+connect two nodes.

### Phase 2 — Identity & reuse
- **Prototype library** (node + relationship) with built-ins; `Save as prototype`; duplicate prototype.
- Entity↔prototype **seed + manual/batch refresh**.
- **Drag-to-create** quick-picker (existing entity vs new entity+prototype).
- Copy/paste = **placement**; multi-select subgraph copy; clipboard JSON.
- **Typed links + metadata** editing; **cross-reference / "Used in"** panel.
- **Acceptance:** a node placed on two ways traces to one entity; editing the entity updates both; refresh-from-prototype updates a batch; cross-reference lists all placements.

### Phase 3 — Multi-view / subgraphs
- Multiple **boards** (subgraph membership) + multiple **views** per board.
- Per-view **positions**, viewport, **filter/focus** lens.
- **Per-view palette selection** + built-in palette **library**.
- Subgraph **drill-down** via `diagram`/`entity` links.
- **Acceptance:** the same entity appears on two boards; a filtered view shows a hops-from-focus subgraph; switching a view's palette re-skins it; all connections still resolve to base entities.

### Phase 4 — Styling depth & palettes
- Full nodge **token contract** + richer style types (patterns/shapes/elevation/engine effects).
- **Palette editor** (token-level authoring) + **app-chrome theming**.
- **StyleProfile** management UI; pin/unlink affordances everywhere.
- Palette contrast/shape **validators**.
- **Acceptance:** user creates a custom palette, applies it to a view and the app chrome, pins one node's color and confirms it survives a palette swap.

### Phase 5 — Mobile polish & UX
- Full **touch model** (mode-less gestures, big targets, bottom sheets, FAB).
- Responsive refinement, accessibility pass, `prefers-reduced-motion`.
- **Large-graph performance** (virtualization, worker offload, lazy effects).
- **Acceptance:** core flows (add/connect/style/switch view/save) are smooth on a phone; Playwright mobile-viewport smoke passes; no gesture conflicts.

### Phase 6 — Server-sync readiness (future)
- `HttpGateway` (and/or Service Worker mock) against the same interface.
- Push/pull **sync** by version/updatedAt; conflict policy (LWW), optional **oplog** upgrade.
- **Acceptance:** with a mock server, a second device pulls a graph, edits, and pushes; changes reconcile without ID collisions.

---

## 13. Testing Strategy

Mirrors the repo's existing rigor and pre-push gate.
- **Unit/integration (Vitest + RTL):** the gateway against an in-memory SQLite, command layer (undo/redo, version stamping), JSON round-trip + migrations, style cascade resolution, cross-reference index, drag-to-create logic.
- **Component tests:** panels, prototype picker, palette switcher, link/unlink behavior.
- **E2E/smoke (Playwright):** page loads without console errors; add/connect/style/save/reload; mobile-viewport gesture flows.
- **Validators:** palette shape + WCAG contrast (CI check), schema/DTO/type consistency from the single model definition.
- TDD where practical; every new user-facing surface gets a smoke test (consistent with the sibling repos' conventions).

---

## 14. Open Questions / Future Considerations
- **Oplog vs. LWW** for real collaboration — deferred to Phase 6; the command-layer seam keeps it additive.
- **Service Worker mock vs. HttpGateway** — decide when a real server target exists; both fit the same interface.
- **Mermaid/text import-export** — nice-to-have, unscheduled.
- **Shared package extraction** of the palette system (to share with iux) — possible later since the token contract is structurally iux-compatible; not pursued now (standalone-first).
- **Site interop** — `kind: 'record'` links lay groundwork for referencing site records; a concrete integration is out of scope until the server phase.

---

## 15. Summary

nodge is a **two-layer, SQLite-WASM-backed, palette-rich, mobile-first** flow diagram editor that ships value on the simplest path (draw → autosave → save file) while being architected — via a REST-shaped gateway, client UUIDs, a command layer, and JSON-as-sync-payload — so a real server is a later drop-in, not a rewrite. The base-entity/relationship layer guarantees every drawing across every subgraph and view traces back to one canonical thing; prototypes make typed, styled, metadata-rich nodes fast to stamp; and the nodge-native, iux-inspired token system makes the whole app — and each view — restyleable. The build proceeds as a thin vertical slice, then layers identity, multi-view, styling depth, and mobile polish in independently shippable phases.
