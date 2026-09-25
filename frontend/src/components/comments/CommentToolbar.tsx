import { Button, Checkbox, Group, Select, TextInput } from '@mantine/core';
import { ArrowCounterClockwiseIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { DEFAULT_COMMENT_FILTERS, hasActiveFilters } from '../../lib/comments';
import type { CommentFilters, CommentSortOrder } from '../../types/comment';
import type { DocumentVisibility } from '../../types/document';
import { useTranslation } from 'react-i18next';

const VISIBILITY_LEVELS: DocumentVisibility[] = ['room', 'master', 'private', 'selective'];

interface CommentToolbarProps {
  filters: CommentFilters;
  onChange: (filters: CommentFilters) => void;
  authorOptions: { value: string; label: string }[];
}

/** Sort + filter controls shown above the Comment list. */
export function CommentToolbar({ filters, onChange, authorOptions }: CommentToolbarProps) {
  const { t } = useTranslation();
  const sortOptions: { value: CommentSortOrder; label: string }[] = [
    { value: 'newest', label: t('comments.toolbar.sortNewest') },
    { value: 'oldest', label: t('comments.toolbar.sortOldest') },
    { value: 'author', label: t('comments.toolbar.sortAuthor') },
  ];
  const visibilityOptions = VISIBILITY_LEVELS.map((level) => ({
    value: level,
    label: t(`visibility.level.${level}`),
  }));
  const set = (patch: Partial<CommentFilters>) => onChange({ ...filters, ...patch });

  return (
    <Group gap="xs" align="center" wrap="wrap">
      <TextInput
        size="xs"
        aria-label={t('comments.toolbar.searchLabel')}
        placeholder={t('comments.toolbar.searchPlaceholder')}
        leftSection={<MagnifyingGlassIcon size={14} />}
        value={filters.query}
        onChange={(event) => set({ query: event.currentTarget.value })}
        style={{ flex: '1 1 160px' }}
      />
      <Select
        size="xs"
        aria-label={t('comments.toolbar.sortLabel')}
        data={sortOptions}
        value={filters.sort}
        onChange={(sort) => set({ sort: (sort as CommentSortOrder | null) ?? 'newest' })}
        allowDeselect={false}
        w={140}
      />
      <Select
        size="xs"
        aria-label={t('comments.toolbar.authorLabel')}
        placeholder={t('comments.toolbar.authorPlaceholder')}
        data={authorOptions}
        value={filters.authorId}
        onChange={(authorId) => set({ authorId })}
        clearable
        searchable
        w={190}
      />
      <Select
        size="xs"
        aria-label={t('comments.toolbar.visibilityLabel')}
        placeholder={t('comments.toolbar.visibilityPlaceholder')}
        data={visibilityOptions}
        value={filters.visibility}
        onChange={(visibility) => set({ visibility: visibility as DocumentVisibility | null })}
        clearable
        w={150}
      />
      <Checkbox
        size="xs"
        label={t('comments.toolbar.hideDeleted')}
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
          {t('common.resetFilters')}
        </Button>
      )}
    </Group>
  );
}
