import { Anchor, Container, List, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { currentLanguage } from '../i18n';
import { PRIVACY_CONTROLLER, PRIVACY_NOTICE_UPDATED, privacyBlocks } from '../lib/privacy';
import { PageCard } from '../components/PageCard';

// The notice's sections, in reading order; each has a `title` and a `body`
// under `privacy.sections` in the locale files.
const SECTIONS = [
  'controller',
  'data',
  'purposes',
  'processors',
  'retention',
  'rights',
  'storage',
] as const;

/**
 * `/privacy`: the privacy notice (GDPR art. 13, spec 31_3). Public, so it can
 * be read before signing in: it has no app header, which would ask the
 * backend for the account of a visitor who has none.
 */
export function PrivacyPage() {
  const { t } = useTranslation();
  const updated = new Date(`${PRIVACY_NOTICE_UPDATED}T12:00:00`).toLocaleDateString(
    currentLanguage(),
    { dateStyle: 'long' },
  );

  return (
    <Container component="main" size="md" px={{ base: 'sm', sm: 'lg' }} py="lg">
      <Stack gap="md">
        <Anchor component={Link} to="/" size="sm">
          <ArrowLeftIcon size={14} aria-hidden="true" /> {t('privacy.back')}
        </Anchor>
        <Stack gap={2}>
          <Title order={1} fz={{ base: 'h2', sm: 'h1' }} style={{ fontFamily: 'var(--font-display)' }}>
            {t('privacy.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('privacy.updated', { date: updated })}
          </Text>
        </Stack>
        <Text>{t('privacy.intro')}</Text>
        {SECTIONS.map((section) => (
          <PageCard key={section}>
            <Stack gap="sm">
              <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
                {t(`privacy.sections.${section}.title`)}
              </Title>
              {privacyBlocks(
                t(`privacy.sections.${section}.body`, {
                  name: PRIVACY_CONTROLLER.name,
                  email: PRIVACY_CONTROLLER.email,
                }),
              ).map((block, index) =>
                block.kind === 'list' ? (
                  <List key={index} size="sm" spacing={4}>
                    {block.items.map((item) => (
                      <List.Item key={item}>{item}</List.Item>
                    ))}
                  </List>
                ) : (
                  <Text key={index} size="sm">
                    {block.text}
                  </Text>
                ),
              )}
            </Stack>
          </PageCard>
        ))}
      </Stack>
    </Container>
  );
}
