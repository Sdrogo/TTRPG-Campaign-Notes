import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Ticket 73 step 1: Caddy on the VPS serves the frontend with the headers
// vercel.json sends. Until Vercel goes, both files must agree, so a change to
// one that misses the other fails here. Only connect-src differs: on the VPS
// it comes from CSP_CONNECT_SRC in the server's .env.
interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const vercel = JSON.parse(
  readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8'),
) as VercelConfig;
const vercelHeaders = vercel.headers.find((entry) => entry.source === '/(.*)')!.headers;
const vercelHeader = (key: string) => vercelHeaders.find((h) => h.key === key)?.value;

const caddyfile = readFileSync(resolve(__dirname, '../../../deploy/Caddyfile'), 'utf8');
const frontendBlock = caddyfile.slice(
  caddyfile.indexOf('{$FRONTEND_HOSTS} {'),
  caddyfile.indexOf('{$API_HOSTS} {'),
);
function caddyHeader(key: string): string | undefined {
  const match = frontendBlock.match(new RegExp(`^\\s*${key} "([^"]*)"`, 'm'));
  return match?.[1];
}

const withoutConnectSrc = (csp: string | undefined) =>
  csp
    ?.split(';')
    .map((part) => part.trim())
    .filter((part) => !part.startsWith('connect-src'));

describe('Caddyfile frontend headers', () => {
  it('has a frontend site before the API site', () => {
    expect(frontendBlock.length).toBeGreaterThan(0);
  });

  it.each([
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
  ])('sends the same %s as vercel.json', (key) => {
    expect(caddyHeader(key)).toBe(vercelHeader(key));
  });

  it('sends the same Content-Security-Policy, connect-src aside', () => {
    const caddyCsp = caddyHeader('Content-Security-Policy');
    expect(withoutConnectSrc(caddyCsp)).toEqual(
      withoutConnectSrc(vercelHeader('Content-Security-Policy')),
    );
    expect(caddyCsp).toContain("connect-src 'self' {$CSP_CONNECT_SRC};");
  });

  it('adds HSTS, which Vercel added on its own', () => {
    expect(caddyHeader('Strict-Transport-Security')).toBe('max-age=31536000');
  });
});
