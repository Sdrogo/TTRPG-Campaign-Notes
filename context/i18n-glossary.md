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

| Term | Italiano | English | Deutsch | Español | Français | Nederlands | Polski | Português (PT) | Русский |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Room | Stanza | Room | Raum | Sala | Salle | Kamer | Pokój | Sala | Комната |
| Document | Documento | Document | Dokument | Documento | Document | Document | Dokument | Documento | Документ |
| Note | Nota | Note | Notiz | Nota | Note | Notitie | Notatka | Nota | Заметка |
| Tag | Tag | Tag | Tag | Etiqueta | Tag | Tag | Tag | Tag | Тег |
| Comment | Commento | Comment | Kommentar | Comentario | Commentaire | Opmerking | Komentarz | Comentário | Комментарий |
| Reveal | Rivela | Reveal | Enthüllen (noun: Enthüllung) | Revelar / Revelación | Révéler (noun: Révélation) | Onthullen / Onthulling | Ujawnij / Ujawnienie | Revelar (noun: Revelação) | Раскрыть / Раскрытие |
| Master | Master | Master | Master | Master | Master | Master | Master | Master | Master |
| Player | Player | Player | Player | Player | Player | Player | Player | Player | Player |
| Administrator | Admin | Admin | Admin | Admin | Admin (role label); administrateur in prose | Admin | Admin (Administrator in long forms) | Admin (long form: Administrador) | Admin |
| Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner |
| Character | Personaggio | Character | Charakter | Personaje | Personnage | Personage | Postać | Personagem | Персонаж |

The Italian and English columns were taken from `it.json` and `en.json` on
2026-10-12 (the role names "Master", "Player", "Admin" and "Owner" stay in
English in Italian too). Check "Reveal" and "Character" in the resource files
when the first new language is added; the files are the source of truth, so
fix this table, not the files.

The seven columns from Deutsch to Русский were drafted by Claude on
2026-10-12 (spec 34_2) and are unreviewed (beta). Open points flagged while
drafting: "Tag" is kept as is in most languages, "Etiqueta" in Spanish and "Тег" in
Russian; "Reveal" is a verb in the interface ("Revelar") and a noun in a few
places, so both forms are given where they differ.
