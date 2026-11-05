import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { demoFetch } from '../../lib/demo/demoBackend';
import { GIULIA_ID, MARCO_ID, MASTER_ID, demoData } from '../../lib/demo/demoData';

const uid = (n: number) => `d3e0c0de-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MIRAI = uid(201);
const COLLECTOR = uid(203);
const JUN = uid(204);
const YUI = uid(205);
const REDDOOR = uid(207);
const LOBN = uid(202);
const NIGHT = uid(209);
const LEDGER = uid(210);
const KISSA = uid(211);
const FREE_MAP = uid(501);
const GEO_MAP = uid(502);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function get(path: string, viewAs: string | null = null): Promise<{ status: number; body: Json }> {
  const response = demoFetch(path, 'GET', viewAs);
  return { status: response.status, body: await response.json() };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('demoData', () => {
  it('is Italian for an Italian UI and English for every other language', () => {
    expect(demoData('it').documents.find((doc) => doc.id === REDDOOR)!.name).toBe('La Porta Rossa');
    expect(demoData('en').documents.find((doc) => doc.id === REDDOOR)!.name).toBe('The Red Door');
    expect(demoData('de').documents.find((doc) => doc.id === REDDOOR)!.name).toBe('The Red Door');
    expect(demoData('en').room).toMatchObject({ name: 'Tokyo by Night', image_url: '/demo/ikebukuro.webp' });
    expect(demoData('it')).toBe(demoData('it'));
  });
});

describe('demoFetch', () => {
  it('answers the signed-in user routes as the sample Room Master', async () => {
    expect((await get('/rooms')).body).toEqual([expect.objectContaining({ role: 'master', room: expect.objectContaining({ id: 'demo' }) })]);
    expect((await get('/account')).body).toMatchObject({ user_id: MASTER_ID, display_name: 'Morgan' });
    expect((await get('/account/friend-code')).body).toMatchObject({ code: 'DEMO' });
    expect((await get('/friends')).body).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect((await get('/invitations/mine')).body).toEqual([]);
    expect((await get('/reveals/mine')).body).toEqual([]);
  });

  it('answers 404 outside the sample Room', async () => {
    expect((await get('/nowhere')).status).toBe(404);
    expect((await get('/rooms/another-room')).status).toBe(404);
    expect((await get('/rooms/demo/unknown')).status).toBe(404);
  });

  it('follows the UI language', async () => {
    expect((await get(`/rooms/demo/documents/${REDDOOR}`)).body.name).toBe('La Porta Rossa');
    await i18n.changeLanguage('en');
    expect((await get(`/rooms/demo/documents/${REDDOOR}`)).body.name).toBe('The Red Door');
  });

  it('answers the Room settings pages', async () => {
    expect((await get('/rooms/demo/members')).body).toHaveLength(3);
    expect((await get('/rooms/demo/members/x')).status).toBe(404);
    expect((await get('/rooms/demo/tags')).body).toHaveLength(7);
    expect((await get('/rooms/demo/tags/main')).body).toEqual([0, 1, 2, 3, 4].map((n) => ({ tag_ids: [uid(101 + n)] })));
    expect((await get(`/rooms/demo/tags/${uid(101)}/backlinks`)).body).toEqual([]);
    expect((await get(`/rooms/demo/tags/${uid(101)}/other`)).status).toBe(404);
    expect((await get('/rooms/demo/audit-log')).body).toEqual({ entries: [], next_before: null });
    expect((await get('/rooms/demo/exports')).body).toEqual([]);
    expect((await get('/rooms/demo/mention-suggestions')).body).toEqual({ sources: [] });
  });

  // Spec 64: the sample Room's Session 0 is already played; starting or changing it is a write.
  it('answers the Session 0 as a played snapshot, manageable by the Master only', async () => {
    const master = (await get('/rooms/demo/session-zero')).body;
    expect(master).toMatchObject({ started: true, can_manage: true, timer: null, hidden_modules: 0 });
    expect(master.modules.map((module: { kind: string }) => module.kind)).toEqual(['lines_veils', 'stars_wishes', 'poll']);
    expect(master.lines_veils.map((column: { kind: string }) => column.kind)).toEqual(['must', 'veils', 'lines']);
    expect((await get('/rooms/demo/session-zero', MARCO_ID)).body.can_manage).toBe(false);
    expect((await get('/rooms/demo/session-zero/events')).status).toBe(404);
  });

  it('shows each viewer their own poll choice and the Session 0 at a glance', async () => {
    const pollOf = async (viewer: string | null) =>
      (await get('/rooms/demo/session-zero', viewer)).body.modules[2].polls[0];
    expect((await pollOf(MARCO_ID)).my_option_ids).toEqual([uid(752)]);
    expect((await pollOf(GIULIA_ID)).my_option_ids).toEqual([uid(751)]);
    expect((await pollOf(null)).options.find((option: { winner: boolean }) => option.winner)).toMatchObject({ count: 2 });
    const overview = (await get('/rooms/demo/session-zero/overview')).body;
    expect(overview).toMatchObject({ started: true, lines_veils: { must: 1, veils: 1, lines: 2 } });
    expect(overview.rounds[0].steps.map((step: { kind: string; cards: number }) => [step.kind, step.cards])).toEqual([
      ['lines_veils', 0],
      ['stars_wishes', 4],
      ['poll', 0],
    ]);
    expect(overview.rounds[0].steps[2].polls).toHaveLength(1);
  });

  // Specs 55, 60, 61, 64: the sample Room's landing, which the visitor can't edit.
  it('answers the landing as the page cards, the Sections and the Clocks Section', async () => {
    const sections = (await get('/rooms/demo/sections')).body as { kind: string; can_edit: boolean }[];
    expect(sections.map((section) => section.kind)).toEqual([
      'page_documents',
      'page_maps',
      'page_session_zero',
      'custom',
      'custom',
      'custom',
      'custom',
      'page_clocks',
    ]);
    const custom = sections.filter((section) => section.kind === 'custom') as unknown as { image_url: string | null; blocks: { kind: string }[] }[];
    expect(custom.map((section) => section.blocks.map((block) => block.kind))).toEqual([
      ['documents', 'documents'],
      ['documents', 'maps'],
      ['session_zero'],
      ['clocks'],
    ]);
    expect(custom[0].image_url).toBe('/demo/mirai.webp');
    expect(sections.every((section) => !section.can_edit)).toBe(true);
    expect((await get('/rooms/demo/sections/demo-page_maps')).status).toBe(404);
  });

  describe('Clocks (spec 61 Decision 30)', () => {
    type RawClock = { id: string; name: string; consequence: string | null; can_mark: boolean };

    it('lets the Master mark them and see the consequence; a Player neither', async () => {
      const master = (await get('/rooms/demo/clocks')).body as RawClock[];
      const marco = (await get('/rooms/demo/clocks', MARCO_ID)).body as RawClock[];
      expect(master).toHaveLength(5);
      expect(master.every((clock) => clock.can_mark)).toBe(true);
      expect(master.some((clock) => clock.consequence)).toBe(true);
      expect(marco.every((clock) => !clock.can_mark && clock.consequence === null)).toBe(true);
    });

    it('answers one clock and its empty history, else 404', async () => {
      const [first] = (await get('/rooms/demo/clocks')).body as RawClock[];
      expect(((await get(`/rooms/demo/clocks/${first.id}`)).body as RawClock).name).toBe(first.name);
      expect((await get(`/rooms/demo/clocks/${first.id}/history`)).body).toEqual({ entries: [], next_before: null });
      expect((await get(`/rooms/demo/clocks/${first.id}/marks`)).status).toBe(404);
      expect((await get('/rooms/demo/clocks/nope')).status).toBe(404);
    });

    it('answers the rules and the groups', async () => {
      expect(((await get('/rooms/demo/clock-rules')).body as { mark_kinds: unknown[] }).mark_kinds).toHaveLength(2);
      expect(((await get('/rooms/demo/clock-groups')).body as { mode: string }[]).map((group) => group.mode)).toEqual([
        'race',
        'turn',
      ]);
      expect((await get('/rooms/demo/clock-rules/labels')).status).toBe(404);
      expect((await get('/rooms/demo/clock-groups/x')).status).toBe(404);
    });
  });

  it('lists the characters the viewer plays', async () => {
    expect((await get('/rooms/demo/characters/mine')).body).toEqual([]);
    expect((await get('/rooms/demo/characters/mine', MARCO_ID)).body).toEqual([
      { document_id: JUN, name: 'Jun Takeda', image_url: '/demo/jun.webp' },
    ]);
  });

  describe('Documents', () => {
    it('shows the Master everything and a Player only what is shown to them', async () => {
      const master = ids((await get('/rooms/demo/documents')).body);
      const marco = ids((await get('/rooms/demo/documents', MARCO_ID)).body);
      const giulia = ids((await get('/rooms/demo/documents', GIULIA_ID)).body);

      expect(master).toEqual(expect.arrayContaining([COLLECTOR, KISSA]));
      expect(marco).not.toContain(COLLECTOR);
      expect(marco).toContain(KISSA);
      expect(giulia).not.toContain(KISSA);
      expect((await get('/rooms/demo/documents')).body[0]).toMatchObject({ unread_count: 0 });
    });

    it('answers a Document with the Notes the viewer sees', async () => {
      const master = (await get(`/rooms/demo/documents/${MIRAI}`)).body;
      const marco = (await get(`/rooms/demo/documents/${MIRAI}`, MARCO_ID)).body;
      const giulia = (await get(`/rooms/demo/documents/${YUI}`, GIULIA_ID)).body;

      expect(master.notes).toHaveLength(2);
      expect(master.notes[0]).toMatchObject({ position: 0, can_edit: true, relational_link: true });
      expect(marco.notes).toHaveLength(1);
      expect(marco.notes[0].can_edit).toBe(false);
      expect(giulia.notes[0]).toMatchObject({ visibility: 'selective', can_edit: true });
      expect((await get(`/rooms/demo/documents/${YUI}`, MARCO_ID)).body.notes).toEqual([]);
      expect((await get(`/rooms/demo/documents/${COLLECTOR}`, MARCO_ID)).status).toBe(404);
      expect((await get(`/rooms/demo/documents/${uid(999)}`)).status).toBe(404);
    });

    it('answers the Comments the viewer sees', async () => {
      const master = (await get(`/rooms/demo/documents/${NIGHT}/comments`)).body;
      const marco = (await get(`/rooms/demo/documents/${NIGHT}/comments`, MARCO_ID)).body;

      expect(master).toHaveLength(3);
      expect(marco).toHaveLength(2);
      expect(marco[0]).toMatchObject({ can_edit: true, can_pin: false, reactions: [{ emoji: '👀', count: 2, reacted_by_me: false }] });
      expect(marco[1]).toMatchObject({ parent_id: uid(401), parent_hidden: false, reactions: [{ reacted_by_me: true }] });
      expect((await get(`/rooms/demo/documents/${NIGHT}/comments/x`)).status).toBe(404);
    });

    it('answers where a Document is mentioned', async () => {
      const groups = (await get(`/rooms/demo/documents/${LEDGER}/backlinks`)).body;
      const kinds = groups.flatMap((group: { mentions: { kind: string }[] }) => group.mentions.map((m) => m.kind));

      expect(kinds).toEqual(expect.arrayContaining(['description', 'note', 'comment']));
      for (const group of groups) {
        for (const mention of group.mentions) expect(mention.excerpt).not.toContain('](doc:');
      }
      const forMarco = (await get(`/rooms/demo/documents/${LEDGER}/backlinks`, MARCO_ID)).body;
      expect(forMarco.length).toBeLessThan(groups.length);
    });

    it('answers the version history to the Master and suggestions as empty', async () => {
      const versions = (await get(`/rooms/demo/documents/${MIRAI}/versions`)).body;
      expect(versions.map((version: { id: string }) => version.id)).toEqual([uid(802), uid(801)]);
      expect(versions[0]).not.toHaveProperty('description');
      const newest = (await get(`/rooms/demo/documents/${MIRAI}/versions/${uid(802)}`)).body;
      expect(newest).toMatchObject({ subtitle: expect.any(String), notes: [expect.objectContaining({ title: expect.any(String) })] });
      expect((await get(`/rooms/demo/documents/${MIRAI}/versions/${uid(801)}`)).body.notes).toEqual([]);
      expect((await get(`/rooms/demo/documents/${MIRAI}/versions/1`)).status).toBe(404);
      expect((await get(`/rooms/demo/documents/${MIRAI}/versions`, MARCO_ID)).body).toEqual([]);
      expect((await get(`/rooms/demo/documents/${LOBN}/versions`)).body).toEqual([]);
      expect((await get(`/rooms/demo/documents/${MIRAI}/mention-suggestions`)).body).toEqual({ sources: [] });
      expect((await get(`/rooms/demo/documents/${MIRAI}/linked-map`)).status).toBe(404);
    });

    it('gives Documents their image', async () => {
      const doc = (await get(`/rooms/demo/documents/${MIRAI}`)).body;
      expect(doc.images).toEqual([expect.objectContaining({ url: '/demo/mirai.webp', is_favorite: true })]);
      expect((await get(`/rooms/demo/documents/${uid(210)}`)).body.images).toEqual([]);
    });

    it('draws a live mention map around the Document', async () => {
      const map = (await get(`/rooms/demo/documents/${MIRAI}/mention-map`)).body;

      expect(map).toMatchObject({ document_id: MIRAI, depth: 1, can_manage: true, documents_left_out: 0 });
      expect(map.cards[0]).toMatchObject({ document_id: MIRAI, x: 0, y: 0, size: 'large' });
      const linked = map.cards.map((card: { document_id: string }) => card.document_id);
      expect(linked).toEqual(expect.arrayContaining([LOBN, LEDGER]));
      expect(map.arrows.length).toBeGreaterThan(0);
      expect((await get(`/rooms/demo/documents/${MIRAI}/mention-map`, MARCO_ID)).body.can_manage).toBe(false);
      expect((await get(`/rooms/demo/documents/${MIRAI}/mention-map/preview`)).status).toBe(404);
    });

    it('has no mention map for a Document tied to nothing the viewer sees', async () => {
      const statuses = await Promise.all(
        demoData('it').documents.map(async (doc) => (await get(`/rooms/demo/documents/${doc.id}/mention-map`, GIULIA_ID)).status),
      );
      expect(statuses).toContain(404);
    });
  });

  describe('search', () => {
    it('finds Documents, Notes, Comments and Tags the viewer sees', async () => {
      const result = (await get('/rooms/demo/search?q=Registro&limit=20')).body;

      expect(result.documents.items.map((hit: { id: string }) => hit.id)).toContain(LEDGER);
      expect(result.notes.items.length).toBeGreaterThan(0);
      expect(result.comments.items.length).toBeGreaterThan(0);
      expect(result.documents.has_more).toBe(false);
      expect((await get('/rooms/demo/search?q=corte')).body.tags.items[0]).toMatchObject({ kind: 'tag', title: { highlights: [[3, 8]] } });
      expect((await get('/rooms/demo/search?q=legami')).body.notes.items[0].title.highlights).toEqual([[0, 6]]);
    });

    it('filters by kind and Tag and limits each group', async () => {
      const notesOnly = (await get('/rooms/demo/search?q=a&kind=note')).body;
      expect(notesOnly.documents.items).toEqual([]);
      expect(notesOnly.notes.items.length).toBeGreaterThan(0);

      const limited = (await get('/rooms/demo/search?q=a&limit=1')).body;
      expect(limited.documents).toMatchObject({ items: [expect.anything()], has_more: true });

      const tagged = (await get(`/rooms/demo/search?q=a&tag=${uid(102)}`)).body;
      expect(tagged.documents.items.map((hit: { id: string }) => hit.id).sort()).toEqual([JUN, YUI]);
    });

    it('finds nothing without a query, nor what the viewer cannot see', async () => {
      expect((await get('/rooms/demo/search')).body.documents.items).toEqual([]);
      expect((await get('/rooms/demo/search?q=Collezionista', MARCO_ID)).body.documents.items).toEqual([]);
    });
  });

  describe('maps', () => {
    it('lists the maps with the Documents the viewer sees', async () => {
      const master = (await get('/rooms/demo/maps')).body;
      const marco = (await get('/rooms/demo/maps', MARCO_ID)).body;

      expect(ids(master)).toEqual([FREE_MAP, GEO_MAP]);
      expect(master[0]).toMatchObject({ document_count: 5, can_edit: true });
      expect(master[0]).not.toHaveProperty('cards');
      expect(marco[0]).toMatchObject({ document_count: 4, can_edit: false });
    });

    it('leaves the hidden cards and their arrows off a free map', async () => {
      const master = (await get(`/rooms/demo/maps/${FREE_MAP}`)).body;
      const marco = (await get(`/rooms/demo/maps/${FREE_MAP}`, MARCO_ID)).body;

      expect(master.cards).toHaveLength(6);
      expect(master.arrows).toHaveLength(5);
      expect(master.cards[0].document).toMatchObject({ id: LEDGER, image: null });
      expect(master.cards[5]).toMatchObject({ document_id: null, document: null });
      expect(marco.cards).toHaveLength(5);
      expect(marco.arrows).toHaveLength(4);
    });

    it('answers a geographic map with its content apart', async () => {
      const summary = (await get(`/rooms/demo/maps/${GEO_MAP}`)).body;
      const master = (await get(`/rooms/demo/maps/${GEO_MAP}/geo`)).body;
      const giulia = (await get(`/rooms/demo/maps/${GEO_MAP}/geo`, GIULIA_ID)).body;

      expect(summary).toMatchObject({ kind: 'geographic', cards: [], groups: [], arrows: [] });
      expect(master.pins).toHaveLength(5);
      expect(master.areas[0].document).toBeNull();
      expect(master.background_url).toBe('/demo/marunouchi.webp');
      expect(master.links).toHaveLength(2);
      expect(giulia.pins).toHaveLength(3);
      expect(giulia.links).toHaveLength(1);
    });

    it('answers 404 for anything else', async () => {
      expect((await get(`/rooms/demo/maps/${uid(999)}`)).status).toBe(404);
      expect((await get(`/rooms/demo/maps/${FREE_MAP}/geo`)).status).toBe(404);
      expect((await get(`/rooms/demo/maps/${GEO_MAP}/other`)).status).toBe(404);
    });
  });

  describe('writes', () => {
    it('answers a Document visit without storing it', async () => {
      const response = demoFetch(`/rooms/demo/documents/${MIRAI}/read`, 'POST', null);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ revealed: { document: false } });
    });

    it('refuses every other write with the read-only notice', async () => {
      for (const [path, method] of [
        ['/rooms', 'POST'],
        [`/rooms/demo/documents/${MIRAI}`, 'PATCH'],
        [`/rooms/demo/documents/${MIRAI}`, 'DELETE'],
      ]) {
        const response = demoFetch(path, method, null);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ detail: 'La demo è in sola lettura: accedi per creare la tua Stanza.' });
      }
    });
  });
});
