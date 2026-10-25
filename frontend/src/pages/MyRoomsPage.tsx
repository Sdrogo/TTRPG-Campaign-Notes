import { Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { AppHeader } from '../components/AppHeader';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { RoomsPage } from './RoomsPage';

/** `/rooms`: the signed-in user's Rooms (moved from `/` by spec 45). */
export function MyRoomsPage() {
  const { t } = useTranslation();
  const { session, loading } = useSession();

  if (loading) {
    return <FullPageLoader />;
  }
  if (!session) {
    return <SignInRequired>{t('auth.prompt')}</SignInRequired>;
  }
  return (
    <Stack gap={0}>
      <AppHeader />
      <RoomsPage currentUserId={session.user.id} />
    </Stack>
  );
}
