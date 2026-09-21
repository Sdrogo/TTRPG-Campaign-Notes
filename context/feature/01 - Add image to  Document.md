## Design

A Document should allow to add image(s) to it.
- Image should be shown in DocumentDetailPage.tsx
- If more than one image is linked to the Document, it should be displayed in a carousel, with a possibility of zoom each individual one.
- Image in document can be add fron Local machine or image URL.

## Implementation

- Part of it should be aready Implemented.
- File dimention should be minimazed, if a file is too big we should scale it down.

## Dependencies

- pillow 
- python-multipart
- @mantine/carousel

## Check When Done

- Images for Document is add to Supabase.
- `npm run build` passes.