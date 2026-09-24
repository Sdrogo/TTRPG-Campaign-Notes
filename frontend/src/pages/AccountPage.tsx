import { Button, Divider, Grid, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { EnvelopeSimpleIcon, SignOutIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import {
  useAccount,
  useImportAvatar,
  useRemoveAvatar,
  useSignOut,
  useUpdateProfile,
  useUploadAvatar,
} from '../hooks/useAccount';
import { toProfilePatch } from '../lib/profile';
import { notifyError, notifySuccess } from '../lib/notify';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { AccountSection } from '../components/account/AccountSection';
import { AvatarEditor, type AvatarAction } from '../components/account/AvatarEditor';
import { ProfileForm } from '../components/account/ProfileForm';
import type { AccountProfile } from '../types/profile';
import { useTranslation } from 'react-i18next';

/** `/account`: the signed-in user's profile (name, pronouns, description, avatar) and sign-out. */
export function AccountPage() {
  const { t } = useTranslation();
  const { session, loading: sessionLoading } = useSession();

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>{t('account.signInRequired')}</SignInRequired>;
  }

  return <AccountLoader />;
}

function AccountLoader() {
  const { t } = useTranslation();
  const account = useAccount(true);

  if (account.isLoading) {
    return <FullPageLoader />;
  }

  if (account.isError || !account.data) {
    return (
      <FullPageMessage actionLabel={t('common.backToMyRooms')} actionTo="/">
        {t('account.loadError')}
      </FullPageMessage>
    );
  }

  return <AccountContent profile={account.data} />;
}

function AccountContent({ profile }: { profile: AccountProfile }) {
  const { t } = useTranslation();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const importAvatar = useImportAvatar();
  const removeAvatar = useRemoveAvatar();
  const signOut = useSignOut();

  const avatarPending: AvatarAction | null = uploadAvatar.isPending
    ? 'upload'
    : importAvatar.isPending
      ? 'import'
      : removeAvatar.isPending
        ? 'remove'
        : null;

  return (
    <PageLayout backTo="/" backLabel={t('common.myRooms')}>
      <Stack gap={2}>
        <Title order={1} fz={{ base: 'h2', sm: 'h1' }} style={{ fontFamily: 'var(--font-display)' }}>
          {t('account.title')}
        </Title>
        <Text c="dimmed">{t('account.subtitle')}</Text>
      </Stack>

      {/* Full-width cards like the Document page; on wide screens the
          avatar sits beside the form and the email beside sign-out, so the
          fields don't stretch across the whole card. */}
      <AccountSection title={t('account.profile.title')} description={t('account.profile.description')}>
        <Grid gap={{ base: 'md', md: 'xl' }}>
          <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
            <AvatarEditor
              user={profile}
              pending={avatarPending}
              onUpload={(file) => uploadAvatar.mutate(file, { onError: notifyError })}
              onImportUrl={(url) => importAvatar.mutate(url, { onError: notifyError })}
              onRemove={() => removeAvatar.mutate(undefined, { onError: notifyError })}
            />
            <Divider hiddenFrom="md" mt="md" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
            <ProfileForm
              profile={profile}
              saving={updateProfile.isPending}
              onSubmit={(values, onDone) =>
                updateProfile.mutate(toProfilePatch(values), {
                  onSuccess: (saved) => {
                    onDone(saved);
                    notifySuccess(t('account.profile.saved'));
                  },
                  onError: notifyError,
                })
              }
            />
          </Grid.Col>
        </Grid>
      </AccountSection>

      <AccountSection title={t('account.access.title')}>
        <Grid gap={{ base: 'md', md: 'xl' }} align="flex-end">
          <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
            <TextInput
              label={t('account.access.email')}
              description={t('account.access.emailDescription')}
              value={profile.email ?? ''}
              placeholder={t('account.access.noEmail')}
              leftSection={<EnvelopeSimpleIcon size={16} aria-hidden="true" />}
              readOnly
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Text size="sm" c="dimmed">
                {t('account.access.signOutDescription')}
              </Text>
              <Button
                variant="outline"
                color="gray"
                leftSection={<SignOutIcon size={16} />}
                loading={signOut.isPending}
                onClick={() => signOut.mutate(undefined, { onError: notifyError })}
                style={{ flexShrink: 0 }}
              >
                {t('common.leave')}
              </Button>
            </Group>
          </Grid.Col>
        </Grid>
      </AccountSection>
    </PageLayout>
  );
}
