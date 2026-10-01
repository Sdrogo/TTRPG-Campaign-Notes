# Frontend

The React single-page app for TTRPG Campaign Notes. It talks only to the
backend API; it never reaches Postgres or Storage directly. Overview of the
whole project: [../README.md](../README.md).

## Stack

React 19, Vite, TypeScript (strict), Mantine v9 for UI, TanStack Query for
server state, React Router, `react-i18next` (Italian and English), Supabase JS
for sign-in only, Phosphor icons, Oxlint. Tests use Vitest and React Testing
Library.

## Setup

```bash
npm ci
cp .env.example .env
npm run dev          # http://localhost:5173
```

| Variable | Meaning |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (public) key |
| `VITE_API_BASE_URL` | Backend URL, `http://localhost:8000` locally |

The backend must run too, and must allow this origin (its default CORS origin is
`http://localhost:5173`). If Vite starts on another port the API calls fail CORS,
so stop any leftover dev server first.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | `tsc -b` then the production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Oxlint |
| `npm test` | Run the tests once |
| `npm run test:coverage` | Tests with coverage; fails below 100% on every metric |

## Layout (`src/`)

| Folder | Contents |
| --- | --- |
| `pages/` | One component per route |
| `components/` | Shared UI, with sub-folders per area (`account`, `comments`, `mentions`, `notes`, `setup`) |
| `hooks/` | TanStack Query hooks for the API, plus `useSession` |
| `lib/` | Pure helpers (API client, grouping, filtering, permissions) |
| `types/` | API response types |
| `i18n/` | Setup and `locales/it.json` / `en.json` |
| `theme/` | Mantine theme and CSS tokens |

## Conventions

- **No hardcoded UI text.** Every visible string goes through `t()` and must be
  added to both locale files; `it.json` is the typed source.
- **The UI shows what the API sends.** Visibility is decided by the backend; the
  frontend never filters hidden content itself.
- Query the way a user finds things in tests (role and accessible name), and
  keep every module at 100% coverage. Tests live in `src/test/`, mirroring the
  `src/` folders.

Full rules: [../context/code-standards.md](../context/code-standards.md) and
[../context/ui-context.md](../context/ui-context.md).

## Deployment

Deployed on Vercel. `vercel.json` rewrites every path to `index.html` so deep
links work with client-side routing. The three `VITE_` variables are set in the
Vercel project settings.
