import { useState } from 'react';
import { Button, Group, Input, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useCopyMentionMap,
  useDeleteMentionMap,
  useMentionMapPreview,
  useSaveMentionMap,
} from '../../hooks/useMentionMap';
import type { MentionMap } from '../../types/map';

/** The depths offered (spec 36 Decision 2): 0, the first level only, to 3. */
const DEPTHS = ['0', '1', '2', '3'];

/**
 * Creates a Document's mention map or changes it (spec 36 Decision 11): the
 * depth, with what the map would hold at that depth for the viewer, and, for
 * an existing map, copying it as a free map (which then opens) or deleting it.
 */
export function MentionMapModal({
  roomId,
  documentId,
  documentName,
  map,
  onClose,
}: {
  roomId: string;
  documentId: string;
  documentName: string;
  /** The Document's mention map, or null to create one. */
  map: MentionMap | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [depth, setDepth] = useState(map?.depth ?? 0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const preview = useMentionMapPreview(roomId, documentId, depth, true);
  const save = useSaveMentionMap(roomId, documentId, map !== null);
  const remove = useDeleteMentionMap(roomId, documentId);
  const copy = useCopyMentionMap(roomId, documentId);
  const error = save.error ?? remove.error ?? copy.error ?? preview.error;
  const empty = preview.data?.relations === 0;

  return (
    <Modal opened onClose={onClose} title={t('maps.mention.title')} centered>
      <Stack gap="sm">
        <Input.Wrapper label={t('maps.mention.depth')} description={t('maps.mention.depthHelp')}>
          <SegmentedControl
            mt={6}
            fullWidth
            data={DEPTHS}
            value={String(depth)}
            onChange={(value) => setDepth(Number(value))}
            aria-label={t('maps.mention.depth')}
          />
        </Input.Wrapper>
        {preview.data && (
          <Text size="sm" c={empty ? 'dimmed' : undefined} role="status">
            {empty
              ? t('maps.mention.nothingYet')
              : t('maps.mention.preview', {
                  documents: preview.data.documents,
                  relations: preview.data.relations,
                })}
          </Text>
        )}
        {preview.data && preview.data.documentsLeftOut > 0 && (
          <Text size="sm" c="dimmed">
            {t('maps.mention.leftOut', { number: preview.data.documentsLeftOut })}
          </Text>
        )}
        {error && <Text c="red">{error.message}</Text>}
        {confirmingDelete ? (
          <Stack gap="xs">
            <Text fw={600}>{t('maps.deleteConfirmTitle')}</Text>
            <Text size="sm">{t('maps.mention.deleteConfirmBody')}</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmingDelete(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                color="red"
                loading={remove.isPending}
                onClick={() => remove.mutate(undefined, { onSuccess: onClose })}
              >
                {t('common.delete')}
              </Button>
            </Group>
          </Stack>
        ) : (
          <Group justify="space-between">
            <Group gap="xs">
              {map && (
                <>
                  <Button variant="subtle" color="red" onClick={() => setConfirmingDelete(true)}>
                    {t('maps.delete')}
                  </Button>
                  <Button
                    variant="default"
                    loading={copy.isPending}
                    onClick={() =>
                      copy.mutate(t('maps.mention.copyName', { name: documentName }), {
                        onSuccess: (created) => void navigate(`/rooms/${roomId}/maps/${created.id}`),
                      })
                    }
                  >
                    {t('maps.mention.copy')}
                  </Button>
                </>
              )}
            </Group>
            <Button
              disabled={!preview.data || empty}
              loading={save.isPending}
              onClick={() => save.mutate(depth, { onSuccess: onClose })}
            >
              {map ? t('common.save') : t('maps.mention.create')}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
