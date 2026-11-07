import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_CHAPTERS, TOUR_STEPS } from '../../lib/demo/tour';

// Spec 64 Decision 11: the Demo must not go stale again. Every tour step points at a real
// element and has its texts in every UI language; every landing card names a real step.

const SRC = join(__dirname, '..', '..');
const LOCALES = join(SRC, 'i18n', 'locales');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

const source = sourceFiles(SRC).map((path) => readFileSync(path, 'utf8')).join('\n');
const locales = readdirSync(LOCALES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, json: JSON.parse(readFileSync(join(LOCALES, name), 'utf8')) }));

describe('the Demo tour', () => {
  it.each(TOUR_STEPS.filter((step) => step.target))('points step $id at an element that exists in the app', (step) => {
    const literal = new RegExp(`data-tour=(?:"${step.target}"|\\{[^}]*'${step.target}'[^}]*\\})`);
    expect(source).toMatch(literal);
  });

  it('has unique step ids', () => {
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length);
  });

  it.each(locales)('has every step, chapter and landing card in $name', ({ json }) => {
    for (const step of TOUR_STEPS) {
      expect(json.tour.steps[step.id]?.title, step.id).toBeTruthy();
      expect(json.tour.steps[step.id]?.body, step.id).toBeTruthy();
    }
    expect(Object.keys(json.tour.steps).sort()).toEqual(TOUR_STEPS.map((step) => step.id).sort());
    for (const chapter of TOUR_CHAPTERS) expect(json.tour.chapters[chapter], chapter).toBeTruthy();
    expect(json.tour.chapterLabel).toBeTruthy();
    for (const key of ['rooms', 'sections', 'documents', 'visibility', 'comments', 'maps', 'session', 'clocks', 'export']) {
      expect(json.landing.features[key]?.title, key).toBeTruthy();
      expect(json.landing.features[key]?.text, key).toBeTruthy();
    }
  });
});
