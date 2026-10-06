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
  /** The Document's name now, for the drawer's title. */
  name: string;
  members: Member[];
}

function ChangeSize({ version }: { version: Version }) {
  const { t } = useTranslation();
  // The backend sends all four null together, for the first revision.
  if (
    version.wordsAdded === null ||
    version.wordsRemoved === null ||
    version.notesAdded === null ||
    version.notesRemoved === null
  ) {
    return (
      <Text size="xs" c="dimmed">
        {t('versions.first')}
      </Text>
    );
  }
  const counts = { added: version.wordsAdded, removed: version.wordsRemoved };
  const notes = { added: version.notesAdded, removed: version.notesRemoved };
  return (
    <Stack gap={0} align="flex-end">
      <Text size="xs" c="dimmed" aria-label={t('versions.changeSizeLabel', counts)}>
        {t('versions.changeSize', counts)}
      </Text>
      {(notes.added > 0 || notes.removed > 0) && (
        <Text size="xs" c="dimmed" aria-label={t('versions.notesChangeLabel', notes)}>
          {t('versions.notesChange', notes)}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The history of a whole Document, its Notes included (spec 24b), for the
 * people who may edit it: a list of revisions (who saved it, when, how many
 * words and Notes it changed), and, for the one chosen, the comparison with
 * the newest revision and a "Restore" behind a confirmation, which puts the
 * whole Document back, Notes deleted since included. Restoring adds a
 * revision, so nothing is lost. The list is only read while the drawer is
 * open, and only holds the Notes the reader may see.
 */
export function VersionHistoryDrawer({
  opened,
  onClose,
  roomId,
  documentId,
  name,
  members,
}: VersionHistoryDrawerProps) {
  const { t } = useTranslation();
  const versions = useVersions(roomId, documentId, opened);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const newestId = versions.data?.[0]?.id ?? null;
  const selected = useVersion(roomId, documentId, selectedId);
  // Every revision is compared with the newest, the Document as it is now.
  const newest = useVersion(roomId, documentId, selectedId === null ? null : newestId);
  const restore = useRestoreVersion(roomId, documentId);
  const selectedDetail = selected.data?.id === selectedId ? selected.data : undefined;
  const current = newest.data?.id === newestId ? newest.data : undefined;
  const identical = selectedDetail && current ? isSameText(selectedDetail, current) : false;

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
          ) : selected.isError || newest.isError ? (
            <Text c="red" size="sm">
              {t('versions.loadFailed')}
            </Text>
          ) : !selectedDetail || !current ? (
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
