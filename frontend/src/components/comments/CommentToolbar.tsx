import { Button, Checkbox, Group, Select, TextInput } from '@mantine/core';
import { ArrowCounterClockwiseIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { DEFAULT_COMMENT_FILTERS, hasActiveFilters } from '../../lib/comments';
import type { CommentFilters, CommentSortOrder } from '../../types/comment';
import type { DocumentVisibility } from '../../types/document';

const SORT_OPTIONS: { value: CommentSortOrder; label: string }[] = [
  { value: 'newest', label: 'Più recenti' },
  { value: 'oldest', label: 'Meno recenti' },
  { value: 'author', label: 'Per autore' },
];

const VISIBILITY_OPTIONS: { value: DocumentVisibility; label: string }[] = [
  { value: 'room', label: 'Stanza' },
  { value: 'master', label: 'Solo Master' },
  { value: 'private', label: 'Privato' },
  { value: 'selective', label: 'Selettivo' },
];

interface CommentToolbarProps {
  filters: CommentFilters;
  onChange: (filters: CommentFilters) => void;
  authorOptions: { value: string; label: string }[];
}

// Sort + filter controls shown above the Comment list.
export function CommentToolbar({ filters, onChange, authorOptions }: CommentToolbarProps) {
  const set = (patch: Partial<CommentFilters>) => onChange({ ...filters, ...patch });

  return (
    <Group gap="xs" align="center" wrap="wrap">
      <TextInput
        size="xs"
        aria-label="Cerca nei commenti"
        placeholder="Cerca…"
        leftSection={<MagnifyingGlassIcon size={14} />}
        value={filters.query}
        onChange={(event) => set({ query: event.currentTarget.value })}
        style={{ flex: '1 1 160px' }}
      />
      <Select
        size="xs"
        aria-label="Ordina commenti"
        data={SORT_OPTIONS}
        value={filters.sort}
        onChange={(sort) => set({ sort: (sort as CommentSortOrder | null) ?? 'newest' })}
        allowDeselect={false}
        w={140}
      />
      <Select
        size="xs"
        aria-label="Filtra per autore"
        placeholder="Tutti gli autori"
        data={authorOptions}
        value={filters.authorId}
        onChange={(authorId) => set({ authorId })}
        clearable
        searchable
        w={190}
      />
      <Select
        size="xs"
        aria-label="Filtra per visibilità"
        placeholder="Ogni visibilità"
        data={VISIBILITY_OPTIONS}
        value={filters.visibility}
        onChange={(visibility) => set({ visibility: visibility as DocumentVisibility | null })}
        clearable
        w={150}
      />
      <Checkbox
        size="xs"
        label="Nascondi eliminati"
        checked={filters.hideDeleted}
        onChange={(event) => set({ hideDeleted: event.currentTarget.checked })}
      />
      {hasActiveFilters(filters) && (
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<ArrowCounterClockwiseIcon size={14} />}
          onClick={() => onChange({ ...DEFAULT_COMMENT_FILTERS, sort: filters.sort })}
        >
          Azzera filtri
        </Button>
      )}
    </Group>
  );
}
