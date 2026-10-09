## Goals

- Product owner's report (2026-10-09, after spec 30 shipped to staging): reading aloud works, but the synthesized voice sounds very poor.
- The cause: with "Automatica" the app left the choice to the browser, whose default is often its oldest system voice (Windows' desktop voices, eSpeak on Linux, Android's default), while the same browser frequently also has neural voices: Edge's "Online (Natural)" voices, Chrome's network "Google" voices, Apple's downloadable "Enhanced"/"Premium" voices.

## Decisions (2026-10-09)

1. **Product owner's choice** among three options (browser voices ranked better; Piper self-hosted on the VPS; a cloud neural TTS): improve the **browser voices**, at no cost and with no backend. The other two stay possible later if this isn't enough.
2. **"Automatica" picks the best installed voice** for the app language instead of the browser's default. The browser exposes no quality flag, so `voiceScore` ranks by name and kind: a neural-sounding name (`Natural`, `Neural`, `Online`, `Enhanced`, `Premium`, `Google`, `Siri`, `WaveNet`) counts most, then a network voice (`localService: false`), then the main region (`it-IT` over `it-CH`), then the browser default; Apple's older multilingual voices (Eddy, Flo, Grandma, ...) rank just below a plain system voice, and robotic engines (eSpeak, "Compact", Eloquence) and Apple's novelty voices (Bubbles, Zarvox, ...) sink to the bottom. A voice chosen by hand still wins.
3. **Account page**: the app language's voices are listed best first, "Automatica" names the voice it is using ("Automatica (Google italiano)"), and a line explains where better voices come from (Edge "Natural", Chrome "Google", Apple "Enhanced"/"Premium" voices downloaded in the system's Spoken Content settings).

## Implementation

- Frontend only, into `staging`: `voiceScore`, `rankVoices` and the new `pickVoice` fallback in `lib/speech.ts`; `SpeechSection`; two new strings in `it.json`/`en.json`; tests.
- Limits: on a browser with only poor voices (Firefox on Linux, some Android builds) nothing changes; that is where a server voice (Piper or a cloud service) would help.
