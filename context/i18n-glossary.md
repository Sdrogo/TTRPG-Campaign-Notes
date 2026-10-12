# i18n glossary

Fixed translations of the app's own terms, one column per language, so every
string in a language uses the same word (spec 34, Decision 9). Claude drafts
new languages from `it.json`/`en.json` and this file; there is no native
review for now, so every new language is shown as "beta" in the selector.

**Adding a language**: fill its column first, then translate the resource
files with those terms. **Adding a string** that uses one of these terms: use
the term as written here. A term that is missing here and likely to recur
(a new feature's noun) gets a row in the same change.

Never translated: the brand "Ex Libris", the sign-in provider names, and user
content.

| Term | Italiano | English |
| --- | --- | --- |
| Room | Stanza | Room |
| Document | Documento | Document |
| Note | Nota | Note |
| Tag | Tag | Tag |
| Comment | Commento | Comment |
| Reveal (verb: Rivela) | Rivela | Reveal |
| Master | Master | Master |
| Player | Player | Player |
| Administrator | Admin | Admin |
| Owner | Owner | Owner |
| Character | Personaggio | Character |

The Italian and English columns were taken from `it.json` and `en.json` on
2026-10-12 (the role names "Master", "Player", "Admin" and "Owner" stay in
English in Italian too). Check "Reveal" and "Character" in the resource files
when the first new language is added; the files are the source of truth, so
fix this table, not the files.
