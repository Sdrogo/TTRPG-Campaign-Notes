## Goals

- Product owner's request (2026-10-12): add UI support for **German, French, Spanish, Portuguese, Japanese, Chinese and Russian**, and recommend other good languages.
- The i18n machinery already exists (spec 09, 09_1): this ticket is mostly translation plus the pieces that were fine for two languages and are not for ten (bundle size, regional variants, plural rules, PDF fonts, language picker).
- **Status: scope confirmed by the product owner, 2026-10-12** (answers under "Decisions taken" at the end). Languages in this round: `de`, `fr`, `es`, `pt-PT`, `ru`, `ja`, `zh-Hans`, `ko`, `pl`, `nl`. Turkish and Traditional Chinese are not in this round.

## What exists today (inspected 2026-10-12)

- **Frontend**: `react-i18next`, `src/i18n/locales/{it,en}.json` (931 lines each, ~900 strings), keys type-checked against `it.json` (`i18next.d.ts`), `locales.test.ts` requires identical keys and placeholders. Both files are bundled (`initAsync: false`). `detectLanguage` takes the stored pick (`localStorage` `ttrpg.language`), else the first `navigator.languages` entry whose **base subtag** (`tag.split('-')[0]`) is supported, else English.
- **Backend**: `app/i18n/locales/{en,it}.json` (235 lines each), `SUPPORTED_LOCALES = ("en", "it")`, `Accept-Language` parsed by `get_locale`, again reduced to the base subtag. The Room PDF's fixed texts (`pdf.*`) and the page `lang` come from the same files.
- **Language picker**: `LanguageSelector`, one flag per language (`LANGUAGE_FLAGS`, SVG in `src/assets/flags/`), each language listed by its own name.
- **Other language-aware code**: `Intl` formatters for dates, relative times and sorting (`currentLanguage()`); the emoji picker's labels (`lib/emojiPicker.ts`, only `it` and `en` loaded); read-aloud voices (`lib/speech.ts`, BCP 47 tag per language); the Markdown export is English whatever the UI language.
- **Not translated by design**: user content (Document names, Comments…).
- Adding a language is documented as "new JSON file + entry in `SUPPORTED_LANGUAGES`/`resources` + a flag". That holds for Italian-to-English-like cases; the sections below list what breaks beyond that.

## Recommended languages

The seven requested languages, plus these. Ordered by how well they fit a TTRPG note-taking app, not by speaker count alone.

| Language | Why | Cost / caveat |
| --- | --- | --- |
| **Korean** (`ko`) | Large, very online TTRPG and Discord-driven community; needs the same CJK font work as Japanese and Chinese, so it is nearly free once those are done. | Hangul in the PDF fonts; no plural forms. |
| **Polish** (`pl`) | One of the largest tabletop communities in Europe (strong D&D, Warhammer and Cthulhu scene), plenty of published translations. | Latin script, easy; 4 plural forms (`one/few/many/other`). |
| **Dutch** (`nl`) | Small effort, tech-savvy and active hobby scene. | Latin script only. |
| **Turkish** (`tr`), *not in this round* | Big and growing TTRPG audience, mostly underserved by tools. | Dotted/dotless `i`: check search normalization (`unaccent` and lowercasing, see Search below). |
| **Traditional Chinese** (`zh-Hant`), *later* | Taiwan and Hong Kong are active TTRPG markets and do not read Simplified comfortably. | A second Chinese file and a second font; could be a later pass. |
| Czech, Swedish, Ukrainian, Indonesian | Reasonable follow-ups once the pipeline exists. | Ukrainian reuses the Cyrillic work. |
| **Arabic, Hebrew** | Real demand, but they need right-to-left layout, which is a UI project of its own (below). | **Not recommended in this ticket.** |

**Proposed order** (each step shippable on its own):

1. **34_1 Foundations**: no new language, everything below under "Approach" that is infrastructure.
2. **34_2 Western Europe and Russia**: `de`, `fr`, `es`, `pt-PT`, `ru`, `pl`, `nl`.
3. **34_3 East Asia**: `ja`, `zh-Hans`, `ko`, with the PDF fonts. `zh-Hant` later, not in this round.

## Decisions (proposed, confirm in the PR)

1. **Library stays**: `i18next` + `react-i18next` and the existing resource-file shape. No switch of tool.
2. **Language codes are BCP 47 tags** where the base language is not enough: `zh-Hans`, `pt-PT`. Everything else is the bare two-letter code (`de`, `fr`, …). The same codes name the backend files.
3. **Portuguese is European** (`pt-PT`, product owner's choice). Browser tags `pt` and `pt-PT` map to it; `pt-BR` too until a Brazilian file exists (Brazilian readers understand it; a `pt-BR` file is a later option).
4. **Spanish is neutral Latin-American/Castilian-safe wording** (`es`), avoiding voseo and regional slang; `es-419` is not a separate file.
5. **Chinese**: `zh-CN`, `zh-SG` and `zh` map to `zh-Hans`; `zh-TW`, `zh-HK`, `zh-MO` and any `*-Hant` map to `zh-Hant` once that file exists; until then they map to `zh-Hans`.
6. **Lazy-loaded languages**: only the active language's JSON is fetched (a dynamic `import()` per language, Vite splits them). Italian and English stay bundled as today (English is the fallback), so the first render of an `it`/`en` visitor is unchanged. For any other language `main.tsx` waits for that one file before the first render, so nothing flashes in the wrong language. A pick from the selector loads the file, then switches. At about 26 kB gzipped per pair of languages today, bundling ten would cost about 130 kB gzipped for nothing.
7. **Language switcher keeps the flag + own-name menu**, but flags are ambiguous (Spanish, Portuguese, Chinese, English: which country?). Default: keep them, using one flag per language (de DE, fr FR, es ES, pt PT, ja JP, zh-Hans CN, ru RU, ko KR, pl PL, nl NL, en GB, it IT), and list the languages **alphabetically by their own name** with a scroll when the menu is long. See Open Question 3.
8. **Preference storage**: unchanged (`localStorage`, `ttrpg.language`), no migration. See Open Question 4 for a per-account setting.
9. **Translation sourcing**: Claude drafts every file from `it.json`/`en.json` with a fixed **glossary per language** for the app's own terms (Room, Document, Note, Tag, Comment, Reveal, Master, Player, Administrator, Owner, Character), kept in `context/i18n-glossary.md` so later strings stay consistent; the brand "Ex Libris" and the sign-in provider names are never translated. A native speaker reviews each language before it is listed in the selector (Open Question 1). Languages that are not reviewed yet can ship behind a "beta" label.
10. **The privacy notice (`privacy.*`) is translated like everything else**, but see Open Question 2.
11. **No right-to-left languages in this ticket** (Arabic, Hebrew, Persian). `dir` stays `ltr`.

## Approach

### 1. Frontend (34_1)

- `SUPPORTED_LANGUAGES` becomes the full list; `LANGUAGE_FLAGS` gets one SVG per language.
- **Resolve a browser tag to a language** with a small table (`resolveLanguage(tag)`), replacing `tag.split('-')[0]`, so Decisions 3 and 5 hold; unit-tested with `pt-BR`, `zh-TW`, `zh-Hant-HK`, `en-AU`, unknown tags.
- **`setLanguage`/init load the resource first** (Decision 6), with a failure path: if the file can't be fetched, keep the current language and show a notification.
- **Plurals**: i18next uses `Intl.PluralRules`, so `_one/_other` already works; Russian and Polish need `_few` and `_many`, and Japanese, Chinese and Korean need only `_other`. **`locales.test.ts` must change**: it now demands the same key set in every language, so it compares keys modulo the plural suffix and checks that each plural key has exactly the forms `Intl.PluralRules(lang).resolvedOptions().pluralCategories` lists. `i18next.d.ts` stays typed against `it.json`.
- **Formatting** already goes through `currentLanguage()`; add the new codes to anything that maps a language to a locale (`speech.ts` BCP 47 tag, `emojiPicker.ts` labels: emoji-mart ships i18n data for all the languages above).
- **Typography**: add CJK and Cyrillic fallbacks to the app's font stack (system fonts are enough on screen); check long German words and Russian text in narrow cards, buttons and the compact layout at phone width (German and Russian run 20 to 30% longer than English). Japanese and Chinese have no spaces: Mantine components that rely on word breaks use `overflow-wrap: anywhere` where text can overflow.
- `<html lang>` follows the language already; for `zh-Hans`/`zh-Hant` it sets the right script, which also selects the right Han glyphs in the browser.

### 2. Backend (34_1)

- `SUPPORTED_LOCALES` gains the new codes; files are named by code (`zh-Hans.json`, `pt-PT.json`).
- **`get_locale` stops reducing every tag to its base subtag**: it matches the full tag first, then the table of Decisions 3 and 5, then the base. This must agree with the frontend's `resolveLanguage`, and the frontend already sends the **UI language** as `Accept-Language`, so the frontend sends the exact code (`pt-PT`, `zh-Hans`).
- `tests/test_i18n.py` already checks keys and placeholders against `en.json` per locale; add the plural/format rule where the strings use them.
- **Room PDF fixed texts** (`pdf.*`) are in these files, so translating them is part of each language.
- The Markdown export stays English (a file for tools and Agents).

### 3. Room PDF fonts (34_2 and 34_3)

This is the one part that is real work. The PDF **bundles its fonts and the container installs none** (`Dockerfile`, `app/pdf/fonts/README.md`), and the three families (IM Fell English, Crimson Text, Lato) cover **Latin only**.

- **Latin Extended** (Polish, Turkish, and the accented letters of the other European languages): check glyph coverage of each family for `ł ą ę ğ ş ı İ ő`; a missing glyph silently falls back to another font. Add a test that renders a sample line in each language and fails on a `.notdef`/fallback (inspect with `fontTools`).
- **Cyrillic** (Russian, later Ukrainian): none of the three families has it. Bundle a serif and a sans (OFL): for example **Noto Serif** and **Noto Sans**, or **PT Serif** / **PT Sans**, picking the one that sits best beside Crimson/Lato. Gothic gets its own Cyrillic heading face if one with the right mood exists, otherwise the serif.
- **CJK** (Japanese, Chinese, Korean): bundle subsetted or full **Noto Serif/Sans CJK** per script (JP, SC, TC, KR; OFL). Full fonts are large (about 10 to 20 MB per script and weight), so subset them to the common character sets (`pyftsubset`, JIS X 0208 + Joyo for `ja`, GB 2312 + common for `zh-Hans`, Big5 common for `zh-Hant`, KS X 1001 for `ko`) or install `fonts-noto-cjk` in the image instead (one apt package of about 60 to 100 MB, bigger image, no repo growth). **Default**: subset and bundle, so the PDF never depends on host fonts (the README's rule); fall back to the apt package if the subset misses characters in practice.
- The CSS picks the face with the page language: `:lang(ru)`, `:lang(ja)`, `:lang(zh-Hans)`… set `font-family` (and `font-synthesis: none`, since CJK has no italics and bold is synthesized badly). The page `lang` is already set from the locale (`render.py`); it also decides Han glyph variants.
- **Layout**: the drop cap (Gothic) and the two-column justified body assume Latin. For `ja`/`zh`/`ko` turn the drop cap off and justify with `text-align: justify` + CJK line-breaking (WeasyPrint/Pango handles it); no hyphenation (`hyphens: none`, there is no pyphen dictionary). Hyphenation dictionaries exist for de, fr, es, pt, ru, pl, nl, tr.
- The Gothic style's text is user content; user content in a language the Room's PDF locale doesn't match (an Italian campaign exported from a UI in Japanese) must still render: the font chain includes all the bundled scripts as fallbacks, not only the locale's.

### 4. Search (note, not a blocker)

The Postgres search configuration is `simple` behind `unaccent` (spec 21): no word segmentation. That is fine for the European languages, but **it cannot find a word inside Chinese or Japanese text** (no spaces, so a whole sentence is one token) and Korean only matches whole space-separated words. This concerns the **content** people write, not the UI language, so it is a limit of full-text search rather than of this ticket. Options for a later ticket: `pg_trgm` for substring matching, or `pg_bigm`/`zhparser` where available on Supabase. Also check, with a test, that `unaccent` and lowercasing do what Turkish users expect for `İ`/`ı`, and what it does to Russian `й`/`ё`. Logged as Open Question 5.

### 5. Right-to-left (out of scope, for the record)

Arabic and Hebrew need `dir="rtl"` on `<html>` and the Mantine `DirectionProvider`, logical CSS properties (`margin-inline-start`…) instead of left/right in our own CSS and in the compact layout, mirrored directional icons (arrows, chevrons, thread lines), a mirrored PDF layout (page margins, columns, running headers) and RTL-capable PDF fonts. It touches most components, so it is its own spec with its own review.

## Implementation

- One branch per unit into `staging` (34_1, 34_2, 34_3 above); each language file is a separate commit so a review can go language by language.
- **34_1 Foundations**
  - Frontend: `resolveLanguage`, lazy loading (Decision 6), the plural-aware `locales.test.ts`, the scrollable selector, emoji/speech mappings, tests.
  - Backend: tag matching in `get_locale`, file naming by code, tests.
  - `context/i18n-glossary.md` (empty glossary table plus the rule for adding a language), and the "Adding a language" paragraphs of `architecture.md` and `code-standards.md` rewritten for the new steps.
- **34_2 Western Europe and Russia**
  - Frontend and backend files for each language, flags, glossary entries, Cyrillic PDF fonts and font tests.
- **34_3 East Asia**
  - Same for `ja`, `zh-Hans`, `ko` (then `zh-Hant`); subsetted CJK fonts, PDF CSS per script, a rendering test per language.
- Every unit updates `architecture.md` (UI Language, Room PDF) and `progress-tracker.md`.
- **No migration** (no stored language setting unless Open Question 4 says otherwise).
- Related tracker item: **default Tags in the creator's UI language** (decided 2026-10-03, not built) must have its names in every new language when it is built; build it after 34_1 or include the names in 34_2.

## Open Questions

1. **Who reviews the translations?** Claude can draft them all, but a native read is what makes a TTRPG tool feel right (game terms, tone). Ship unreviewed languages as "beta" in the selector, hold each until a speaker reviews it, or recruit reviewers from the community? *Default: ship as beta.*
2. **Privacy notice and legal text.** The notice is GDPR-relevant and the controller's legal review is still pending (spec 31). Translate it now, or show it in English/Italian only until counsel has approved a text? Which version prevails on conflict? *Default: translate, with a line saying the Italian/English text prevails.*
3. **Flags or not?** Flags stand for countries, not languages. Keep them (default), or switch to the language's own name and a short code (`DE`, `PT-BR`, `繁體`)?
4. **Remember the language per account?** Today it's per browser. With ten languages, a person using several devices will reset it each time. A `language` column on the profile (one small migration) would follow them and could later pick the language of emails. *Default: not now.*
5. **CJK search.** Accept that content search won't find words inside Chinese/Japanese text for now, or add `pg_trgm`-based substring search to this ticket?
6. **Traditional Chinese and Brazilian vs European Portuguese**: only `zh-Hans` and `pt-BR` first (default), or both variants from the start?
7. **Which of the extra languages** (`ko`, `pl`, `nl`, `tr`) go in the first round, and is the order above right? *Default: all of 34_2 and 34_3 as listed, `zh-Hant` later.*
8. **PDF fonts**: subset and bundle (default; repo grows by a few MB per script) or install `fonts-noto-cjk` in the Docker image (no repo growth, bigger image, host-dependent)?

## Definition of Done

- A browser set to any supported language starts the app in it; a pick from the selector wins and survives a reload; a Japanese or Russian pick loads only its own file.
- `pt-BR`, `zh-TW`, `zh-HK` and `en-AU` browsers resolve to `pt-PT`, `zh-Hans` and `en` (tests); `zh-Hant` is not supported yet, so Traditional Chinese browsers get Simplified.
- Every locale file has exactly the keys, placeholders and plural forms its language needs (frontend and backend tests green); no empty string.
- API errors come back in the caller's language, regional tags included.
- Room PDF exports in each language render with no missing glyphs and no fallback boxes, in all three styles; a Japanese or Russian PDF with Italian content still renders.
- Cards, buttons and the compact layout hold the longest language at phone width without clipping.
- Docs updated (`architecture.md`, `code-standards.md`, `progress-tracker.md`, glossary). Checks green.

## Decisions taken (product owner, 2026-10-12)

1. **Translations ship as beta**; no native review for now. The selector marks them "beta".
2. **Privacy notice** translated, with a line saying the Italian/English text prevails.
3. **Flags stay** in the selector.
4. **Language stays per browser** (`localStorage`), no profile column, no migration.
5. **CJK search limit accepted** for now.
6. **Variants**: Simplified Chinese (`zh-Hans`) and **European Portuguese** (`pt-PT`) first. This replaces the proposed `pt-BR`.
7. **Extra languages**: Korean, Polish and Dutch in; **Turkish not in this round** (so no `tr` file, and the Turkish `i`/`İ` search check is dropped); Traditional Chinese later.
8. **PDF fonts**: subset and bundle them in the repo.
