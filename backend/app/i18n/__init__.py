"""Backend message localization (spec 09_1): every user-facing string the
API returns is a key into `locales/*.json`, rendered for the caller's
locale by `translate`. Mirrors the shape of the frontend's own
`frontend/src/i18n/locales/*.json` (spec 09) so both halves read the same
way, though the two are otherwise independent - the frontend still only
shows the raw `detail` text it receives (see `architecture.md` -> UI
Language)."""
