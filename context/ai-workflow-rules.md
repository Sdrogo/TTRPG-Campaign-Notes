# AI Workflow Rules

## Approach

Build this project incrementally using a spec-driven workflow. The
`context/` files define what to build (`project-overview.md`,
`requirements.md`), how to build it (`architecture.md`,
`ui-context.md`, `code-standards.md`), and the current state of
progress (`progress-tracker.md`). Always implement against these
specs — do not infer or invent product behavior, visibility rules,
or role permissions from scratch; `requirements.md` is the source of
truth for every `D-`, `FR-`, `UC-`, `VR-`, and `I-` reference used
elsewhere in `context/`.

Repository layout is a single mono-repo: `/frontend`, `/backend`,
`/context` at the root (see `architecture.md` → System Boundaries).

## Scoping Rules

- Work on one feature unit at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated system boundaries in a single
  implementation step (e.g. a `frontend/` change and a `backend/`
  change ship as separate steps, even when they support the same
  feature, unless the feature is genuinely unusable split that way —
  in which case say so before starting rather than mid-implementation).

## When to Split Work

Split an implementation step if it combines:

- Frontend UI work and backend API/domain work for anything beyond
  the thinnest possible vertical slice (e.g. "add the Reveal button"
  is separate from "add the Reveal endpoint and its AuditLog write").
- Multiple unrelated API routes or domain modules (e.g. Document
  CRUD and Thread/Post logic are different units, even if both touch
  the same Document).
- Any behavior not clearly defined in `requirements.md` or
  `architecture.md` — implementing past an open question (section 6
  of `requirements.md`, or the "Open items" in `architecture.md`)
  without resolving it first is a scope violation, not a shortcut.
- Changes to more than one context file's domain at once (e.g. a
  step that both changes the data model and restyles a component) —
  split so each step's `git diff` maps to one concern.

If a change cannot be verified end to end quickly, the scope is too
broad — split it.

## Handling Missing Requirements

- Do not invent product behavior not defined in the context files —
  this applies especially to visibility rules (`VR-`) and role
  permissions, where a wrong guess is a security bug, not a cosmetic
  one.
- If a requirement is ambiguous, resolve it in the relevant context
  file (usually `requirements.md`, since it owns the `D-`/`OQ-`
  numbering) before implementing against it.
- If a requirement is missing, add it as an open question in
  `progress-tracker.md`'s Open Questions section before continuing,
  and prefer stopping to ask over guessing when the gap concerns
  auth, ownership, or visibility (Invariants 1–7 in `architecture.md`).

## Protected Files

Do not modify the following unless explicitly instructed:

- `frontend/src/components/ui/*` (or wherever Mantine-generated /
  vendored primitives end up) — treat as generated, wrap rather than
  edit in place.
- `context/requirements.md` — this is the negotiated product spec; a
  code-driven change to it (rather than a product conversation) is
  out of bounds. Propose an addition to Open Questions instead.
- Any third-party library internals (`node_modules`, installed
  Python packages).
- Supabase-generated migration/type files — regenerate, don't hand-edit.

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes:

- System architecture or boundaries → `architecture.md`
- Storage model decisions → `architecture.md`
- Code conventions or standards → `code-standards.md`
- Visual/theming decisions → `ui-context.md`
- Feature scope → `project-overview.md` and, if it resolves or
  raises a `D-`/`OQ-`, `requirements.md`

## Before Moving to the Next Unit

1. The current unit works end to end within its defined scope.
2. No invariant defined in `architecture.md` was violated.
3. `progress-tracker.md` reflects the completed work.
4. Frontend build and unit tests pass (`npm run build` and `npm test`
   in `frontend/`) and backend
   checks pass (tests + type check in `backend/`).
