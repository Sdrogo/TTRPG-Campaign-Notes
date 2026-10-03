import { Anchor, Group, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMyReveals } from '../../hooks/useReveals';
import { formatRelativeTime } from '../../lib/time';
import type { MyReveal } from '../../types/reveal';
import { AccountSection } from './AccountSection';

/**
 * Content the Master revealed to the signed-in user that they haven't opened
 * yet (spec 22 Decision 3), newest first, each linking to where it is.
 * Opening the Document opens it, and it leaves the list. Renders nothing
 * while there is none.
 */
export function RevealsSection() {
  const { t } = useTranslation();
  const reveals = useMyReveals(true);

  if (!reveals.data || reveals.data.length === 0) {
    return null;
  }

  const what = (reveal: MyReveal) => {
    if (reveal.kind === 'note') return t('account.reveals.note', { title: reveal.noteTitle });
    if (reveal.kind === 'comment') return t('account.reveals.comment');
    return t('account.reveals.document');
  };
  const anchor = (reveal: MyReveal) => (reveal.commentId ? `#comment-${reveal.commentId}` : '');

  return (
    <AccountSection title={t('account.reveals.title')} description={t('account.reveals.description')}>
      <Stack component="ul" gap="xs" p={0} m={0} style={{ listStyle: 'none' }}>
        {reveals.data.map((reveal) => (
          <Group key={reveal.id} component="li" justify="space-between" wrap="nowrap" gap="sm">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Anchor
                component={Link}
                to={`/rooms/${reveal.roomId}/documents/${reveal.documentId}${anchor(reveal)}`}
                fw={600}
                style={{ overflowWrap: 'anywhere' }}
              >
                {reveal.documentName}
              </Anchor>
              <Text size="xs" c="dimmed">
                {reveal.roomName} · {what(reveal)}
              </Text>
            </Stack>
            <Text size="xs" c="dimmed" component="time" dateTime={reveal.revealedAt} style={{ flexShrink: 0 }}>
              {formatRelativeTime(reveal.revealedAt)}
            </Text>
          </Group>
        ))}
      </Stack>
    </AccountSection>
  );
}
