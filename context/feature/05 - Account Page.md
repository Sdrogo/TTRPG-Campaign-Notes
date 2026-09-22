## Design

- Add a new page called Account in witch Users can setup a Name, add an Avatar and do other generic "Manage our account" things (e.g. Log Out, profile description, pronoms).
- Avatar are Circular as Standard
- The new Page will be Accessible By a circle icon on the Top Right corner of the Top Navigation Bar, Remove old Implementation of Loguot Button.
- Account Page should follow the UX standars for that type of Page
- If an User has set a Name in The Account page, that name should be shown everywhere whe refernce to that User (e.g. Ownership, Comments, Member Page, etc..)

## Implementation

- Everithing should be as Modular and Reusable as Possible.
- Tests for the feature are part of the effort.
- Images should be handled as done in the rest of the app (upload or via URL, resize before storage, etc...)
- back-end should be updated to handle Images in User data model on DB
- DB Migration is needed
- Update in the App the logic that shown on screen the email of a User (e.g. Ownership, Comments, Member Page, etc..)

## Check When Done

- feature is fully implemented
- test cases are defined and tests implemented
- all test passes.
- `npm run build` passes.
- backend build passes.
- documentation is updated.