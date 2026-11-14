import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Spec 72 Decisions 1-4: the security headers Vercel sends on every path. Read
// from the file itself so a later edit can't drop one silently.
interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const config = JSON.parse(
  readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8'),
) as VercelConfig;
const everyPath = config.headers.find((entry) => entry.source === '/(.*)');
const header = (key: string) => everyPath?.headers.find((h) => h.key === key)?.value;
const csp = header('Content-Security-Policy');

function directive(name: string): string[] {
  const found = csp
    ?.split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name);
  return found ? found.slice(1) : [];
}

describe('vercel.json security headers', () => {
  it('sends the fixed headers on every path', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Permissions-Policy')).toContain('camera=()');
  });

  it('enforces a Content-Security-Policy that only runs the app’s own scripts', () => {
    // 72_3: enforced since the walk-through of 2026-11-14, no longer report-only.
    expect(csp).toBeDefined();
    expect(header('Content-Security-Policy-Report-Only')).toBeUndefined();
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'self'"]);
  });

  it('lets the app reach both backends and both Supabase projects', () => {
    const connect = directive('connect-src');
    expect(connect).toEqual(
      expect.arrayContaining([
        'https://api.exlibris.world',
        'https://ttrpg-campaign-notes-2.onrender.com',
        'https://mlksmacrcjurfuxtwdjw.supabase.co',
        'https://zyrgrmaxqkegnosapjbo.supabase.co',
      ]),
    );
  });
});
