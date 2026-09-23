## Goals
- the goal is to encanche the current implementation of DocumentCard to show Images and TAGs too.

## Design

- Tags will be on a line of his own below the Title. the Name and visibility tag will be on top and the Tags line below. The block of the three will be reference in this document as Title block.
- Image will be shown on the right side of the cart as carousel (current implementation in Document Details), below the Title block and next to the Comment area.
- Image block will be sized to half card width.
- Owner of the Document can choose a favorite Image to be shown as first. It will be done by a heart shape icon at the bottom of the Image itself and possible to do in edit. First image uploaded will be set as favorite by default and only one image can be the favorite (if a new one is set by the icon it will be remove the favorite status for the previous one).
- Ownership will be on the bottom of the card with a line of his own.

## Implementation

- Images will be the same as the Document Details already have

- create a new branch for the feature starting from main
- migration for DB if needed.
- commit beckend and frontend work separatelly.
- Tests for the feature are part of the effort.

## Check When Done

- feature is fully implemented
- branch and PR is created (present me the link to finish the job). 
- all test passes.
- beckend build passes.
- `npm run build` passes.
