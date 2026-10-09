/**
 * What the backend expects in the body of `DELETE /account` (spec 31_1). It
 * is a fixed word on the wire; the dialog asks the user for a word in their
 * own language (`account.privacy.deleteWord`) before sending it.
 */
export const DELETION_CONFIRMATION = 'DELETE';

/** The file name of the personal data download (spec 31_2), dated in the user's time zone. */
export function personalDataFileName(now: Date): string {
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  return `ex-libris-my-data-${day}.json`;
}

/**
 * Who answers for the personal data (GDPR art. 13): the data controller's name
 * and the address for privacy requests, shown on the privacy page. Given by
 * the product owner on 2026-10-09.
 */
export const PRIVACY_CONTROLLER = {
  name: 'Andrea Partenope',
  email: 'andreapartenope@gmail.com',
} as const;

/** The date the privacy notice was last changed, shown at its top (ISO, `YYYY-MM-DD`). */
export const PRIVACY_NOTICE_UPDATED = '2026-10-09';

/**
 * A paragraph of the privacy notice as stored in the locale files: plain text,
 * or a bulleted list when every line starts with "- ".
 */
export type PrivacyBlock = { kind: 'text'; text: string } | { kind: 'list'; items: string[] };

/** Splits one section of the notice into paragraphs and lists (blank line between blocks). */
export function privacyBlocks(body: string): PrivacyBlock[] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim());
      if (lines.every((line) => line.startsWith('- '))) {
        return { kind: 'list', items: lines.map((line) => line.slice(2)) };
      }
      return { kind: 'text', text: lines.join(' ') };
    });
}
