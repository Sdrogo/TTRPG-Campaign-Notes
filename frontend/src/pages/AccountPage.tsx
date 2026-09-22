import { Button, Divider, Grid, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { GoogleLogoIcon, SignOutIcon } from '@phosphor-icons/react';
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

export function AccountPage() {
  const { session, loading: sessionLoading } = useSession();

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>Accedi per gestire il tuo account.</SignInRequired>;
  }

  return <AccountLoader />;
}

function AccountLoader() {
  const account = useAccount(true);

  if (account.isLoading) {
    return <FullPageLoader />;
  }

  if (account.isError || !account.data) {
    return (
      <FullPageMessage actionLabel="Torna alle mie Stanze" actionTo="/">
        Impossibile caricare il tuo account.
      </FullPageMessage>
    );
  }

  return <AccountContent profile={account.data} />;
}

function AccountContent({ profile }: { profile: AccountProfile }) {
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
    <PageLayout backTo="/" backLabel="Le mie Stanze">
      <Stack gap={2}>
        <Title order={1} fz={{ base: 'h2', sm: 'h1' }} style={{ fontFamily: 'var(--font-display)' }}>
          Account
        </Title>
        <Text c="dimmed">Il tuo profilo e la tua sessione.</Text>
      </Stack>

      {/* Full-width cards like the Document page; on wide screens the
          avatar sits beside the form and the email beside sign-out, so the
          fields don't stretch across the whole card. */}
      <AccountSection title="Profilo" description="Come ti vedono gli altri membri delle tue Stanze.">
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
                    notifySuccess('Profilo salvato.');
                  },
                  onError: notifyError,
                })
              }
            />
          </Grid.Col>
        </Grid>
      </AccountSection>

      <AccountSection title="Accesso">
        <Grid gap={{ base: 'md', md: 'xl' }} align="flex-end">
          <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
            <TextInput
              label="Email"
              description="Accedi con Google: l'email è quella del tuo account Google."
              value={profile.email ?? ''}
              leftSection={<GoogleLogoIcon size={16} />}
              readOnly
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Text size="sm" c="dimmed">
                Termina la sessione su questo dispositivo.
              </Text>
              <Button
                variant="outline"
                color="gray"
                leftSection={<SignOutIcon size={16} />}
                loading={signOut.isPending}
                onClick={() => signOut.mutate(undefined, { onError: notifyError })}
                style={{ flexShrink: 0 }}
              >
                Esci
              </Button>
            </Group>
          </Grid.Col>
        </Grid>
      </AccountSection>
    </PageLayout>
  );
}
