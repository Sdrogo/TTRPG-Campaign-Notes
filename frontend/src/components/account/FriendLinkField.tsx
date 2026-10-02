import { ActionIcon, Button, CopyButton, Group, Text, TextInput, Tooltip } from '@mantine/core';
import { ArrowClockwiseIcon, CheckIcon, CopyIcon, LinkIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useFriendCode, useRegenerateFriendCode } from '../../hooks/useFriends';
import { friendLink } from '../../lib/friends';
import { notifyError, notifySuccess } from '../../lib/notify';

/**
 * FR-F4: the signed-in user's friend link, to copy and share, and a button
 * that replaces it (the old link stops working at once).
 */
export function FriendLinkField() {
  const { t } = useTranslation();
  const friendCode = useFriendCode(true);
  const regenerate = useRegenerateFriendCode();

  if (friendCode.isError) {
    return (
      <Text c="red" size="sm">
        {t('account.friends.linkError')}
      </Text>
    );
  }

  const link = friendCode.data ? friendLink(friendCode.data.code) : '';

  return (
    <Group gap="xs" align="flex-end" wrap="wrap">
      <TextInput
        label={t('account.friends.linkLabel')}
        description={t('account.friends.linkDescription')}
        value={link}
        readOnly
        leftSection={<LinkIcon size={16} aria-hidden="true" />}
        style={{ flex: 1, minWidth: 240 }}
      />
      <Group gap="xs" wrap="nowrap">
        <CopyButton value={link}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? t('common.copied') : t('common.copy')}>
              <ActionIcon
                variant="light"
                size="lg"
                onClick={copy}
                disabled={!link}
                aria-label={copied ? t('common.copied') : t('common.copy')}
              >
                {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
        <Button
          variant="default"
          leftSection={<ArrowClockwiseIcon size={16} />}
          loading={regenerate.isPending}
          disabled={!link}
          onClick={() =>
            regenerate.mutate(undefined, {
              onSuccess: () => notifySuccess(t('account.friends.regenerated')),
              onError: notifyError,
            })
          }
        >
          {t('account.friends.regenerate')}
        </Button>
      </Group>
    </Group>
  );
}
