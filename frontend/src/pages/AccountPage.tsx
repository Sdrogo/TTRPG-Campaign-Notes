import { Button, Divider, Group, Stack, Text, TextInput, Title } from '@mantine/core';
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
      <Stack gap="lg" maw={720} w="100%">
        <Stack gap={2}>
          <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
            Account
          </Title>
          <Text c="dimmed">Il tuo profilo e la tua sessione.</Text>
        </Stack>

        <AccountSection
          title="Profilo"
          description="Come ti vedono gli altri membri delle tue Stanze."
        >
          <AvatarEditor
            user={profile}
            pending={avatarPending}
            onUpload={(file) => uploadAvatar.mutate(file, { onError: notifyError })}
            onImportUrl={(url) => importAvatar.mutate(url, { onError: notifyError })}
            onRemove={() => removeAvatar.mutate(undefined, { onError: notifyError })}
          />
          <Divider />
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
        </AccountSection>

        <AccountSection title="Accesso">
          <TextInput
            label="Email"
            description="Accedi con Google: l'email è quella del tuo account Google."
            value={profile.email ?? ''}
            leftSection={<GoogleLogoIcon size={16} />}
            readOnly
          />
          <Divider />
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Stack gap={0}>
              <Text size="sm" fw={600}>
                Esci
              </Text>
              <Text size="sm" c="dimmed">
                Termina la sessione su questo dispositivo.
              </Text>
            </Stack>
            <Button
              variant="outline"
              color="gray"
              leftSection={<SignOutIcon size={16} />}
              loading={signOut.isPending}
              onClick={() => signOut.mutate(undefined, { onError: notifyError })}
            >
              Esci
            </Button>
          </Group>
        </AccountSection>
      </Stack>
    </PageLayout>
  );
}
