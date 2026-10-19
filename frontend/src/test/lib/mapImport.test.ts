import { describe, expect, it } from 'vitest';
import { mapExportFileName, readMapFile, toImportBody, toMapImportReport } from '../../lib/mapImport';

function file(content: string) {
  return new File([content], 'shibuya.json', { type: 'application/json' });
}

describe('map files (spec 38_3)', () => {
  it('reads a JSON object, and nothing else', async () => {
    expect(await readMapFile(file('{"schema_version": 1}'))).toEqual({ schema_version: 1 });
    expect(await readMapFile(file('not json'))).toBeNull();
    expect(await readMapFile(file('[1, 2]'))).toBeNull();
    expect(await readMapFile(file('null'))).toBeNull();
    expect(await readMapFile(file('3'))).toBeNull();
  });

  it('turns the report into camel case', () => {
    expect(
      toMapImportReport({
        name: 'Shibuya',
        description: 'Zone',
        plane_width: 2025,
        plane_height: 1852,
        areas: 6,
        pins: 14,
        links: 4,
        matched: 8,
        not_found: ['Elysium'],
        ambiguous: ['Bar'],
        repeated: ['Hachikō'],
      }),
    ).toEqual({
      name: 'Shibuya',
      description: 'Zone',
      planeWidth: 2025,
      planeHeight: 1852,
      areas: 6,
      pins: 14,
      links: 4,
      matched: 8,
      notFound: ['Elysium'],
      ambiguous: ['Bar'],
      repeated: ['Hachikō'],
    });
  });

  it('sends the file with the map fields, never a kind or a stale selective list', () => {
    expect(
      toImportBody(
        { schema_version: 1 },
        { name: 'Shibuya', description: 'Zone', visibility: 'room', selectiveUserIds: ['user-2'], kind: 'free' },
      ),
    ).toEqual({ map: { schema_version: 1 }, name: 'Shibuya', description: 'Zone', visibility: 'room', selective_user_ids: [] });
  });

  it('names the export after the map', () => {
    const date = new Date('2026-10-17T10:00:00Z');
    expect(mapExportFileName('Shibuya di notte', date)).toBe('shibuya-di-notte-2026-10-17.json');
    expect(mapExportFileName('渋谷', date)).toBe('map-2026-10-17.json');
  });
});
