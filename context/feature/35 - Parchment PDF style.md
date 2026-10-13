# 35 - Parchment PDF style

## Goals

- Product owner's request (2026-10-13): a fourth style for the Room PDF
  (spec 23b), modeled on a fantasy monster compendium the product owner
  shared (a Homebrewery-style book: aged paper, two columns, brown headings,
  dotted contents, a big initial, a "Aura: … · Tipo: …" line under each
  creature's name, "Nota per i GM" sections). **Inspired by, never copied**,
  with small deliberate differences so it reads as its own look.

## Decisions (defaults picked while building, to confirm in the PR)

1. **Name and order**: `parchment` ("Parchment", "Pergamena"), offered last,
   after Print. Gothic stays the default.
2. **Paper**: every page on a warm parchment color (`#f3ead4`), the cover on
   a darker one (`#e9dcba`) inside a double brown frame. A flat color, no
   paper texture image (keeps the PDF light and the text sharp).
3. **Type**: Crimson Text for body and headings (already bundled, SIL OFL);
   headings bold, brown (`#7a2e14`), in small capitals. The reference's
   fonts are not open-licensed, so none of them ships.
4. **Rules**: ochre (`#c9a35a`): one under each Document name, a double one
   under a chapter title, one between the columns and under the running
   header. Page numbers framed by dashes ("— 3 —").
5. **Subtitle as a stat-block header** (spec 28_0): bold brown italic on a
   pale ochre band between two rules. This is where the reference puts
   "Aura · Tipo".
6. **Initial**: the Gothic large initial in bold brown, on the line (not
   floated, same WeasyPrint limit as Gothic).
7. **Notes stay paragraphs** (product owner, 2026-10-06): no box, a ruled
   small-capital subheading. Comments are boxed sidebars on a tinted
   background with a brown edge, like the other styles.
8. **Differences from the reference**: ochre rules instead of the red-brown
   heading underlines, a framed cover instead of a full-bleed illustration,
   dashed page numbers instead of a footer band, no paper texture or
   watercolor stains.

## Out of scope

- A real stat-block layout (ability scores, actions): Documents have no such
  fields.
