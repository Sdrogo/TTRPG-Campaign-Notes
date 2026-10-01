## Goals

- Show and edit the Notes of a Document in the UI, on top of the API from `12_1 - Note backend effort.md` (spec `12 - add Notes to Documents.md`).
- Start only after 12_1 is merged and its migration is applied to the live DB.

## Design

- **A Note appears as an additional paragraph of the Document description** on the Document detail page: the description first, then each visible Note below it, in the order the API returns. A Note shows its title (as a small heading), its description and, to whoever can edit it, its `VisibilityBadge`.
- **A Note hidden from the viewer is completely absent from the UI**: no placeholder, no empty section, no count, no "N hidden notes". The frontend renders exactly what the API returns and does no visibility filtering of its own (the backend filters, Invariant 1/2). A Document with no visible Notes looks as it does today.
- Notes are not shown on the `DocumentCard` (the list response does not carry them).
- Note descriptions use the **same `#` logic as the Document description**: render with `MentionText` (Documents and Tags resolved at render time against the viewer's own visible list, so a mention of a hidden Document stays plain text and reveals nothing, VR-07) and edit with `MentionTextarea` (the `#` popup, including create-Tag / create-Document). Do not write a second mentions implementation.
- The controls are offered only where the API says so, using `can_edit` / `can_delete` per Note. The "add Note" action appears for Owners and the Master (`lib/roomPermissions.ts`, same rule as editing the description).

## Implementation

- Create a new branch from `origin/main` (`feature/12-2-notes-frontend`).
- **Data**: add the `Note` type and the API functions to the existing API layer; `useNotes`-style TanStack Query hooks or, since Notes arrive embedded in the Document detail, mutations that update that cached Document (create, edit, delete, reorder). Follow how the Comments hooks are built and invalidated.
- **Components** (new folder `components/notes/`, small and reusable): `NoteList` (renders the Notes and the add action), `NoteItem` (view mode, with the edit/delete buttons), `NoteForm` (title + `MentionTextarea` description + `VisibilitySelect` + Selective grants through `MemberMultiSelect`, reused as the Document edit already does). Reuse `DocumentFields` pieces rather than duplicating the field markup.
- **Editing**: inline on the detail page, like the Document fields. Saving shows the usual loading and error notification; deleting asks for confirmation (same modal pattern as Document deletion). Title required; the description limit matches the Document's and the form uses the shared `tooLong` helper.
- **Reordering** (only if kept in 12_1): up/down buttons like `MainTagsEditor`, one Save.
- **i18n**: every string in `src/i18n/locales/{it,en}.json` (`notes.*`); `locales.test.ts` and the typed `t()` keys must pass. No UI literals.
- **UI conventions**: follow `context/ui-context.md` (theme tokens, Phosphor `*Icon` exports, Mantine v9 `gap` not `gutter`); layout must work below `sm` and the detail page's image column on `lg`+.
- JSDoc on every exported symbol.
- **Tests are part of the effort, coverage stays at exactly 100%**: render with zero, one and many Notes; hidden Note simply not in the DOM (mock an API response without it and assert nothing about it is shown); mentions resolve in a Note and a hidden-Document mention stays plain text; add / edit / delete / cancel flows; buttons absent when `can_edit` is false; error and loading states; both languages.
- Browser check of the detail page as Master, Owner and plain member (the UI checks of earlier specs were never seen running; do this one, and kill any leftover Vite dev server by PID afterwards, a stray one on 5174 breaks CORS).

## Definition of Done

- Notes display as paragraphs under the Document description, are editable by those allowed, and hidden Notes leave no trace in the UI.
- Mentions in a Note behave exactly as in the Document description.
- Technical and project documentation is updated: `progress-tracker.md` (completed unit), `ui-context.md` if a new component convention is introduced, `architecture.md` only if the client-side flow changes.
- `npm run lint`, `npm run build` (type-check) and `npm test` with coverage pass locally and on CI; the backend is untouched in this PR.
- Git commit, push and PR are part of the task, presented as a link to finish the job.
