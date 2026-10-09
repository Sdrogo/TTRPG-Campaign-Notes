## Goals

- Product owner's request (2026-10-09): have the app's texts **read aloud by a speech synthesizer**, to listen to a Document instead of reading it (at the table, while preparing a session, or for accessibility).
- No new cost and no new data: everything happens in the reader's browser.

## Decisions (proposed 2026-10-09, confirm in the PR)

1. **Engine**: the browser's built-in **Web Speech API** (`window.speechSynthesis`). No backend, no external service, no API key, no migration; the text never leaves the device beyond what the browser's own voices do (some browsers, e.g. Chrome's "Google" voices, synthesize online). Where the browser has no `speechSynthesis`, every read-aloud control is hidden and the Account section says the browser doesn't support it.
2. **What can be read**: what the viewer already sees, nothing more (the backend has already filtered it, VR-07/VR-12, so no new visibility rule):
   - **the whole Document**: its name, its description, then each Note the viewer sees, in order (title, then text);
   - **one Note** on its own;
   - **one Comment** on its own (author's shown name, then the text). Replies are read one at a time, not as a thread.
   Mentions are read as the name they show (`#Name` reads "Name"), never as the stored token. Tags, badges, file names, image captions and the edit forms are not read.
3. **Where the controls are** (compact UI, spec 25):
   - Document header: a speaker icon next to Export ("Ascolta «Name»"). While that Document is being read it becomes **Pause/Resume** and **Stop**.
   - Each Note: the same small speaker icon in its row of actions, for every reader (not only who can edit it), with the same Pause/Resume and Stop while it plays.
   - Each Comment: an **"Ascolta"** text action next to "Rispondi", which becomes **"Interrompi"** while that Comment plays.
   One thing is read at a time: starting another stops the current one. Leaving the Document page stops reading.
4. **Voice and speed**: chosen on the **Account page**, in a new "Lettura ad alta voce" section: a voice picker (the browser's voices, the app language's first, "Automatica" by default) and a speed (0.75×, 1×, 1.25×, 1.5×), with a "Prova" button. With "Automatica" the browser picks its default voice for the app language (Italian by default, English when the app is in English). The choice is **per device and per app language** (voices differ between devices and an Italian voice reading English sounds wrong), kept in `localStorage` like the language and "Post as"; nothing is stored on the server.
5. **Long texts**: the text is split into sentence-sized chunks (≤ 200 characters, on paragraph and sentence boundaries, then commas, then spaces) and spoken one after the other. This works around Chrome cutting a single long utterance after about 15 seconds, and lets Stop and Pause act at once.
6. **Known browser limits** (accepted): pausing is unreliable on some Android browsers (Pause may end the reading there; Resume then has nothing to resume and the control returns to idle); the available voices and their quality depend on the device and the browser.

## Design (frontend only, one ticket)

- `lib/speech.ts`: plain helpers with tests: `speechSupported`, `speechChunks` (Decision 5), `mentionsToSpeech` (Decision 2), `documentSpeech`/`noteSpeech`, `pickVoice` (stored choice for the language, else none), the per-language preferences in `localStorage` (guarded like `characters.ts`), and the BCP 47 tag for the app language (`it-IT`, `en-US`).
- `lib/speechPlayer.ts`: the single player (Decision 3): `play(sourceId, text)`, `pause`, `resume`, `stop`, and a subscribable state `{ status: 'idle' | 'speaking' | 'paused', sourceId }`. Each `play` cancels the previous reading; a generation counter ignores the callbacks of a cancelled one.
- `hooks/useReadAloud.ts` (`useSyncExternalStore` over the player) and `hooks/useSpeechVoices.ts` (the browser's voices, refreshed on `voiceschanged`, since Chrome loads them late).
- `components/speech/ReadAloudControls.tsx` (speaker / pause-resume / stop icons) used by the Document header and `NoteItem`; the Comment action in `CommentItem`; `components/account/SpeechSection.tsx` on the Account page.
- New strings in `it.json` and `en.json`.
- Tests: chunking, mention stripping, the Document/Note text, voice choice and preferences, the player's state machine (with a fake `speechSynthesis`), the controls' states, the hidden controls without support.

## Implementation

- **30**: frontend only, into `staging`. No backend change, no migration.
- Update `architecture.md` (the browser-only feature), `ui-context.md` (the controls and the Account section) and `progress-tracker.md`.
- A new functional requirement belongs in `context/requirements.md`, which is protected: adding it needs the product owner's explicit approval, asked for in the PR.

## Definition of Done

- A member opens a Document, presses the speaker and hears its name, description and visible Notes in the app language; Pause, Resume and Stop work; a single Note or Comment can be heard on its own.
- The voice and speed picked on the Account page are used, and survive a reload on that device.
- In a browser without speech synthesis no control shows.
- Frontend `npm run build`, `npm run lint`, `npm test`.
