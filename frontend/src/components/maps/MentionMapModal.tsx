import { useState } from 'react';
import { Button, Group, Input, Loader, Modal, NativeSelect, SegmentedControl, Stack, Text } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { useBackState } from '../../lib/backNav';
import { useTranslation } from 'react-i18next';
import { useMaps } from '../../hooks/useMaps';
import {
  useLinkMap,
  useCopyMentionMap,
  useDeleteMentionMap,
  useMentionMapPreview,
  useSaveMentionMap,
} from '../../hooks/useMentionMap';
import type { MentionMap } from '../../types/map';

/** The depths offered (spec 36 Decision 2): 0, the first level only, to 3. */
const DEPTHS = ['0', '1', '2', '3'];

/** The target that creates or changes the Document's own mention map. */
const OWN_MAP = '';

/**
 * Creates a Document's mention map or changes it (spec 36 Decision 11): the
 * depth, with what the map would hold at that depth for the viewer, and, for
 * an existing map, copying it as a free map (which then opens) or deleting it.
 * When the viewer manages free maps of the Room, they can instead pick one of
 * them to show on the Document's page as it is (Decision 15).
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
  const backState = useBackState();
  const [depth, setDepth] = useState(map?.depth ?? 0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [target, setTarget] = useState(OWN_MAP);
  const own = target === OWN_MAP;
  const preview = useMentionMapPreview(roomId, documentId, depth, own);
  const save = useSaveMentionMap(roomId, documentId, map !== null);
  const remove = useDeleteMentionMap(roomId, documentId);
  const copy = useCopyMentionMap(roomId, documentId);
  const link = useLinkMap(roomId, documentId);
  // Decision 15: the maps the viewer manages (free or geographic, spec 38) can be shown instead.
  const editable = (useMaps(roomId, true).data ?? []).filter((free) => free.canEdit);
  const error = save.error ?? remove.error ?? copy.error ?? link.error ?? preview.error;
  const empty = preview.data?.relations === 0;

  return (
    <Modal opened onClose={onClose} title={t('maps.mention.title')} centered>
      <Stack gap="sm">
        {editable.length > 0 && (
          <NativeSelect
            label={t('maps.mention.target')}
            description={own ? undefined : t('maps.mention.targetHelp')}
            value={target}
            onChange={(event) => setTarget(event.currentTarget.value)}
            data={[
              {
                value: OWN_MAP,
                label: map ? t('maps.mention.targetOwn') : t('maps.mention.targetNew'),
              },
              ...editable.map((free) => ({ value: free.id, label: free.name })),
            ]}
          />
        )}
        {own && (
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
        )}
        {own && preview.isLoading && <Loader size="xs" aria-label={t('maps.mention.previewLoading')} />}
        {own && preview.data && (
          <Text size="sm" c={empty ? 'dimmed' : undefined} role="status">
            {empty
              ? t('maps.mention.nothingYet')
              : t('maps.mention.preview', {
                  documents: preview.data.documents,
                  relations: preview.data.relations,
                })}
          </Text>
        )}
        {own && preview.data && preview.data.documentsLeftOut > 0 && (
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
              {map && own && (
                <>
                  <Button variant="subtle" color="red" onClick={() => setConfirmingDelete(true)}>
                    {t('maps.delete')}
                  </Button>
                  <Button
                    variant="default"
                    loading={copy.isPending}
                    onClick={() =>
                      copy.mutate(t('maps.mention.copyName', { name: documentName }), {
                        onSuccess: (created) => void navigate(`/rooms/${roomId}/maps/${created.id}`, { state: backState }),
                      })
                    }
                  >
                    {t('maps.mention.copy')}
                  </Button>
                </>
              )}
            </Group>
            {own ? (
              <Button
                disabled={!preview.data || empty}
                loading={save.isPending}
                onClick={() => save.mutate(depth, { onSuccess: onClose })}
              >
                {map ? t('common.save') : t('maps.mention.create')}
              </Button>
            ) : (
              <Button loading={link.isPending} onClick={() => link.mutate(target, { onSuccess: onClose })}>
                {t('maps.mention.addToMap')}
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
