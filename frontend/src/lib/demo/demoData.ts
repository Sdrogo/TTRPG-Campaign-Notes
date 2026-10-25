import { DEMO_ROOM_ID, DEMO_USER_ID } from './demoMode';

// The Demo's sample Room (spec 45_2, Decision 11): "The Lost Lighthouse", a
// short fantasy campaign, in the API's wire shape (snake_case) so the real
// hooks read it unchanged. Written in English and Italian; `demoData(lang)`
// picks Italian for an Italian UI and English for every other language.
// Ids are fixed UUIDs, since mention tokens only accept UUIDs.

type Lang = 'en' | 'it';

/** The sample Room's fixed id number `n`, as a UUID. */
function uid(n: number): string {
  return `d3e0c0de-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** The Master, Morgan: the visitor. */
export const MASTER_ID = DEMO_USER_ID;
/** Marco, a Player: plays Brann and owns a Private Document. */
export const MARCO_ID = uid(2);
/** Giulia, a Player: plays Seren and wrote a Selective Note. */
export const GIULIA_ID = uid(3);

const TAG = { npc: uid(101), pc: uid(102), place: uid(103), event: uid(104), artifact: uid(105), coast: uid(106), cult: uid(107) };
const DOC = {
  ilsa: uid(201),
  tobias: uid(202),
  prophet: uid(203),
  brann: uid(204),
  seren: uid(205),
  harbour: uid(206),
  lighthouse: uid(207),
  chapel: uid(208),
  night: uid(209),
  lens: uid(210),
  cove: uid(211),
};

/** The four visibilities of the API (section 8). */
export type Visibility = 'room' | 'master' | 'private' | 'selective';

/** A sample Document, with what the visibility rules read. */
export interface DemoDocument {
  id: string;
  name: string;
  subtitle: string | null;
  description: string;
  visibility: Visibility;
  tag_ids: string[];
  owner_ids: string[];
  selective_user_ids: string[];
  played_by: string | null;
}

/** A sample Note; `author_id` counts as its owner for visibility. */
export interface DemoNote {
  id: string;
  document_id: string;
  title: string;
  description: string;
  visibility: Visibility;
  selective_user_ids: string[];
  author_id: string;
  relational_link: boolean;
}

/** A sample Comment, with its reactions by user. */
export interface DemoComment {
  id: string;
  document_id: string;
  author_id: string;
  body: string;
  visibility: Visibility;
  selective_user_ids: string[];
  parent_id: string | null;
  created_at: string;
  reactions: { emoji: string; user_ids: string[] }[];
  as_character: string | null;
}

/** The whole sample Room, in the API's wire shapes where the pages read it directly. */
export interface DemoData {
  room: { id: string; name: string; game_system: string; status: 'active'; players_can_create_documents: boolean; default_visibility: 'room'; image_url: null };
  members: { user_id: string; role: 'master' | 'player'; is_admin: boolean; email: string; display_name: string; pronouns: string | null; bio: string | null; avatar_url: null }[];
  tags: { id: string; name: string; category: string | null; main_position: number | null }[];
  documents: DemoDocument[];
  notes: DemoNote[];
  comments: DemoComment[];
  maps: Record<string, unknown>[];
}

/** A Document mention as stored in text (`lib/mentionTokens.ts`). */
function mention(name: string, id: string): string {
  return `#[${name}](doc:${id})`;
}

/** Builds the sample Room in one language. */
function build(lang: Lang): DemoData {
  const t = (en: string, it: string) => (lang === 'it' ? it : en);
  const names = {
    ilsa: 'Ilsa Varn',
    tobias: t('Old Tobias', 'Il vecchio Tobia'),
    prophet: t('The Drowned Prophet', 'Il Profeta Annegato'),
    brann: 'Brann Ashcroft',
    seren: 'Seren Vale',
    harbour: t('Saltmarsh Harbour', 'Porto di Salmastro'),
    lighthouse: t('Greyrock Lighthouse', 'Il Faro di Rocciagrigia'),
    chapel: t('The Sunken Chapel', 'La Cappella Sommersa'),
    night: t('The Night of the Dark Lamp', 'La Notte della Lanterna Spenta'),
    lens: t('The Tidebound Lens', 'La Lente delle Maree'),
    cove: t("Smugglers' Cove", 'La Cala dei Contrabbandieri'),
  };
  const m = (key: keyof typeof DOC) => mention(names[key], DOC[key]);
  const doc = (
    key: keyof typeof DOC,
    fields: Partial<DemoDocument> & Pick<DemoDocument, 'description' | 'tag_ids'>,
  ): DemoDocument => ({
    id: DOC[key],
    name: names[key],
    subtitle: null,
    visibility: 'room',
    owner_ids: [MASTER_ID],
    selective_user_ids: [],
    played_by: null,
    ...fields,
  });

  const documents: DemoDocument[] = [
    doc('ilsa', {
      subtitle: t("The keeper's daughter", 'La figlia del guardiano'),
      tag_ids: [TAG.npc, TAG.coast],
      description: t(
        `Ilsa grew up at ${m('lighthouse')} and still climbs its stairs every night, although the lamp has been dark for a month. She trusts no one in ${m('harbour')} except ${m('tobias')}.\n\nShe wants the lamp lit again, and she will pay with the only thing she has: her father's charts.`,
        `Ilsa è cresciuta al ${m('lighthouse')} e ne sale ancora le scale ogni notte, anche se la lanterna è spenta da un mese. Al ${m('harbour')} non si fida di nessuno, tranne che del ${m('tobias')}.\n\nVuole che la lanterna torni ad ardere, e pagherà con l'unica cosa che ha: le carte nautiche di suo padre.`,
      ),
    }),
    doc('tobias', {
      subtitle: t('Fisherman, storyteller', 'Pescatore e cantastorie'),
      tag_ids: [TAG.npc],
      description: t(
        `Tobias has fished these waters for fifty years. He swears he saw a procession of lanterns walk into the sea on ${m('night')}.`,
        `Tobia pesca in queste acque da cinquant'anni. Giura di aver visto una processione di lanterne entrare in mare durante ${m('night')}.`,
      ),
    }),
    doc('prophet', {
      subtitle: t('Master only: the villain', 'Solo Master: il nemico'),
      visibility: 'master',
      tag_ids: [TAG.npc, TAG.cult],
      description: t(
        `Once the chaplain of ${m('chapel')}, now something that breathes water. He put out the lighthouse lamp so that ships would wreck on the rocks, and their crews would join his congregation.\n\nHe needs ${m('lens')} to call the tide that will drown ${m('harbour')}.`,
        `Un tempo cappellano della ${m('chapel')}, ora qualcosa che respira acqua. Ha spento la lanterna del faro perché le navi si schiantassero sugli scogli e i loro equipaggi si unissero alla sua congregazione.\n\nGli serve ${m('lens')} per chiamare la marea che sommergerà il ${m('harbour')}.`,
      ),
    }),
    doc('brann', {
      subtitle: t('Former smuggler', 'Ex contrabbandiere'),
      tag_ids: [TAG.pc],
      owner_ids: [MARCO_ID],
      played_by: MARCO_ID,
      description: t(
        `A broad-shouldered sailor who knows every cave of the coast, starting with ${m('cove')}. He owes Ilsa's father his life.`,
        `Un marinaio dalle spalle larghe che conosce ogni grotta della costa, a cominciare dalla ${m('cove')}. Deve la vita al padre di Ilsa.`,
      ),
    }),
    doc('seren', {
      subtitle: t('Wandering scholar', 'Studiosa errante'),
      tag_ids: [TAG.pc],
      owner_ids: [GIULIA_ID],
      played_by: GIULIA_ID,
      description: t(
        `Seren came to ${m('harbour')} following a rumour about ${m('lens')}, an artifact said to bend the tides.`,
        `Seren è arrivata al ${m('harbour')} seguendo una voce su ${m('lens')}, un artefatto che piegherebbe le maree.`,
      ),
    }),
    doc('harbour', {
      subtitle: t('A town that lives on the sea', 'Una città che vive di mare'),
      tag_ids: [TAG.place, TAG.coast],
      description: t(
        `Grey houses, nets drying on every wall, and a tavern, the Salted Eel, where news arrives before the boats. Since the lamp went dark, three ships have been lost.`,
        `Case grigie, reti stese ad asciugare su ogni muro e una taverna, l'Anguilla Salata, dove le notizie arrivano prima delle barche. Da quando la lanterna si è spenta, si sono perse tre navi.`,
      ),
    }),
    doc('lighthouse', {
      subtitle: t('Dark for a month', 'Spento da un mese'),
      tag_ids: [TAG.place, TAG.coast],
      description: t(
        `A tower of black stone on the rocks north of ${m('harbour')}. ${m('ilsa')} keeps the key. At the top, the great lamp is intact, but its lens is missing.`,
        `Una torre di pietra nera sugli scogli a nord del ${m('harbour')}. ${m('ilsa')} ne custodisce la chiave. In cima la grande lanterna è intatta, ma manca la lente.`,
      ),
    }),
    doc('chapel', {
      subtitle: t('Visible only at low tide', 'Visibile solo con la bassa marea'),
      tag_ids: [TAG.place, TAG.cult],
      description: t(
        `A chapel swallowed by the sea a century ago. At the lowest tides its bell tower rises from the water, and some say the bell still rings.`,
        `Una cappella inghiottita dal mare un secolo fa. Con le maree più basse il campanile emerge dall'acqua, e qualcuno dice che la campana suoni ancora.`,
      ),
    }),
    doc('night', {
      subtitle: t('One month ago', 'Un mese fa'),
      tag_ids: [TAG.event],
      description: t(
        `The night the lamp of ${m('lighthouse')} went out. Ilsa's father climbed up to relight it and was never seen again.`,
        `La notte in cui la lanterna del ${m('lighthouse')} si è spenta. Il padre di Ilsa è salito a riaccenderla e nessuno l'ha più visto.`,
      ),
    }),
    doc('lens', {
      subtitle: t('Missing from the lighthouse', 'Sparita dal faro'),
      tag_ids: [TAG.artifact],
      description: t(
        `A disc of sea-green crystal as wide as a cartwheel. Light passing through it can be seen beyond the horizon, and, the old books say, it can call the tide.`,
        `Un disco di cristallo verde mare largo come una ruota di carro. La luce che lo attraversa si vede oltre l'orizzonte e, dicono i vecchi libri, può chiamare la marea.`,
      ),
    }),
    doc('cove', {
      subtitle: t("Brann's secret", 'Il segreto di Brann'),
      visibility: 'private',
      owner_ids: [MARCO_ID],
      tag_ids: [TAG.place, TAG.coast],
      description: t(
        `Private: only Brann's player and the Master see this. A cave reachable only by boat, where Brann's old crew still hides goods.`,
        `Privato: lo vedono solo il player di Brann e il Master. Una grotta raggiungibile solo in barca, dove la vecchia ciurma di Brann nasconde ancora le merci.`,
      ),
    }),
  ];

  const note = (n: number, key: keyof typeof DOC, fields: Omit<DemoNote, 'id' | 'document_id' | 'selective_user_ids' | 'relational_link' | 'author_id' | 'visibility'> & Partial<DemoNote>): DemoNote => ({
    id: uid(300 + n),
    document_id: DOC[key],
    visibility: 'room',
    selective_user_ids: [],
    author_id: MASTER_ID,
    relational_link: false,
    ...fields,
  });

  const notes: DemoNote[] = [
    note(1, 'ilsa', {
      title: t('Ties', 'Legami'),
      relational_link: true,
      description: t(
        `Ilsa trusts ${m('tobias')} and is looking for ${m('lens')}.`,
        `Ilsa si fida del ${m('tobias')} e sta cercando ${m('lens')}.`,
      ),
    }),
    note(2, 'ilsa', {
      title: t('What she hides', 'Cosa nasconde'),
      visibility: 'master',
      description: t(
        `Master only. Ilsa found her father's boots on the beach below ${m('chapel')} and told no one.`,
        `Solo Master. Ilsa ha trovato gli stivali del padre sulla spiaggia sotto la ${m('chapel')} e non l'ha detto a nessuno.`,
      ),
    }),
    note(3, 'lighthouse', {
      title: t('The stairs', 'Le scale'),
      description: t(
        'Two hundred and twelve steps. The forty-first creaks; someone has carved a fish into it.',
        'Duecentododici gradini. Il quarantunesimo scricchiola; qualcuno ci ha inciso un pesce.',
      ),
    }),
    note(4, 'seren', {
      title: t("Seren's real name", 'Il vero nome di Seren'),
      visibility: 'selective',
      selective_user_ids: [GIULIA_ID],
      author_id: GIULIA_ID,
      description: t(
        `Shared with the Master only: Seren is the chaplain's granddaughter. She fears what ${m('prophet')} has become.`,
        `Condiviso solo con il Master: Seren è la nipote del cappellano. Teme ciò che è diventato ${m('prophet')}.`,
      ),
    }),
    note(5, 'prophet', {
      title: t('Plan', 'Piano'),
      relational_link: true,
      description: t(
        `He waits in ${m('chapel')} for ${m('lens')}.`,
        `Aspetta nella ${m('chapel')} che gli portino ${m('lens')}.`,
      ),
    }),
  ];

  const comment = (n: number, key: keyof typeof DOC, fields: Omit<DemoComment, 'id' | 'document_id' | 'visibility' | 'selective_user_ids' | 'parent_id' | 'reactions' | 'as_character'> & Partial<DemoComment>): DemoComment => ({
    id: uid(400 + n),
    document_id: DOC[key],
    visibility: 'room',
    selective_user_ids: [],
    parent_id: null,
    reactions: [],
    as_character: null,
    ...fields,
  });

  const comments: DemoComment[] = [
    comment(1, 'night', {
      author_id: MARCO_ID,
      created_at: '2026-10-20T20:15:00Z',
      body: t(
        `Brann asks around the tavern: did anyone else see the lanterns Tobias talks about?`,
        `Brann chiede in giro alla taverna: qualcun altro ha visto le lanterne di cui parla Tobia?`,
      ),
      reactions: [{ emoji: '👀', user_ids: [GIULIA_ID, MASTER_ID] }],
    }),
    comment(2, 'night', {
      author_id: GIULIA_ID,
      parent_id: uid(401),
      created_at: '2026-10-20T20:40:00Z',
      body: t(
        `Seren checks the tide tables: that night the tide was the lowest of the year. ${m('chapel')} would have been above water.`,
        `Seren controlla le tavole delle maree: quella notte la marea era la più bassa dell'anno. La ${m('chapel')} doveva essere fuori dall'acqua.`,
      ),
      reactions: [{ emoji: '🔥', user_ids: [MARCO_ID] }],
    }),
    comment(3, 'night', {
      author_id: MASTER_ID,
      visibility: 'master',
      created_at: '2026-10-20T21:00:00Z',
      body: t(
        'Master only: next session, the bell rings at midnight.',
        'Solo Master: alla prossima sessione la campana suona a mezzanotte.',
      ),
    }),
    comment(4, 'lighthouse', {
      author_id: GIULIA_ID,
      created_at: '2026-10-21T18:00:00Z',
      body: t(
        `The empty lens mount has scratches, as if someone pried it out in a hurry.`,
        `L'alloggiamento vuoto della lente ha dei graffi, come se qualcuno l'avesse forzata in fretta.`,
      ),
    }),
  ];

  const tags = [
    { id: TAG.npc, name: t('NPC', 'PNG'), category: null, main_position: 0 },
    { id: TAG.pc, name: t('PC', 'PG'), category: null, main_position: 1 },
    { id: TAG.place, name: t('Place', 'Luogo'), category: null, main_position: 2 },
    { id: TAG.event, name: t('Event', 'Evento'), category: null, main_position: 3 },
    { id: TAG.artifact, name: t('Artifact', 'Artefatto'), category: null, main_position: 4 },
    { id: TAG.coast, name: t('Greyrock coast', 'Costa di Rocciagrigia'), category: t('Region', 'Regione'), main_position: null },
    { id: TAG.cult, name: t('Cult of the Tide', 'Culto della Marea'), category: t('Faction', 'Fazione'), main_position: null },
  ];

  const members = [
    { user_id: MASTER_ID, role: 'master' as const, is_admin: true, email: 'master@demo.exlibris.world', display_name: 'Morgan', pronouns: null, bio: t('Runs the campaign', 'Guida la campagna'), avatar_url: null },
    { user_id: MARCO_ID, role: 'player' as const, is_admin: false, email: 'marco@demo.exlibris.world', display_name: 'Marco', pronouns: null, bio: t("Plays Brann", 'Gioca Brann'), avatar_url: null },
    { user_id: GIULIA_ID, role: 'player' as const, is_admin: false, email: 'giulia@demo.exlibris.world', display_name: 'Giulia', pronouns: null, bio: t('Plays Seren', 'Gioca Seren'), avatar_url: null },
  ];

  const mapBase = {
    room_id: DEMO_ROOM_ID,
    visibility: 'room',
    selective_user_ids: [],
    created_by: MASTER_ID,
    created_at: '2026-10-22T10:00:00Z',
    updated_at: '2026-10-22T10:00:00Z',
    players_can_edit: false,
    revision: 1,
  };
  const arrow = (id: number, from: string, to: string, label: string | null, extra: Record<string, unknown> = {}) => ({
    id: uid(id),
    from_end: { card_id: from, group_id: null },
    to_end: { card_id: to, group_id: null },
    direction: 'forward',
    label,
    reverse_label: null,
    label_position: null,
    reverse_label_position: null,
    label_offset: null,
    reverse_label_offset: null,
    color: 'default',
    master_only: false,
    ...extra,
  });
  const card = (id: number, key: keyof typeof DOC, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    id: uid(id),
    document_id: DOC[key],
    text: null,
    group_id: null,
    caption: null,
    image_id: null,
    size: 'normal',
    master_only: false,
    color: 'default',
    struck: false,
    x,
    y,
    ...extra,
  });
  const freeMap = {
    ...mapBase,
    id: uid(501),
    name: t('Who wants the Lens', 'Chi vuole la Lente'),
    description: t('Ties around the missing lens', 'I legami attorno alla lente scomparsa'),
    kind: 'free',
    plane_width: null,
    plane_height: null,
    groups: [
      { id: uid(551), title: t('Greyrock', 'Rocciagrigia'), color: 'blue', struck: false, x: -40, y: -60, width: 620, height: 320 },
    ],
    cards: [
      card(511, 'lens', 760, 120, { color: 'gold', size: 'large' }),
      card(512, 'ilsa', 0, 0, { group_id: uid(551) }),
      card(513, 'tobias', 300, 120, { group_id: uid(551) }),
      card(514, 'prophet', 1200, 120, { color: 'red', master_only: true }),
      card(515, 'seren', 760, 420),
      { ...card(516, 'night', 0, 420), document_id: null, text: t('Who took the lens?', 'Chi ha preso la lente?') },
    ],
    arrows: [
      arrow(521, uid(512), uid(511), t('wants it back', 'la rivuole')),
      arrow(522, uid(512), uid(513), t('trusts', 'si fida di'), { color: 'green' }),
      arrow(523, uid(514), uid(511), t('needs it', 'gli serve'), { color: 'red', master_only: true }),
      arrow(524, uid(515), uid(511), t('studies it', 'la studia')),
    ],
  };
  const place = (key: keyof typeof DOC) => DOC[key];
  const geoMap = {
    ...mapBase,
    id: uid(502),
    name: t('The Greyrock coast', 'La costa di Rocciagrigia'),
    description: t('Where the story happens', 'Dove si svolge la storia'),
    kind: 'geographic',
    plane_width: 2000,
    plane_height: 1400,
    background_url: null,
    areas: [
      { id: uid(531), document_id: place('harbour'), name: null, subtitle: null, note: null, points: [[200, 700], [800, 650], [900, 1150], [250, 1200]], color: 'blue', dashed: false, filled: true, master_only: false },
      { id: uid(532), document_id: null, name: t('The Shallows', 'Le Secche'), subtitle: t('Dangerous at night', 'Pericolose di notte'), note: null, points: [[1100, 500], [1700, 450], [1800, 900], [1150, 950]], color: 'emerald', dashed: true, filled: false, master_only: false },
    ],
    pins: [
      { id: uid(541), document_id: place('lighthouse'), name: null, note: null, x: 700, y: 250, label_side: 'right', color: 'gold', master_only: false },
      { id: uid(542), document_id: place('chapel'), name: null, note: null, x: 1450, y: 700, label_side: 'above', color: 'default', master_only: false },
      { id: uid(543), document_id: place('cove'), name: null, note: null, x: 150, y: 350, label_side: 'right', color: 'brown', master_only: false },
      { id: uid(544), document_id: null, name: t('The old wreck', 'Il vecchio relitto'), note: t('Lost on the Night of the Dark Lamp', 'Perso nella Notte della Lanterna Spenta'), x: 1250, y: 300, label_side: 'below', color: 'red', master_only: true },
    ],
    links: [
      {
        id: uid(561),
        from_end: { area_id: null, pin_id: uid(541) },
        to_end: { area_id: null, pin_id: uid(542) },
        direction: 'forward',
        label: t('the light reaches', 'la luce arriva'),
        reverse_label: null,
        bend: -60,
        label_position: null,
        reverse_label_position: null,
        label_offset: null,
        reverse_label_offset: null,
        color: 'champagne',
        master_only: false,
      },
    ],
  };

  return {
    room: {
      id: DEMO_ROOM_ID,
      name: t('The Lost Lighthouse', 'Il Faro Perduto'),
      game_system: t('Any fantasy system', 'Qualsiasi sistema fantasy'),
      status: 'active',
      players_can_create_documents: true,
      default_visibility: 'room',
      image_url: null,
    },
    members,
    tags,
    documents,
    notes,
    comments,
    maps: [freeMap, geoMap],
  };
}

const cache: Partial<Record<Lang, DemoData>> = {};

/** The sample Room in the UI's language: Italian for Italian, English otherwise. */
export function demoData(language: string): DemoData {
  const lang: Lang = language === 'it' ? 'it' : 'en';
  return (cache[lang] ??= build(lang));
}
