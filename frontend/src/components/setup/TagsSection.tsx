import type { ReactNode } from 'react';
import { Badge, Grid, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useSetMainItems } from '../../hooks/useMainItems';
import { notifyError } from '../../lib/notify';
import { resolveMainItems } from '../../lib/mainItems';
import type { MainItem, Tag } from '../../types/tag';
import { AllTagsList } from './AllTagsList';
import { GroupingEditor } from './GroupingEditor';

interface TagsSectionProps {
  roomId: string;
  /** Every Tag of the Room. */
  tags: Tag[];
  /** The Main items in their order. */
  items: MainItem[];
}

/** One part of the Tags section: a bordered panel with its heading, count and description. */
function Part({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count: number;
  description: string;
  children: ReactNode;
}) {
  return (
    <Paper withBorder radius="md" p="md" bg="var(--bg-surface)">
      <Stack gap="sm">
        <Stack gap={2}>
          <Group gap="xs">
            <Title order={3} fz="h5">
              {title}
            </Title>
            <Badge size="sm" variant="light" color="gray" radius="sm">
              {count}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
}

/**
 * The Room setup's one Tags section (spec 25c Decision 1): Grouping (the Main
 * items the Documents page groups by) beside All Tags, side by side from `lg`
 * (about 5/12 and 7/12) and stacked below. The Grouping saves on every change,
 * optimistically; a failed save is reported and rolled back.
 */
export function TagsSection({ roomId, tags, items }: TagsSectionProps) {
  const { t } = useTranslation();
  const setMainItems = useSetMainItems(roomId);
  const resolved = resolveMainItems(items, tags);
  const groupedIds = new Set(resolved.flat().map((tag) => tag.id));

  return (
    <Stack gap="sm">
      <Stack gap={2}>
        <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
          {t('setup.tags.title')}
        </Title>
        <Text size="sm" c="dimmed">
          {t('setup.tags.description')}
        </Text>
      </Stack>
      <Grid gap="md" align="flex-start">
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Part
            title={t('setup.tags.grouping.title')}
            count={resolved.length}
            description={t('setup.tags.grouping.description')}
          >
            <GroupingEditor
              tags={tags}
              items={items}
              onChange={(next) => setMainItems.mutate(next, { onError: notifyError })}
            />
          </Part>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Part
            title={t('setup.tags.all.title')}
            count={tags.length}
            description={t('setup.tags.all.description')}
          >
            <AllTagsList roomId={roomId} tags={tags} groupedIds={groupedIds} />
          </Part>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
