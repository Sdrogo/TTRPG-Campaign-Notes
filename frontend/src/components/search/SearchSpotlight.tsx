import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import {
  Button,
  Chip,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import {
  ChatCircleTextIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  NoteIcon,
  TagIcon,
} from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSearch } from '../../hooks/useSearch';
import { useTags } from '../../hooks/useTags';
import {
  MORE_RESULTS_PER_KIND,
  RESULTS_PER_KIND,
  SEARCH_GROUPS,
  isSearchable,
  searchHitHref,
} from '../../lib/search';
import { HighlightedText } from './HighlightedText';
import type { SearchHit, SearchKind } from '../../types/search';

/** How long typing pauses before the query is sent. */
export const SEARCH_DEBOUNCE_MS = 250;

const ICONS = {
  document: FileTextIcon,
  note: NoteIcon,
  comment: ChatCircleTextIcon,
  tag: TagIcon,
} as const;

interface SearchSpotlightProps {
  roomId: string;
  opened: boolean;
  onClose: () => void;
}

/**
 * The Room's search panel (spec 21_2): a query field, filters by kind and by
 * Tag, and the results grouped by kind with the matched words marked. Arrow
 * keys move through the results and Enter opens one; a click does too. Each
 * leads to the exact place (`searchHitHref`). "Show more" on a group narrows
 * the search to that kind and asks for more of it, until the query, the kind
 * or the Tags change; the kind stays chosen, as its chip shows. Full screen on a phone.
 * The backend decides what the viewer may find, so nothing is filtered here.
 */
export function SearchSpotlight({ roomId, opened, onClose }: SearchSpotlightProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listId = useId();
  const phone = useMediaQuery('(max-width: 48em)');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchKind | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [limit, setLimit] = useState(RESULTS_PER_KIND);
  const [active, setActive] = useState(0);
  const [debounced] = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const tags = useTags(roomId, opened);
  const search = useSearch(roomId, debounced, { kind, tagIds }, limit);
  const searchable = isSearchable(debounced);

  const results = searchable ? search.data : undefined;
  const hits = useMemo<SearchHit[]>(
    () => (results ? SEARCH_GROUPS.flatMap(({ key }) => results[key].items) : []),
    [results],
  );
  // The highlighted result, back on the first one when the list got shorter.
  const current = active < hits.length ? active : 0;

  const changeKind = (next: SearchKind | null) => {
    setKind(next);
    setLimit(RESULTS_PER_KIND);
    setActive(0);
  };
  const open = (hit: SearchHit) => {
    onClose();
    void navigate(searchHitHref(roomId, hit));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(hits[current]);
    }
  };
  const optionId = (index: number) => `${listId}-option-${index}`;

  let body;
  if (!searchable) {
    body = (
      <Text c="dimmed" size="sm">
        {t('search.hint')}
      </Text>
    );
  } else if (!results) {
    body = <Loader size="sm" aria-label={t('search.loading')} />;
  } else if (hits.length === 0) {
    body = (
      <Text c="dimmed" size="sm">
        {t('common.noResults')}
      </Text>
    );
  } else {
    let index = 0;
    body = (
      <Stack gap="md" id={listId} role="listbox" aria-label={t('search.resultsLabel')}>
        {SEARCH_GROUPS.filter(({ key }) => results[key].items.length > 0).map(
          ({ kind: groupKind, key }) => (
            <Stack key={key} gap={4} role="group" aria-label={t(`search.groups.${groupKind}`)}>
              <Text size="xs" fw={600} tt="uppercase" c="dimmed">
                {t(`search.groups.${groupKind}`)}
              </Text>
              {results[key].items.map((hit) => {
                const position = index++;
                return (
                  <SearchOption
                    key={hit.id}
                    id={optionId(position)}
                    roomId={roomId}
                    hit={hit}
                    active={position === current}
                    onHover={() => setActive(position)}
                    onPick={onClose}
                  />
                );
              })}
              {results[key].hasMore && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => {
                    changeKind(groupKind);
                    setLimit(MORE_RESULTS_PER_KIND);
                  }}
                >
                  {t('search.showMore')}
                </Button>
              )}
            </Stack>
          ),
        )}
      </Stack>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('search.title')}
      fullScreen={phone}
      size="lg"
      yOffset="10vh"
    >
      <Stack gap="sm">
        <TextInput
          data-autofocus
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setLimit(RESULTS_PER_KIND);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t('search.placeholder')}
          aria-label={t('search.inputLabel')}
          leftSection={<MagnifyingGlassIcon size={16} />}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={hits.length > 0 ? optionId(current) : undefined}
        />
        <Group gap="xs" align="center">
          <Chip.Group
            value={kind ?? 'all'}
            onChange={(value) => changeKind(value === 'all' ? null : (value as SearchKind))}
          >
            <Chip value="all" size="xs">
              {t('search.kinds.all')}
            </Chip>
            {SEARCH_GROUPS.map(({ kind: option }) => (
              <Chip key={option} value={option} size="xs">
                {t(`search.groups.${option}`)}
              </Chip>
            ))}
          </Chip.Group>
        </Group>
        <MultiSelect
          data={(tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name }))}
          value={tagIds}
          onChange={(next) => {
            setTagIds(next);
            setLimit(RESULTS_PER_KIND);
            setActive(0);
          }}
          placeholder={tagIds.length === 0 ? t('search.tagFilter') : undefined}
          aria-label={t('search.tagFilter')}
          clearable
          searchable
          size="xs"
        />
        {body}
      </Stack>
    </Modal>
  );
}

interface SearchOptionProps {
  id: string;
  roomId: string;
  hit: SearchHit;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

/** One result: its kind's icon, title or Document, and excerpt. */
function SearchOption({ id, roomId, hit, active, onHover, onPick }: SearchOptionProps) {
  const { t } = useTranslation();
  const Icon = ICONS[hit.kind];
  const where =
    hit.kind === 'note'
      ? t('search.inDocument', { name: hit.documentName })
      : hit.kind === 'comment'
        ? t('search.commentOn', { name: hit.documentName })
        : null;
  return (
    <Link
      id={id}
      to={searchHitHref(roomId, hit)}
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      className="search-option"
      onMouseEnter={onHover}
      onClick={onPick}
    >
      <Icon size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
      <Stack gap={2} style={{ minWidth: 0 }}>
        {hit.title && (
          <Text size="sm" fw={600}>
            <HighlightedText value={hit.title} />
          </Text>
        )}
        {where && (
          <Text size="xs" c="dimmed">
            {where}
          </Text>
        )}
        {hit.excerpt && (
          <Text size="xs" c="dimmed" lineClamp={2}>
            <HighlightedText value={hit.excerpt} />
          </Text>
        )}
      </Stack>
    </Link>
  );
}
