import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Spec 72 Decisions 1-4 and ticket 73 step 1: the security headers Caddy sends
// with the frontend on every path. Read from the Caddyfile itself so a later
// edit can't drop one silently. connect-src comes from CSP_CONNECT_SRC in the
// server's .env, plus FILES_HOSTS, the images bucket's host (ticket 73 step 4).
const caddyfile = readFileSync(resolve(__dirname, '../../../deploy/Caddyfile'), 'utf8');
const frontendBlock = caddyfile.slice(
  caddyfile.indexOf('{$FRONTEND_HOSTS} {'),
  caddyfile.indexOf('{$API_HOSTS} {'),
);
function header(key: string): string | undefined {
  const match = frontendBlock.match(new RegExp(`^\\s*${key} "([^"]*)"`, 'm'));
  return match?.[1];
}
const csp = header('Content-Security-Policy');

function directive(name: string): string[] {
  const found = csp
    ?.split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name);
  return found ? found.slice(1) : [];
}

describe('Caddyfile frontend headers', () => {
  it('has a frontend site before the API site', () => {
    expect(frontendBlock.length).toBeGreaterThan(0);
  });

  it('sends the fixed headers on every path', () => {
    expect(header('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
  });

  it('enforces a Content-Security-Policy that only runs the app’s own scripts', () => {
    // 72_3: enforced since the walk-through of 2026-11-14, no longer report-only.
    expect(csp).toBeDefined();
    expect(header('Content-Security-Policy-Report-Only')).toBeUndefined();
    expect(directive('default-src')).toEqual(["'self'"]);
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('frame-src')).toEqual(["'none'"]);
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'self'"]);
    expect(directive('form-action')).toEqual(["'self'"]);
  });

  it('lets the app reach the API and the images bucket, set per server', () => {
    expect(directive('connect-src')).toEqual(["'self'", '{$CSP_CONNECT_SRC}', '{$FILES_HOSTS}']);
  });
});
