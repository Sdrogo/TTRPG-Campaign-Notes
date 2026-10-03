import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useDeleteTag } from '../../hooks/useTags';
import { notifyError, notifySuccess } from '../../lib/notify';
import { sortTagsByName } from '../../lib/tags';
import type { Tag } from '../../types/tag';

interface TagManagementProps {
  roomId: string;
  /** Every Tag of the Room. */
  tags: Tag[];
}

/**
 * The Room setup's Tag list (spec 13): every Tag with a delete button that
 * asks for confirmation first. Deleting changes how every Document is
 * grouped, but never removes a Document. The confirmation names no Document
 * count: the backend has none that respects visibility (VR-07), and the
 * client only knows the Documents the viewer may see.
 */
export function TagManagement({ roomId, tags }: TagManagementProps) {
  const { t } = useTranslation();
  const deleteTag = useDeleteTag(roomId);
  const [pending, setPending] = useState<Tag | null>(null);

  const handleDelete = (tag: Tag) => {
    deleteTag.mutate(tag.id, {
      onSuccess: () => {
        notifySuccess(t('setup.tags.deleted', { name: tag.name }));
        setPending(null);
      },
      onError: notifyError,
    });
  };

  return (
    <Stack gap="sm">
      <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
        {t('setup.tags.title')}
      </Title>
      <Text size="sm" c="dimmed">
        {t('setup.tags.description')}
      </Text>

      {tags.length === 0 ? (
        <Text size="sm">{t('setup.tags.empty')}</Text>
      ) : (
        <Stack component="ul" gap="xs" p={0} m={0} style={{ listStyle: 'none' }}>
          {sortTagsByName(tags).map((tag) => (
            <Paper key={tag.id} component="li" withBorder p="xs" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                  {tag.name}
                  {tag.category && (
                    <Text span c="dimmed">
                      {' '}
                      · {tag.category}
                    </Text>
                  )}
                </Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={t('setup.tags.delete', { name: tag.name })}
                  onClick={() => setPending(tag)}
                >
                  <TrashIcon size={16} />
                </ActionIcon>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {pending && (
        <Modal
          opened
          onClose={() => setPending(null)}
          title={t('setup.tags.confirmTitle', { name: pending.name })}
          centered
        >
          <Stack gap="md">
            <Text size="sm">{t('setup.tags.confirmBody')}</Text>
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                color="red"
                loading={deleteTag.isPending}
                onClick={() => handleDelete(pending)}
              >
                {t('common.delete')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
