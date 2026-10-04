## Application Building Context

Read the following files in order before implementing
or making any architectural decision:

1. `context/project-overview.md` — product definition,
   goals, features, and scope
2. `context/architecture.md` — system structure,
   boundaries, storage model, and invariants
3. `context/ui-context.md` — theme, colors, typography,
   and component conventions
4. `context/code-standards.md` — implementation rules
   and conventions
5. `context/ai-workflow-rules.md` — development workflow,
   scoping rules, and delivery approach
6. `context/progress-tracker.md` — current phase,
   completed work, open questions, and next steps

The full product spec with stable IDs (`D-`, `FR-`, `UC-`,
`VR-`, `I-`, `OQ-`) referenced throughout the files above
lives in `context/requirements.md`.

Update `context/progress-tracker.md` after each
meaningful implementation change.

If implementation changes the architecture, scope, or
standards documented in the context files, update the
relevant file before continuing.

## Environment files

Plain `.env` files (`backend/.env`, `frontend/.env`) hold
**production** values; `.env.staging` and `.env.dev` hold staging
and dev values. Never assume `.env` is safe to use for dev or
staging, never repoint it, and use the matching file when working
against another environment. The backend and Vite only read
`.env` on their own: see `context/architecture.md` → Local env
files for how to load the others.
