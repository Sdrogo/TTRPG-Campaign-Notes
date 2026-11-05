import { DEMO_ROOM_ID, DEMO_USER_ID } from './demoMode';

// The Demo's sample Room (spec 45_2, Decision 11; spec 64 moved it to Tokyo):
// "Tokyo by Night", a short modern vampire campaign, in the API's wire shape (snake_case) so the real
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
/** Marco, a Player: plays Jun and owns a Private Document. */
export const MARCO_ID = uid(2);
/** Giulia, a Player: plays Yui and wrote a Selective Note. */
export const GIULIA_ID = uid(3);

const TAG = { npc: uid(101), pc: uid(102), place: uid(103), event: uid(104), artifact: uid(105), district: uid(106), court: uid(107) };
const DOC = {
  mirai: uid(201),
  lobn: uid(202),
  collector: uid(203),
  jun: uid(204),
  yui: uid(205),
  odaiba: uid(206),
  reddoor: uid(207),
  park: uid(208),
  neon: uid(209),
  ledger: uid(210),
  kissa: uid(211),
  kaito: uid(212),
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
  /** The Document's one image (a bundled file under `/demo/`), or null. */
  image: string | null;
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
  room: { id: string; name: string; game_system: string; status: 'active'; players_can_create_documents: boolean; default_visibility: 'room'; image_url: string };
  members: { user_id: string; role: 'master' | 'player'; is_admin: boolean; email: string; display_name: string; pronouns: string | null; bio: string | null; avatar_url: null }[];
  tags: { id: string; name: string; category: string | null; main_position: number | null }[];
  documents: DemoDocument[];
  notes: DemoNote[];
  comments: DemoComment[];
  maps: Record<string, unknown>[];
  /** Spec 61 Decision 30: the clocks, without the viewer's rights (`demoBackend` adds them). */
  clocks: (Record<string, unknown> & { id: string })[];
  clockRules: Record<string, unknown>;
  clockGroups: Record<string, unknown>[];
  /** The "Clocks" Section of the landing, with its Clocks block. */
  clockSection: Record<string, unknown>;
  /** The custom Sections of the landing (spec 55), in the API's wire shape, positions from 3. */
  sections: Record<string, unknown>[];
  /** The Session 0 snapshot, the wire shapes of `GET .../session-zero` (spec 64 Decision 3). */
  sessionZero: DemoSessionZero;
  /** Two revisions of one Document, newest first (spec 24b), by Document id. */
  versions: Record<string, DemoVersion[]>;
}

/** A revision of a Document, as `GET .../versions/{id}` sends it in full. */
export interface DemoVersion {
  id: string;
  title: string;
  subtitle: string | null;
  edited_by: string;
  created_at: string;
  updated_at: string;
  words_added: number | null;
  words_removed: number | null;
  notes_added: number | null;
  notes_removed: number | null;
  description: string;
  notes: { id: string; title: string; description: string }[];
}

/** The Session 0 sample, already played: its chain with the viewer-independent parts. */
export interface DemoSessionZero {
  rounds: Record<string, unknown>[];
  roundId: string;
  modules: Record<string, unknown>[];
  currentModuleId: string;
  linesVeils: Record<string, unknown>[];
  /** The sample poll's option ids with the members who chose them (spec 53). */
  poll: { id: string; options: { id: string; body: string; description: string | null; voters: string[] }[] };
  overviewLinesVeils: Record<string, number>;
}

/** The sample Room's clock ids. */
const DEMO_CLOCK = { escape: uid(601), surrounded: uid(602), lens: uid(603), ritual: uid(604), tide: uid(605) };
const CLOCK_GROUP = { race: uid(611), turn: uid(612) };
const MARK_KIND = { success: uid(621), shock: uid(622) };

/** A Document mention as stored in text (`lib/mentionTokens.ts`). */
function mention(name: string, id: string): string {
  return `#[${name}](doc:${id})`;
}

/** Builds the sample Room in one language. */
function build(lang: Lang): DemoData {
  const t = (en: string, it: string) => (lang === 'it' ? it : en);
  const names = {
    mirai: 'Hoshino Mirai',
    lobn: 'Lobn',
    collector: t('The Collector', 'La Collezionista'),
    kaito: 'Kaito Sera',
    jun: 'Jun Takeda',
    yui: 'Yui Ishida',
    odaiba: t('Odaiba Container Port', 'Porto container di Odaiba'),
    reddoor: t('The Red Door', 'La Porta Rossa'),
    park: t('Ikebukuro Park', 'Il parco di Ikebukuro'),
    neon: t('The Night the Neon Died', 'La Notte in cui Morì il Neon'),
    ledger: t('The Ledger of Favours', 'Il Registro dei Favori'),
    kissa: t('The Net Café', 'Il manga kissa'),
  };
  const m = (key: keyof typeof DOC) => mention(names[key], DOC[key]);
  const image = (file: string) => `/demo/${file}.webp`;
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
    image: null,
    ...fields,
  });

  const documents: DemoDocument[] = [
    doc('mirai', {
      subtitle: t('The perfect face', 'Il volto perfetto'),
      tag_ids: [TAG.npc, TAG.district],
      image: image('mirai'),
      description: t(
        `**Hoshino Mirai** looks twenty and has not aged in a very long time. She is a Tzimisce, and the neon of Shibuya is the only light she still likes.\n\n- She trusts nobody except ${m('lobn')}.\n- She wants ${m('ledger')} back before dawn.\n- She pays in favours, never in money.\n\n> "Everyone owes someone. I only keep count."`,
        `**Hoshino Mirai** sembra una ventenne e non invecchia da moltissimo tempo. È una Tzimisce, e il neon di Shibuya è l'unica luce che ancora le piace.\n\n- Non si fida di nessuno tranne che di ${m('lobn')}.\n- Rivuole ${m('ledger')} prima dell'alba.\n- Paga in favori, mai in denaro.\n\n> «Tutti devono qualcosa a qualcuno. Io tengo solo il conto.»`,
      ),
    }),
    doc('lobn', {
      subtitle: t('Shopkeeper, broker of favours', 'Negoziante, mediatore di favori'),
      tag_ids: [TAG.npc],
      image: image('lobn'),
      description: t(
        `Lobn keeps the shop behind ${m('reddoor')}. He sells tea, old maps and, to those who knock twice, debts. He swears he saw the ledger leave on ${m('neon')}.`,
        `Lobn tiene il negozio dietro ${m('reddoor')}. Vende tè, vecchie mappe e, a chi bussa due volte, debiti. Giura di aver visto il registro uscire durante ${m('neon')}.`,
      ),
    }),
    doc('collector', {
      subtitle: t('Master only: the villain', 'Solo Master: la nemica'),
      visibility: 'master',
      tag_ids: [TAG.npc, TAG.court],
      image: image('collector'),
      description: t(
        `Reiko Mori hides behind round glasses and a perfect smile. She took ${m('ledger')} the night ${m('neon')} went dark, and she means to call every debt in it due at once.\n\nTo do it she needs ${m('mirai')} to read the last page.`,
        `Reiko Mori si nasconde dietro occhiali tondi e un sorriso perfetto. Ha preso ${m('ledger')} la notte in cui ${m('neon')} si è spento, e intende far scadere tutti i debiti in esso scritti nello stesso istante.\n\nPer farlo le serve ${m('mirai')}, che sa leggere l'ultima pagina.`,
      ),
    }),
    doc('jun', {
      subtitle: t('Anarch punk', 'Punk anarchico'),
      tag_ids: [TAG.pc],
      owner_ids: [MARCO_ID],
      played_by: MARCO_ID,
      image: image('jun'),
      description: t(
        `A shaved head, a jacket covered in badges and a laugh that carries across the crossing. He sleeps in ${m('kissa')} and owes ${m('lobn')} more than he can pay.`,
        `Testa rasata, giacca piena di spille e una risata che attraversa l'incrocio. Dorme al ${m('kissa')} e deve a ${m('lobn')} più di quanto possa pagare.`,
      ),
    }),
    doc('yui', {
      subtitle: t('Fixer in a trench coat', 'Faccendiera in trench'),
      tag_ids: [TAG.pc],
      owner_ids: [GIULIA_ID],
      played_by: GIULIA_ID,
      image: image('yui'),
      description: t(
        `Yui sells information and laughs while she does it. She came back to Shibuya after hearing a rumour about ${m('ledger')}.`,
        `Yui vende informazioni e ride mentre lo fa. È tornata a Shibuya dopo aver sentito una voce su ${m('ledger')}.`,
      ),
    }),
    doc('kaito', {
      subtitle: t('Host, informant', 'Host e informatore'),
      tag_ids: [TAG.npc, TAG.district],
      image: image('kaito'),
      description: t(
        `Pink glasses, a silver cross at his ear and a table in every club of the district. Kaito knows who sold the secret of ${m('reddoor')}, and what the price was.`,
        `Occhiali rosa, una croce d'argento all'orecchio e un tavolo in ogni locale del quartiere. Kaito sa chi ha venduto il segreto di ${m('reddoor')}, e a che prezzo.`,
      ),
    }),
    doc('odaiba', {
      subtitle: t('Where the city meets the bay', 'Dove la città incontra la baia'),
      tag_ids: [TAG.place],
      image: image('odaiba'),
      description: t(
        `Stacked containers, rusty stairways and the Rainbow Bridge lit gold over the water. Nobody asks what is in the containers, and the harbour cameras have been broken for a month.`,
        `Container impilati, scale arrugginite e il Rainbow Bridge illuminato d'oro sull'acqua. Nessuno chiede cosa ci sia nei container, e le telecamere del porto sono rotte da un mese.`,
      ),
    }),
    doc('reddoor', {
      subtitle: t('Behind a vending machine', 'Dietro un distributore automatico'),
      tag_ids: [TAG.place, TAG.district],
      image: image('red-door'),
      description: t(
        `A riveted red door in a narrow alley, a paper lantern above it and a vending machine humming beside it. ${m('lobn')} keeps the key.\n\nBehind it, shelves of tea tins and one empty drawer where ${m('ledger')} used to lie.`,
        `Una porta rossa rivettata in un vicolo stretto, una lanterna di carta sopra e un distributore automatico che ronza accanto. ${m('lobn')} ne custodisce la chiave.\n\nDietro, scaffali di scatole di tè e un cassetto vuoto dove stava ${m('ledger')}.`,
      ),
    }),
    doc('park', {
      subtitle: t('A meeting under the tower', 'Un incontro sotto la torre'),
      tag_ids: [TAG.place, TAG.court],
      image: image('ikebukuro'),
      description: t(
        `A small park in Ikebukuro, beneath a black tower. On new moons the whole district gathers around the old stone to hear who owes whom.`,
        `Un piccolo parco a Ikebukuro, sotto una torre nera. Con la luna nuova tutto il quartiere si raduna attorno alla vecchia pietra per sentire chi deve cosa a chi.`,
      ),
    }),
    doc('neon', {
      subtitle: t('One month ago', 'Un mese fa'),
      tag_ids: [TAG.event],
      description: t(
        `The night every sign in Shibuya went dark for eleven minutes. When the lights came back, ${m('ledger')} was gone from ${m('reddoor')}.`,
        `La notte in cui ogni insegna di Shibuya si è spenta per undici minuti. Quando la luce è tornata, ${m('ledger')} non era più in ${m('reddoor')}.`,
      ),
    }),
    doc('ledger', {
      subtitle: t('Missing from the shop', 'Sparito dal negozio'),
      tag_ids: [TAG.artifact],
      description: t(
        `A black book bound in red thread. Every debt of the night-folk of Tokyo is written in it, and what is written there cannot be refused.`,
        `Un libro nero rilegato con filo rosso. Ogni debito della gente della notte di Tokyo è scritto lì, e quello che vi è scritto non si può rifiutare.`,
      ),
    }),
    doc('kissa', {
      subtitle: t("Jun's secret", 'Il segreto di Jun'),
      visibility: 'private',
      owner_ids: [MARCO_ID],
      tag_ids: [TAG.place, TAG.district],
      image: image('kissa'),
      description: t(
        `Private: only Jun's player and the Master see this. A manga kissa at 3am, rows of cubicles lit blue, where Jun's old crew hides stolen phones and one very old safe.`,
        `Privato: lo vedono solo il player di Jun e il Master. Un manga kissa alle 3 di notte, file di cubicoli illuminati di blu, dove la vecchia banda di Jun nasconde telefoni rubati e una cassaforte antichissima.`,
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
    note(1, 'mirai', {
      title: t('Ties', 'Legami'),
      relational_link: true,
      description: t(
        `Mirai trusts ${m('lobn')} and is looking for ${m('ledger')}.`,
        `Mirai si fida di ${m('lobn')} e sta cercando ${m('ledger')}.`,
      ),
    }),
    note(2, 'mirai', {
      title: t('What she hides', 'Cosa nasconde'),
      visibility: 'master',
      description: t(
        `Master only. Mirai wrote the last page of ${m('ledger')} herself, a century ago, and told no one.`,
        `Solo Master. Mirai ha scritto lei l'ultima pagina di ${m('ledger')}, un secolo fa, e non l'ha detto a nessuno.`,
      ),
    }),
    note(3, 'reddoor', {
      title: t('The door', 'La porta'),
      description: t(
        'Three locks. The lowest one is new; somebody has scratched a fox into the paint beside it.',
        'Tre serrature. La più bassa è nuova; qualcuno ha graffiato una volpe nella vernice accanto.',
      ),
    }),
    note(4, 'yui', {
      title: t("Yui's real name", 'Il vero nome di Yui'),
      visibility: 'selective',
      selective_user_ids: [GIULIA_ID],
      author_id: GIULIA_ID,
      description: t(
        `Shared with the Master only: Yui is Reiko Mori's sister. She fears what ${m('collector')} has become.`,
        `Condiviso solo con il Master: Yui è la sorella di Reiko Mori. Teme ciò che è diventata ${m('collector')}.`,
      ),
    }),
    note(5, 'collector', {
      title: t('Plan', 'Piano'),
      relational_link: true,
      description: t(
        `She waits in ${m('park')} for ${m('mirai')} to be brought to her.`,
        `Aspetta nel ${m('park')} che le portino ${m('mirai')}.`,
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
    comment(1, 'neon', {
      author_id: MARCO_ID,
      created_at: '2026-10-20T20:15:00Z',
      body: t(
        `Jun asks around the clubs: did anyone else see the lights die at 11:42, like Lobn says?`,
        `Jun chiede in giro nei locali: qualcun altro ha visto le luci morire alle 23:42, come dice Lobn?`,
      ),
      reactions: [{ emoji: '👀', user_ids: [GIULIA_ID, MASTER_ID] }],
    }),
    comment(2, 'neon', {
      author_id: GIULIA_ID,
      parent_id: uid(401),
      created_at: '2026-10-20T20:40:00Z',
      body: t(
        `Yui checks the power company's records: no blackout was ever logged that night. Whoever did it did not use the grid, and ${m('reddoor')} sits in the middle of the dark zone.`,
        `Yui controlla i registri della società elettrica: quella notte nessun blackout è stato registrato. Chi è stato non ha usato la rete, e ${m('reddoor')} si trova al centro della zona buia.`,
      ),
      reactions: [{ emoji: '🔥', user_ids: [MARCO_ID] }],
    }),
    comment(3, 'neon', {
      author_id: MASTER_ID,
      visibility: 'master',
      created_at: '2026-10-20T21:00:00Z',
      body: t(
        'Master only: next session, Kaito shows up with a ticket to Odaiba.',
        'Solo Master: alla prossima sessione Kaito si presenta con un biglietto per Odaiba.',
      ),
    }),
    comment(4, 'reddoor', {
      author_id: GIULIA_ID,
      created_at: '2026-10-21T18:00:00Z',
      body: t(
        `The empty drawer has a perfect rectangle of clean wood, as if ${m('ledger')} had lain there for a century.`,
        `Il cassetto vuoto ha un rettangolo perfetto di legno pulito, come se ${m('ledger')} vi fosse rimasto un secolo.`,
      ),
    }),
  ];

  const tags = [
    { id: TAG.npc, name: t('NPC', 'PNG'), category: null, main_position: 0 },
    { id: TAG.pc, name: t('PC', 'PG'), category: null, main_position: 1 },
    { id: TAG.place, name: t('Place', 'Luogo'), category: null, main_position: 2 },
    { id: TAG.event, name: t('Event', 'Evento'), category: null, main_position: 3 },
    { id: TAG.artifact, name: t('Artifact', 'Artefatto'), category: null, main_position: 4 },
    { id: TAG.district, name: t('Shibuya at night', 'Shibuya di notte'), category: t('District', 'Quartiere'), main_position: null },
    { id: TAG.court, name: t('The Quiet Court', 'La Corte Silenziosa'), category: t('Faction', 'Fazione'), main_position: null },
  ];

  const members = [
    { user_id: MASTER_ID, role: 'master' as const, is_admin: true, email: 'master@demo.exlibris.world', display_name: 'Morgan', pronouns: null, bio: t('Runs the campaign', 'Guida la campagna'), avatar_url: null },
    { user_id: MARCO_ID, role: 'player' as const, is_admin: false, email: 'marco@demo.exlibris.world', display_name: 'Marco', pronouns: null, bio: t('Plays Jun', 'Gioca Jun'), avatar_url: null },
    { user_id: GIULIA_ID, role: 'player' as const, is_admin: false, email: 'giulia@demo.exlibris.world', display_name: 'Giulia', pronouns: null, bio: t('Plays Yui', 'Gioca Yui'), avatar_url: null },
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
    name: t('Who wants the Ledger', 'Chi vuole il Registro'),
    description: t('Ties around the missing book', 'I legami attorno al libro scomparso'),
    kind: 'free',
    plane_width: null,
    plane_height: null,
    groups: [
      { id: uid(551), title: t('Red Door', 'Porta Rossa'), color: 'red', struck: false, x: -40, y: -60, width: 620, height: 320 },
    ],
    cards: [
      card(511, 'ledger', 760, 120, { color: 'gold', size: 'large' }),
      card(512, 'mirai', 0, 0, { group_id: uid(551) }),
      card(513, 'lobn', 300, 120, { group_id: uid(551) }),
      card(514, 'collector', 1200, 120, { color: 'red', master_only: true }),
      card(515, 'kaito', 760, 420),
      { ...card(516, 'neon', 0, 420), document_id: null, text: t('Who took the book?', 'Chi ha preso il libro?') },
    ],
    // Two arrows between Mirai and the Ledger, one each way: they bend apart (spec 62).
    arrows: [
      arrow(521, uid(512), uid(511), t('wants it back', 'lo rivuole')),
      arrow(525, uid(511), uid(512), t('owes her', 'le deve'), { color: 'blue' }),
      arrow(522, uid(512), uid(513), t('trusts', 'si fida di'), { color: 'green' }),
      arrow(523, uid(514), uid(511), t('holds it', 'lo tiene'), { color: 'red', master_only: true }),
      arrow(524, uid(515), uid(511), t('sold the secret', 'ha venduto il segreto')),
    ],
  };
  const place = (key: keyof typeof DOC) => DOC[key];
  const geoMap = {
    ...mapBase,
    id: uid(502),
    name: t('Tokyo by night', 'Tokyo di notte'),
    description: t('Where the story happens', 'Dove si svolge la storia'),
    kind: 'geographic',
    plane_width: 1600,
    plane_height: 2125,
    background_url: image('marunouchi'),
    areas: [
      { id: uid(531), document_id: null, name: 'Shibuya', subtitle: t('A thousand phones', 'Mille telefoni'), note: null, points: [[250, 700], [1000, 650], [1100, 1250], [300, 1300]], color: 'violet', dashed: false, filled: true, master_only: false },
      { id: uid(532), document_id: place('odaiba'), name: null, subtitle: null, note: null, points: [[900, 1500], [1450, 1450], [1500, 1950], [950, 2000]], color: 'blue', dashed: true, filled: false, master_only: false },
    ],
    pins: [
      { id: uid(541), document_id: place('reddoor'), name: null, note: null, x: 700, y: 900, label_side: 'right', color: 'gold', master_only: false },
      { id: uid(542), document_id: place('park'), name: null, note: null, x: 400, y: 300, label_side: 'right', color: 'default', master_only: false },
      { id: uid(543), document_id: place('kissa'), name: null, note: null, x: 380, y: 1150, label_side: 'right', color: 'brown', master_only: false },
      { id: uid(544), document_id: null, name: 'Ginza', note: t('Old money, new blood', 'Vecchi soldi, sangue nuovo'), x: 1150, y: 1150, label_side: 'below', color: 'emerald', master_only: false },
      { id: uid(545), document_id: null, name: t("The Ledger's last known place", "L'ultimo posto noto del Registro"), note: t('Seen on the night of the blackout', 'Visto la notte del blackout'), x: 1200, y: 480, label_side: 'below', color: 'red', master_only: true },
    ],
    links: [
      {
        id: uid(561),
        from_end: { area_id: null, pin_id: uid(541) },
        to_end: { area_id: null, pin_id: uid(542) },
        direction: 'forward',
        label: t('the Court meets there', 'la Corte si riunisce lì'),
        reverse_label: null,
        bend: -60,
        label_position: null,
        reverse_label_position: null,
        label_offset: null,
        reverse_label_offset: null,
        color: 'champagne',
        master_only: false,
      },
      {
        id: uid(562),
        from_end: { area_id: null, pin_id: uid(541) },
        to_end: { area_id: null, pin_id: uid(543) },
        direction: 'both',
        label: t('debts paid in cash', 'debiti pagati in contanti'),
        reverse_label: null,
        bend: 90,
        label_position: null,
        reverse_label_position: null,
        label_offset: null,
        reverse_label_offset: null,
        color: 'default',
        master_only: false,
      },
    ],
  };

  // Spec 64 Decision 3: a Session 0 already played (steps: Lines and Veils, Stars and Wishes, a poll).
  const postIt = (id: number, columnId: string, position: number, body: string, authorId: string | null, reactions: { emoji: string; user_ids: string[] }[] = []) => ({
    id: uid(id),
    column_id: columnId,
    group_id: null,
    position,
    body,
    author_id: authorId,
    anonymous: false,
    mine: false,
    draft: false,
    from_retro: false,
    published_at: '2026-10-18T19:30:00Z',
    created_at: '2026-10-18T19:20:00Z',
    updated_at: '2026-10-18T19:20:00Z',
    reactions: reactions.map((r) => ({ emoji: r.emoji, count: r.user_ids.length, reacted_by_me: false, user_ids: r.user_ids })),
    can_edit: false,
    can_delete: false,
    can_publish: false,
    can_promote: false,
    can_move: false,
    can_react: false,
    can_group: false,
    can_place: false,
  });
  const column = (id: number, kind: string | null, title: string, color: string, cards: ReturnType<typeof postIt>[]) => ({
    id: uid(id),
    kind,
    title,
    color,
    groups: [],
    cards,
  });
  const linesVeils = [
    column(721, 'must', t('Must have', 'Imprescindibile'), 'green', [
      postIt(731, uid(721), 0, t('Rain, neon and a lot of tea', 'Pioggia, neon e molto tè'), GIULIA_ID, [{ emoji: '🔥', user_ids: [MARCO_ID] }]),
    ]),
    column(722, 'veils', t('Veils', 'Veli'), 'gold', [
      postIt(732, uid(722), 0, t('Feeding on screen: fade to black', 'Il nutrirsi in scena: dissolvenza al nero'), MARCO_ID),
    ]),
    column(723, 'lines', t('Lines', 'Linee'), 'red', [
      postIt(733, uid(723), 0, t('No harm to children, ever', 'Nessun danno ai bambini, mai'), GIULIA_ID, [{ emoji: '👍', user_ids: [MARCO_ID, MASTER_ID] }]),
      postIt(734, uid(723), 1, t('No real-world hate groups', 'Nessun gruppo d\'odio reale'), MASTER_ID),
    ]),
  ];
  const starsColumns = [
    column(724, 'stars', t('Stars', 'Stelle'), 'gold', [
      postIt(735, uid(724), 0, t('The Red Door scene: perfect pacing', 'La scena della Porta Rossa: ritmo perfetto'), MARCO_ID, [{ emoji: '⭐', user_ids: [GIULIA_ID, MASTER_ID] }]),
      postIt(736, uid(724), 1, t('Lobn is already everybody\'s favourite', 'Lobn è già il preferito di tutti'), GIULIA_ID),
    ]),
    column(725, 'wishes', t('Wishes', 'Desideri'), 'blue', [
      postIt(737, uid(725), 0, t('More time in the city, less in the car', 'Più tempo in città, meno in macchina'), MARCO_ID),
      postIt(738, uid(725), 1, t('A scene with the Court at the park', 'Una scena con la Corte al parco'), GIULIA_ID, [{ emoji: '👀', user_ids: [MARCO_ID] }]),
    ]),
  ];
  const pollOptions = [
    { id: uid(751), body: 'Shibuya', description: t('Neon, crowds and Lobn\'s shop', 'Neon, folla e il negozio di Lobn'), voters: [GIULIA_ID, MASTER_ID] },
    { id: uid(752), body: t('Odaiba', 'Odaiba'), description: t('Containers and the bridge', 'Container e il ponte'), voters: [MARCO_ID] },
    { id: uid(753), body: 'Ikebukuro', description: null, voters: [] },
  ];
  const session = {
    rounds: [{ id: uid(701), number: 1, title: null, started_at: '2026-10-18T19:00:00Z', closed_at: null }],
    roundId: uid(701),
    modules: [
      { id: uid(711), kind: 'lines_veils', position: 0, columns: [] },
      { id: uid(712), kind: 'stars_wishes', position: 1, columns: starsColumns },
      {
        id: uid(713),
        kind: 'poll',
        position: 2,
        columns: [],
        polls: [
          {
            id: uid(741),
            body: t('Where does the first session start?', 'Dove comincia la prima sessione?'),
            hint: t('Pick one place', 'Scegli un luogo'),
            max_choices: 1,
            master_votes: true,
            voters_visible: 'everyone',
            results: 'live',
            revealed: false,
            closed: true,
            has_votes: true,
            options: pollOptions.map((option) => ({ id: option.id, body: option.body, description: option.description, count: option.voters.length, voters: option.voters, winner: option.id === uid(751) })),
            my_option_ids: [],
            voter_count: 3,
            electorate: 3,
            not_voted: null,
            tally_visible: true,
            can_vote: false,
          },
        ],
      },
    ],
    currentModuleId: uid(712),
    linesVeils,
    poll: { id: uid(741), options: pollOptions },
    overviewLinesVeils: { must: 1, veils: 1, lines: 2 },
  };

  // Spec 24b: two revisions of Mirai's Document, newest first.
  const miraiOld = t(
    `Hoshino Mirai looks twenty. She is a Tzimisce and she wants the Ledger back.`,
    `Hoshino Mirai sembra una ventenne. È una Tzimisce e rivuole il Registro.`,
  );
  const versions: Record<string, DemoVersion[]> = {
    [DOC.mirai]: [
      {
        id: uid(802),
        title: names.mirai,
        subtitle: t('The perfect face', 'Il volto perfetto'),
        edited_by: MASTER_ID,
        created_at: '2026-10-24T18:00:00Z',
        updated_at: '2026-10-24T18:05:00Z',
        words_added: 38,
        words_removed: 3,
        notes_added: 1,
        notes_removed: 0,
        description: documents[0].description,
        notes: notes.filter((n) => n.document_id === DOC.mirai && n.visibility === 'room').map((n) => ({ id: n.id, title: n.title, description: n.description })),
      },
      {
        id: uid(801),
        title: names.mirai,
        subtitle: null,
        edited_by: MASTER_ID,
        created_at: '2026-10-20T10:00:00Z',
        updated_at: '2026-10-20T10:00:00Z',
        words_added: null,
        words_removed: null,
        notes_added: null,
        notes_removed: null,
        description: miraiOld,
        notes: [],
      },
    ],
  };

  // Spec 55 / 60: the Sections of the Room's landing after the three page cards.
  const block = (id: number, position: number, fields: Record<string, unknown>) => ({
    id: uid(id),
    kind: 'documents',
    position,
    heading: null,
    tag_ids: [],
    groups: [],
    map_kind: null,
    features: [],
    collapsed: false,
    module_id: null,
    tool_kind: null,
    players_visible: null,
    clock_chips: [],
    all_clocks: false,
    ...fields,
  });
  const section = (id: number, position: number, title: string, description: string, imageFile: string | null, blocks: Record<string, unknown>[]) => ({
    id: uid(id),
    kind: 'custom',
    position,
    title,
    description,
    image_url: imageFile ? image(imageFile) : null,
    blocks,
  });
  const sections = [
    section(641, 3, t('The cast', 'Il cast'), t('Who you will meet in the night, and who plays whom.', 'Chi incontrerai nella notte, e chi interpreta chi.'), 'mirai', [
      block(651, 0, { kind: 'documents', heading: t('Characters of the Master', 'Personaggi del Master'), tag_ids: [TAG.npc] }),
      block(652, 1, { kind: 'documents', heading: t('The players', 'I giocatori'), tag_ids: [TAG.pc] }),
    ]),
    section(642, 4, t('The city', 'La città'), t('The places of the story and their map.', 'I luoghi della storia e la loro mappa.'), 'red-door', [
      block(653, 0, { kind: 'documents', tag_ids: [TAG.place] }),
      block(654, 1, { kind: 'maps' }),
    ]),
    section(643, 5, t('How we play', 'Come giochiamo'), t('What the table agreed in Session 0.', 'Ciò che il tavolo ha deciso nella Sessione 0.'), null, [
      block(655, 0, { kind: 'session_zero', features: ['lines_veils', 'stars_wishes', 'polls'] }),
    ]),
  ];

  // Spec 61 Decision 30: a race, a turn with Successo / Shock marks, a countdown with stages.
  const clock = (id: string, name: string, segments: number, color: string, kinds: (string | null)[], extra: Record<string, unknown> = {}) => ({
    id,
    room_id: DEMO_ROOM_ID,
    name,
    description: '',
    segments,
    filled: kinds.length,
    color,
    stage_labels: [],
    closing_condition: null,
    consequence: null,
    forward_only: false,
    mark_policy: null,
    label_ids: [],
    state: 'open',
    archived: false,
    group_id: null,
    group_position: null,
    decisive_label: null,
    document: null,
    segment_kinds: kinds,
    visibility: 'room',
    selective_user_ids: null,
    created_by: MASTER_ID,
    created_at: '2026-11-01T20:00:00Z',
    updated_at: '2026-11-01T21:30:00Z',
    revision: kinds.length,
    locked: false,
    ...extra,
  });
  const s = MARK_KIND.success;
  const k = MARK_KIND.shock;
  const clocks = [
    clock(DEMO_CLOCK.escape, t('Escape', 'Fuga'), 6, 'green', [s, s, null], {
      group_id: CLOCK_GROUP.race,
      group_position: 0,
      closing_condition: t('Reach the taxi at the corner', "Raggiungere il taxi all'angolo"),
    }),
    clock(DEMO_CLOCK.surrounded, t('Surrounded', 'Accerchiati'), 6, 'red', [null, null, null, null], {
      group_id: CLOCK_GROUP.race,
      group_position: 1,
      closing_condition: t("The Court's hounds block the alley", 'I segugi della Corte bloccano il vicolo'),
    }),
    clock(DEMO_CLOCK.lens, t('Recover the Ledger', 'Recuperare il Registro'), 8, 'blue', [s, s, s], {
      group_id: CLOCK_GROUP.turn,
      group_position: 0,
      decisive_label: t('The book is ours', 'Il libro è nostro'),
      document: { id: DOC.ledger, name: names.ledger },
    }),
    clock(DEMO_CLOCK.ritual, t("The Collector's plan", 'Il piano della Collezionista'), 6, 'violet', [k, k, s, k], {
      group_id: CLOCK_GROUP.turn,
      group_position: 1,
      decisive_label: t('Every debt falls due', 'Ogni debito scade'),
      consequence: t('The whole city owes her', 'Tutta la città le deve qualcosa'),
    }),
    clock(DEMO_CLOCK.tide, t('Dawn approaches', "L'alba si avvicina"), 6, 'gold', [null, null], {
      stage_labels: [
        t('The sky greys over Odaiba', 'Il cielo ingrigisce su Odaiba'),
        t('The first trains run', 'Partono i primi treni'),
        t('Commuters fill the streets', 'I pendolari riempiono le strade'),
        t('The birds start singing', 'Cominciano a cantare gli uccelli'),
        t('The rooftops glow', 'I tetti si illuminano'),
        t('Sunrise', 'Alba'),
      ],
    }),
  ];
  const group = (id: string, name: string, mode: string, ids: string[], position: number) => ({
    id,
    name,
    mode,
    position,
    clock_ids: ids,
    ended: false,
    result: null,
    pending_ids: [],
    revision: 1,
  });
  const clockGroups = [
    group(CLOCK_GROUP.race, t('Out of the Red Door', 'Fuori dalla Porta Rossa'), 'race', [DEMO_CLOCK.escape, DEMO_CLOCK.surrounded], 0),
    group(CLOCK_GROUP.turn, t('The night of the Ledger', 'La notte del Registro'), 'turn', [DEMO_CLOCK.lens, DEMO_CLOCK.ritual], 1),
  ];
  const clockRules = {
    open_policy: 'master',
    mark_policy: 'master',
    allow_unmark: true,
    labels: [],
    mark_kinds: [
      { id: MARK_KIND.success, name: t('Success', 'Successo'), color: 'green', who: 'everyone', position: 0 },
      { id: MARK_KIND.shock, name: 'Shock', color: 'red', who: 'master', position: 1 },
    ],
    templates: [],
  };
  const clockSection = {
    id: uid(631),
    kind: 'custom',
    position: 6,
    title: t("Tonight's clocks", 'I Clock di stanotte'),
    description: t(
      'What is coming tonight: the escape, the plan, the dawn. Mark them as the story goes.',
      'Cosa arriva stanotte: la fuga, il piano, l\'alba. Segnali man mano che la storia va avanti.',
    ),
    image_url: null,
    blocks: [
      {
        id: uid(632),
        kind: 'clocks',
        position: 0,
        heading: null,
        tag_ids: [],
        groups: [],
        map_kind: null,
        features: [],
        collapsed: false,
        module_id: null,
        tool_kind: null,
        players_visible: null,
        clock_chips: [
          { clock_id: null, group_id: CLOCK_GROUP.race },
          { clock_id: null, group_id: CLOCK_GROUP.turn },
          { clock_id: DEMO_CLOCK.tide, group_id: null },
        ],
        all_clocks: false,
      },
    ],
  };

  return {
    room: {
      id: DEMO_ROOM_ID,
      name: 'Tokyo by Night',
      game_system: t('Any vampire game', 'Qualsiasi gioco di vampiri'),
      status: 'active',
      players_can_create_documents: true,
      default_visibility: 'room',
      image_url: image('ikebukuro'),
    },
    members,
    tags,
    documents,
    notes,
    comments,
    maps: [freeMap, geoMap],
    clocks,
    clockRules,
    clockGroups,
    clockSection,
    sections,
    sessionZero: session,
    versions,
  };
}

const cache: Partial<Record<Lang, DemoData>> = {};

/** The sample Room in the UI's language: Italian for Italian, English otherwise. */
export function demoData(language: string): DemoData {
  const lang: Lang = language === 'it' ? 'it' : 'en';
  return (cache[lang] ??= build(lang));
}
