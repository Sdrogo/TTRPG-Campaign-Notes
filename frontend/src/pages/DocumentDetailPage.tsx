import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { DocumentView } from '../components/documents/DocumentView';

/**
 * `/rooms/:roomId/documents/:documentId`: one Document with its gallery, Owners,
 * where it is mentioned and its Comments. Owners and the Master also get the editing controls,
 * except while the Master previews it as a member (spec 22b): then it is read-only.
 */
export function DocumentDetailPage() {
  const { t } = useTranslation();
  const { roomId, documentId } = useParams<{
    roomId: string;
    documentId: string;
  }>();
  const { session, loading: sessionLoading } = useSession();

  if (!roomId || !documentId) {
    return null;
  }

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>{t('documents.detail.signInRequired')}</SignInRequired>;
  }

  return (
    <PageLayout backTo={`/rooms/${roomId}/documents`} backLabel={t('documents.title')} roomId={roomId}>
      <DocumentView roomId={roomId} documentId={documentId} currentUserId={session.user.id} />
    </PageLayout>
  );
}
