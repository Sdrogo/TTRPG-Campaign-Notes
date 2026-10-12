# Fonts of the Room PDF (spec 23b, 34)

Bundled so the PDF never loads a font from the web. All five families are
under the SIL Open Font License 1.1 (the licence text is next to the files):

| Family | Files | Used by |
| --- | --- | --- |
| IM Fell English | `IMFeENrm28P.ttf`, `IMFeENit28P.ttf` | Gothic headings |
| Crimson Text | `CrimsonText-*.ttf` | Gothic and Print body, Print headings |
| Lato | `Lato-*.ttf` | Modern (Latin and Cyrillic) |
| PT Serif | `PTSerif-*.ttf` | Cyrillic fallback of Gothic and Print (Crimson Text and IM Fell English have no Cyrillic) |
| Noto Serif / Noto Sans (JP, SC, KR) | `NotoSerif{JP,SC,KR}-{Regular,Bold}.woff`, `NotoSans{JP,SC,KR}-{Regular,Bold}.woff` | Japanese, Chinese and Korean, in every style (serif for Gothic and Print, sans for Modern); per-glyph fallback of every font stack |

Taken from the Google Fonts repository (`ofl/imfellenglish`, `ofl/crimsontext`,
`ofl/lato`, `ofl/ptserif`); the Noto files come from the static Noto Serif/Sans CJK weights (SIL OFL 1.1, Adobe/Google, `OFL-notocjk.txt`). Nothing here comes from any game's manuals: the Gothic style is
inspired by the look of horror RPG books, never copied (spec 23b Decision 4).

## The CJK subsets (spec 34_3)

A full Noto CJK face is 5 to 15 MB, so each is a `pyftsubset` subset kept as
`.woff` (WOFF 1: WeasyPrint reads it with a plain zlib inflate; WOFF2 made
every PDF about 20 s slower, because the Brotli decode runs once per face for
each export, even without CJK text). Coverage per script, all with Latin
punctuation, the CJK symbols block, full- and half-width forms and arrows:

| Script | Characters |
| --- | --- |
| JP | hiragana, katakana, JIS X 0208 symbols and level 1 kanji (about 4,100 glyphs) |
| SC | GB 2312 symbols and the 3,755 level 1 hanzi, Bopomofo (about 5,000) |
| KR | the 2,350 Hangul syllables of KS X 1001, compatibility Jamo (about 3,900) |

A character outside its subset (a rare kanji, Hanja) has no glyph and prints
as a missing-glyph box; the `--text-file` lists are regenerated with
`codecs`: `euc_jp` rows 0xA1-0xA8 and 0xB0-0xCF, `gb2312` 0xA1-0xA9 and
0xB0-0xD7, `euc_kr` 0xA1-0xAC and 0xB0-0xC8. Command:
`pyftsubset NotoSerifJP_400Regular.ttf --text-file=chars_jp.txt --layout-features='*' --no-hinting --desubroutinize --flavor=woff`.
No Traditional Chinese face yet (spec 34, later).
