## Design

- Text all over Documents and Comments should allow to add reference to other Documents
- When someone is typing some string, and a word start with a `#` char, a popup will be shown with a List of Document. The list will filter for each new caracter has typed.
- clicking on one element (or navigate with keybord's arrows and press Enter), will automatically fill the string with `#` as prefix.
- Documents and comment should render this like a normal hyperlink with accent color
- the Popup will be populated with Documents Name prop and/or TAG

## Implementation

- Everithing should be as Modular and Reusable as Possible.
- Tests for the feature are part of the effort.

## Check When Done

- feature is fully implemented
- all test passes.
- `npm run build` passes.
