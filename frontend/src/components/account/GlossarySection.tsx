import { Switch } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { AccountSection } from './AccountSection';
import { setGlossaryHighlight, useGlossaryHighlight } from '../../lib/glossaryPreference';

/**
 * "Glossary terms" on the Account page (spec 79 Decision 12): whether the
 * terms of a Room's Glossary are highlighted in texts, with a card on
 * hover. Kept on this device, like the reading voice.
 */
export function GlossarySection() {
  const { t } = useTranslation();
  const enabled = useGlossaryHighlight();
  return (
    <AccountSection title={t('account.glossary.title')} description={t('account.glossary.description')}>
      <Switch
        label={t('account.glossary.label')}
        checked={enabled}
        onChange={(event) => setGlossaryHighlight(event.currentTarget.checked)}
      />
    </AccountSection>
  );
}
