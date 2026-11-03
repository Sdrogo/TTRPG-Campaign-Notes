import i18n, { currentLanguage } from '../i18n';
import { itemLabel } from './mainItems';
import { moduleLabel, roundLabel } from './sessionZero';
import type { LandingBlock, LandingSection, SectionKind, SessionZeroFeature } from '../types/landing';
import type { Tag } from '../types/tag';
import type { DdiStep, OverviewStep, Poll } from '../types/sessionZero';

/** The strings' key of each page card (a `page_session_zero` key would read as a plural form). */
const PAGE_KEYS = { page_documents: 'documents', page_maps: 'maps', page_session_zero: 'sessionZero' } as const;

/** A page card's default name, in the viewer's language. */
export function pageName(kind: Exclude<SectionKind, 'custom'>): string {
  return i18n.t(`roomLanding.pages.${PAGE_KEYS[kind]}`);
}

/** A Section card's title: the Master's, else a page card's default name in the viewer's language. */
export function sectionTitle(section: Pick<LandingSection, 'kind' | 'title'>): string {
  if (section.title) return section.title;
  return section.kind === 'custom' ? '' : pageName(section.kind);
}

/** A Section's name in a list: its title, or a placeholder for a custom one without one (an import's preview). */
export function sectionName(section: Pick<LandingSection, 'kind' | 'title'>): string {
  return sectionTitle(section) || i18n.t('documentImport.sections.untitled');
}

/** A Section card's description: the Master's, else a page card's default line. */
export function sectionDescription(section: Pick<LandingSection, 'kind' | 'description'>): string {
  if (section.description || section.kind === 'custom') return section.description;
  return i18n.t(`roomLanding.pageDescriptions.${PAGE_KEYS[section.kind]}`);
}

/** A Session 0 feature's name. */
export function featureLabel(feature: SessionZeroFeature): string {
  return i18n.t(`roomLanding.features.${feature}`);
}

/** The Tags of `ids` that still exist, in the order given. */
export function tagsOf(ids: string[], tags: Tag[]): Tag[] {
  return ids.flatMap((id) => tags.filter((tag) => tag.id === id));
}

/**
 * The name a block goes by without a heading of its own (spec 55, Terms):
 * after its source, "Documenti · #Tokyo, #PNG", "Mappe geografiche", the
 * feature's name for a single one, "Sessione 0" for several.
 */
export function defaultBlockHeading(
  block: Pick<LandingBlock, 'kind' | 'tagIds' | 'mapKind' | 'features' | 'toolKind'>,
  tags: Tag[],
): string {
  if (block.kind === 'documents') {
    const names = tagsOf(block.tagIds, tags).map((tag) => `#${tag.name}`).join(', ');
    return i18n.t('roomLanding.blockTitle.documents', { tags: names });
  }
  if (block.kind === 'maps') {
    if (block.mapKind === 'free') return i18n.t('roomLanding.blockTitle.mapsFree');
    if (block.mapKind === 'geographic') return i18n.t('roomLanding.blockTitle.mapsGeographic');
    return i18n.t('roomLanding.blockTitle.maps');
  }
  if (block.kind === 'tool') return block.toolKind ? moduleLabel(block.toolKind) : i18n.t('roomLanding.tiles.tools');
  return block.features.length === 1 ? featureLabel(block.features[0]) : i18n.t('roomLanding.blockTitle.sessionZero');
}

/** A block's heading: the Master's, else its default name. */
export function blockHeading(block: LandingBlock, tags: Tag[]): string {
  return block.heading ?? defaultBlockHeading(block, tags);
}

/** A group's label in a Documents block: its Tags, "#Tokyo + #PNG". */
export function groupLabel(group: string[], tags: Tag[]): string {
  return itemLabel(tagsOf(group, tags));
}

/** A session's card line: its date and the steps the viewer has reached ("31 ott · Retro, Sondaggio"). */
export function sessionLine(startedAt: string, steps: OverviewStep[]): string {
  const date = new Date(startedAt).toLocaleDateString(currentLanguage(), { day: 'numeric', month: 'short' });
  const kinds = [...new Set(steps.map((step) => moduleLabel(step.kind)))].join(', ');
  return kinds ? `${date} · ${kinds}` : date;
}

/** A step's card title: "Retro · Sessione 1". */
export function stepTitle(step: OverviewStep, round: Parameters<typeof roundLabel>[0]): string {
  return `${moduleLabel(step.kind)} · ${roundLabel(round)}`;
}

/** What a DDI's card says: how many accepted it for the Master, the viewer's own state for a Player. */
function ddiLine(ddi: DdiStep, isMaster: boolean): string {
  if (ddi.documentId === null) return '';
  const current = ddi.acceptances.filter((acceptance) => !acceptance.outdated);
  if (isMaster) return i18n.t('roomLanding.item.ddiAccepted', { count: current.length });
  return current.some((acceptance) => acceptance.mine)
    ? i18n.t('roomLanding.item.ddiAcceptedByYou')
    : i18n.t('roomLanding.item.ddiToAccept');
}

/** A step's card line: its post-its, its questions, or its DDI's acceptances. */
export function stepLine(step: OverviewStep, isMaster: boolean): string {
  if (step.kind === 'questions') return i18n.t('roomLanding.item.questions', { count: step.questions?.questions.length ?? 0 });
  if (step.kind === 'ddi') return step.ddi ? ddiLine(step.ddi, isMaster) : '';
  return i18n.t('roomLanding.item.postIts', { count: step.cards });
}

/** A poll's card line (spec 53/54): open with who voted, or closed with the winner once the viewer sees it. */
export function pollLine(poll: Poll): string {
  if (!poll.closed) return i18n.t('roomLanding.item.pollOpen', { voted: poll.voterCount, total: poll.electorate });
  const winners = poll.options.filter((option) => option.winner).map((option) => option.body);
  return winners.length > 0
    ? i18n.t('roomLanding.item.pollWinner', { choice: winners.join(', ') })
    : i18n.t('roomLanding.item.pollClosed');
}

/** The Lines & Veils card line: each column's published post-its. */
export function linesVeilsLine(counts: Partial<Record<'must' | 'veils' | 'lines', number>>): string {
  return (['lines', 'veils', 'must'] as const)
    .map((kind) => `${i18n.t(`sessionZero.kinds.${kind}`)} ${counts[kind] ?? 0}`)
    .join(' · ');
}
