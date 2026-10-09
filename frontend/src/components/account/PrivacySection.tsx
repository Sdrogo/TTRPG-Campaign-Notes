import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { DownloadSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useDeleteAccount, useExportPersonalData } from '../../hooks/useAccount';
import { notifyError, notifySuccess } from '../../lib/notify';
import { AccountSection } from './AccountSection';

/**
 * "Your data" on the Account page (spec 31): download everything the app keeps
 * about the user (GDPR art. 15 and 20), read the privacy notice, and delete
 * the account (art. 17). Deleting asks for a confirmation word in the app
 * language, like the Room deletion asks for the Room's name (spec 13).
 */
export function PrivacySection() {
  const { t } = useTranslation();
  const exportData = useExportPersonalData();
  const deleteAccount = useDeleteAccount();
  const [opened, setOpened] = useState(false);
  const [typed, setTyped] = useState('');
  const word = t('account.privacy.deleteWord');

  const close = () => {
    setOpened(false);
    setTyped('');
  };

  return (
    <AccountSection title={t('account.privacy.title')} description={t('account.privacy.description')}>
      <Group gap="sm">
        <Button
          variant="default"
          leftSection={<DownloadSimpleIcon size={16} aria-hidden="true" />}
          loading={exportData.isPending}
          onClick={() =>
            exportData.mutate(undefined, {
              onSuccess: () => notifySuccess(t('account.privacy.exported')),
              onError: notifyError,
            })
          }
        >
          {t('account.privacy.export')}
        </Button>
        <Anchor component={Link} to="/privacy" size="sm">
          {t('account.privacy.notice')}
        </Anchor>
      </Group>

      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          {t('account.privacy.deleteDescription')}
        </Text>
        <Group>
          <Button
            variant="outline"
            color="red"
            leftSection={<TrashIcon size={16} aria-hidden="true" />}
            onClick={() => setOpened(true)}
          >
            {t('account.privacy.delete')}
          </Button>
        </Group>
      </Stack>

      <Modal opened={opened} onClose={close} title={t('account.privacy.confirmTitle')} centered>
        <Stack gap="md">
          <Text size="sm">{t('account.privacy.confirmBody')}</Text>
          <TextInput
            label={t('account.privacy.confirmLabel', { word })}
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              disabled={typed.trim() !== word}
              loading={deleteAccount.isPending}
              onClick={() =>
                deleteAccount.mutate(undefined, {
                  onSuccess: () => notifySuccess(t('account.privacy.deleted')),
                  onError: notifyError,
                })
              }
            >
              {t('account.privacy.confirm')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AccountSection>
  );
}
