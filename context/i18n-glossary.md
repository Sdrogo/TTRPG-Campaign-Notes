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
| Demo (the sample Room, spec 45_2) | Demo | Demo | Demo | Demo | Démo | Demo | Demo | Demo | Демо | デモ | 演示 | 데모 |
| Tour (the Demo's guided tour, spec 45_3) | Tour | Tour | Tour | Tour | Visite | Rondleiding | Przewodnik | Visita | Тур | ツアー | 导览 | 투어 |
| Session 0 (spec 46) | Sessione 0 | Session 0 | Session 0 | Sesión 0 | Session 0 | Sessie 0 | Sesja 0 | Sessão 0 | Сессия 0 | セッション0 | 第 0 次会话 | 세션 0 |
| Session 0.5 (a later round, spec 46) | Sessione 0.5 | Session 0.5 | Session 0.5 | Sesión 0.5 | Session 0.5 | Sessie 0.5 | Sesja 0.5 | Sessão 0.5 | Сессия 0.5 | セッション0.5 | 第 0.5 次会话 | 세션 0.5 |
| Retro (board, spec 46) | Retro | Retro | Retro | Retro | Rétro | Retro | Retro | Retro | Ретро | レトロ | 回顾 | 레트로 |
| Lines & Veils (board, spec 46) | Linee e Veli | Lines & Veils | Grenzen & Schleier | Líneas y Velos | Lignes et Voiles | Lijnen en Sluiers | Linie i Zasłony | Linhas e Véus | Линии и Завесы | ライン&ヴェール | 底线与帷幕 | 라인과 베일 |
| Must (Lines & Veils column) | Must | Must | Must | Must | Must | Must | Must | Must | Must | Must | Must | Must |
| post-it (spec 46) | post-it | post-it | Post-it | nota | post-it | post-it | karteczka | post-it | стикер | 付箋 | 便签 | 포스트잇 |
| Draft (an unpublished post-it) | Bozza | Draft | Entwurf | Borrador | Brouillon | Concept | Szkic | Rascunho | Черновик | 下書き | 草稿 | 초안 |
| Group (of post-its, spec 46c) | Gruppo | Group | Gruppe | Grupo | Groupe | Groep | Grupa | Grupo | Группа | グループ | 分组 | 그룹 |

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
