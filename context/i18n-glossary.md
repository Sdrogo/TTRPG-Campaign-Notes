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

| Term | Italiano | English | Deutsch | Español | Français | Nederlands | Polski | Português (PT) | Русский | 日本語 | 简体中文 | 한국어 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Room | Stanza | Room | Raum | Sala | Salle | Kamer | Pokój | Sala | Комната | ルーム | 房间 | 룸 |
| Document | Documento | Document | Dokument | Documento | Document | Document | Dokument | Documento | Документ | ドキュメント | 文档 | 문서 |
| Note | Nota | Note | Notiz | Nota | Note | Notitie | Notatka | Nota | Заметка | ノート | 笔记 | 노트 |
| Tag | Tag | Tag | Tag | Etiqueta | Tag | Tag | Tag | Tag | Тег | タグ | 标签 | 태그 |
| Comment | Commento | Comment | Kommentar | Comentario | Commentaire | Opmerking | Komentarz | Comentário | Комментарий | コメント | 评论 | 댓글 |
| Reveal | Rivela | Reveal | Enthüllen (noun: Enthüllung) | Revelar / Revelación | Révéler (noun: Révélation) | Onthullen / Onthulling | Ujawnij / Ujawnienie | Revelar (noun: Revelação) | Раскрыть / Раскрытие | 開示する (noun: 開示) | 揭示 | 공개 |
| Master | Master | Master | Master | Master | Master | Master | Master | Master | Master | Master | Master | Master |
| Player | Player | Player | Player | Player | Player | Player | Player | Player | Player | Player | Player | Player |
| Administrator | Admin | Admin | Admin | Admin | Admin (role label); administrateur in prose | Admin | Admin (Administrator in long forms) | Admin (long form: Administrador) | Admin | Admin (prose: 管理者) | Admin (prose: 管理员) | Admin (long form: 관리자) |
| Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner | Owner |
| Character | Personaggio | Character | Charakter | Personaje | Personnage | Personage | Postać | Personagem | Персонаж | キャラクター | 角色 | 캐릭터 |
| Relational link (a flagged Note, spec 41) | Link relazionale | Relational link | Beziehungslink | Enlace relacional | Lien relationnel | Relatielink | Link relacyjny | Ligação relacional | Связующая ссылка | 関係リンク | 关系链接 | 관계 링크 |

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

The three columns from 日本語 to 한국어 were drafted by Claude on 2026-10-12
(spec 34_3) and are unreviewed (beta). For a native check: "Reveal" (開示 vs
公開 in Japanese, 揭示 vs 揭晓 in Chinese, 공개 in Korean, which is also the
everyday word for "public"), "Room" (룸 vs 방 in Korean, 房间 in Chinese),
"Note" in Chinese (笔记 vs 备注), "Friend" (フレンド, 好友, 친구) and
"promote" a comment (승격, 升级). Chinese keeps the English "p." of
`pdf.pageAbbreviation` because it prefixes the page number.
