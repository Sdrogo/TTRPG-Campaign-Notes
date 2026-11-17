import { Button, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { AUTH_PROVIDERS, type AuthProvider } from '../lib/authProviders';
import { markSigningIn } from '../lib/pendingInvite';
import { signIn } from '../lib/auth';

/**
 * One sign-in button per provider, Google first and filled (D-07). Pressing
 * one remembers that a sign-in is under way, so the return to the site
 * origin goes on to the Rooms list (spec 45).
 */
export function SignInButtons() {
  const { t } = useTranslation();

  const signInWith = (provider: AuthProvider) => {
    markSigningIn();
    // Come back to whatever origin we're on (production, staging or
    // localhost); the backend accepts only origins in its CORS list.
    signIn(provider.id);
  };

  return (
    <Stack gap="sm" w="100%" maw={320}>
      {AUTH_PROVIDERS.map((provider) => (
        <Button
          key={provider.id}
          fullWidth
          variant={provider.id === 'google' ? 'filled' : 'default'}
          leftSection={<provider.icon size={20} aria-hidden="true" />}
          onClick={() => signInWith(provider)}
        >
          {t('auth.signInWith', { provider: provider.label })}
        </Button>
      ))}
    </Stack>
  );
}
