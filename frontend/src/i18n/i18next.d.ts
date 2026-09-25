import 'i18next';
import type it from './locales/it.json';

// Types `t()` keys against the Italian file, so a typo or a missing key fails
// the build. `locales.test.ts` keeps every other language in step with it.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof it };
  }
}
