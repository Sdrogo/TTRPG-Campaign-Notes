import { useState } from 'react';
import {
  Badge,
  Button,
  Drawer,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useRestoreVersion, useVersion, useVersions } from '../../hooks/useVersions';
import { findMember, memberDisplayName } from '../../lib/members';
import { notifyError, notifySuccess } from '../../lib/notify';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { isSameText } from '../../lib/versions';
import type { Member } from '../../types/member';
import type { Version } from '../../types/version';
import { UserAvatar } from '../UserAvatar';
import { VersionDiff } from './VersionDiff';

interface VersionHistoryDrawerProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
  documentId: string;
  /** Set for a Note's history; absent for the Document's own. */
  noteId?: string;
  /** The Document's name or the Note's title now, for the drawer's title. */
  name: string;
  /** The text in force now, which every version is compared with. */
  current: { title: string; description: string };
  members: Member[];
}

function ChangeSize({ version }: { version: Version }) {
  const { t } = useTranslation();
  if (version.wordsAdded === null || version.wordsRemoved === null) {
    return (
      <Text size="xs" c="dimmed">
        {t('versions.first')}
      </Text>
    );
  }
  const counts = { added: version.wordsAdded, removed: version.wordsRemoved };
  return (
    <Text size="xs" c="dimmed" aria-label={t('versions.changeSizeLabel', counts)}>
      {t('versions.changeSize', counts)}
    </Text>
  );
}

/**
 * The history of a Document's text or of one Note's (spec 24), for the people
 * who may edit it: a list of versions (who saved it, when, how many words it
 * changed), and, for the one chosen, the comparison with the text in force and
 * a "Restore" behind a confirmation. Restoring adds a version, so nothing is
 * lost. The list is only read while the drawer is open.
 */
export function VersionHistoryDrawer({
  opened,
  onClose,
  roomId,
  documentId,
  noteId,
  name,
  current,
  members,
}: VersionHistoryDrawerProps) {
  const { t } = useTranslation();
  const versions = useVersions(roomId, documentId, noteId, opened);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const selected = useVersion(roomId, documentId, noteId, selectedId);
  const restore = useRestoreVersion(roomId, documentId, noteId);
  const newestId = versions.data?.[0]?.id;
  const selectedDetail = selected.data?.id === selectedId ? selected.data : undefined;
  const identical = selectedDetail ? isSameText(selectedDetail, current) : false;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      title={t('versions.title', { name })}
    >
      {versions.isPending && opened ? (
        <Loader color="accent" size="sm" />
      ) : versions.isError ? (
        <Text c="red" size="sm">
          {t('versions.loadFailed')}
        </Text>
      ) : versions.data?.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('versions.empty')}
        </Text>
      ) : (
        <Stack gap="md">
          <Stack gap={2} role="list">
            {versions.data?.map((version) => {
              const author = findMember(members, version.editedBy);
              const active = version.id === selectedId;
              return (
                <div key={version.id} role="listitem">
                  <UnstyledButton
                    onClick={() => setSelectedId(version.id)}
                    aria-pressed={active}
                    p="xs"
                    style={{
                      borderRadius: 'var(--mantine-radius-md)',
                      background: active ? 'var(--mantine-color-default-hover)' : undefined,
                    }}
                  >
                    <Group gap="sm" wrap="nowrap">
                      <UserAvatar user={author} size={28} />
                      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {memberDisplayName(author)}
                        </Text>
                        <Tooltip label={formatAbsoluteTime(version.updatedAt)} withArrow>
                          <Text size="xs" c="dimmed">
                            {formatRelativeTime(version.updatedAt)}
                          </Text>
                        </Tooltip>
                      </Stack>
                      {version.id === newestId && (
                        <Badge size="xs" variant="light" color="gray">
                          {t('versions.current')}
                        </Badge>
                      )}
                      <ChangeSize version={version} />
                    </Group>
                  </UnstyledButton>
                </div>
              );
            })}
          </Stack>

          {selectedId === null ? (
            <Text c="dimmed" size="sm">
              {t('versions.pick')}
            </Text>
          ) : selected.isError ? (
            <Text c="red" size="sm">
              {t('versions.loadFailed')}
            </Text>
          ) : !selectedDetail ? (
            <Loader color="accent" size="sm" />
          ) : (
            <Stack gap="sm">
              <VersionDiff
                before={selectedDetail}
                after={current}
                beforeLabel={t('versions.before')}
                afterLabel={t('versions.after')}
              />
              {identical ? (
                <Text c="dimmed" size="sm">
                  {t('versions.identical')}
                </Text>
              ) : (
                <Button
                  variant="light"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => setConfirming(true)}
                >
                  {t('versions.restore')}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      )}

      {selectedDetail && (
        <Modal
          opened={confirming}
          onClose={() => setConfirming(false)}
          title={t('versions.restoreConfirmTitle')}
          centered
        >
          <Stack gap="md">
            <Text size="sm">
              {t('versions.restoreConfirmBody', {
                date: formatAbsoluteTime(selectedDetail.updatedAt),
              })}
            </Text>
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={restore.isPending}
                onClick={() =>
                  restore.mutate(selectedDetail.id, {
                    onSuccess: () => {
                      setConfirming(false);
                      setSelectedId(null);
                      notifySuccess(t('versions.restored'));
                    },
                    onError: notifyError,
                  })
                }
              >
                {t('versions.restore')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Drawer>
  );
}
