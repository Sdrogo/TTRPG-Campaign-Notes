import { useState } from 'react';
import { Box, Menu, Tooltip, UnstyledButton } from '@mantine/core';
import { CheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, currentLanguage, setLanguage, type Language } from '../i18n';
import { LANGUAGE_FLAGS } from '../i18n/languages';

/** A small rectangular flag; decorative, since the text next to it names the language. */
function Flag({ language, width }: { language: Language; width: number }) {
  return (
    <Box
      component="img"
      src={LANGUAGE_FLAGS[language]}
      alt=""
      w={width}
      h={(width * 2) / 3}
      display="block"
      style={{
        objectFit: 'cover',
        borderRadius: 'var(--mantine-radius-sm)',
        border: '1px solid var(--border-default)',
      }}
    />
  );
}

/**
 * The current language's flag, just before the account avatar in the top
 * bar (spec 09); it opens a menu of the supported languages. The app starts
 * in the browser's language, and a pick here overrides it from then on.
 * Each language is listed by its own name, so it can be found whichever
 * language the UI is in.
 */
export function LanguageSelector() {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const language = currentLanguage();
  const label = t('language.selectorLabel', { language: t('language.name') });

  return (
    <Menu opened={opened} onChange={setOpened} position="bottom-end" withArrow shadow="md">
      <Menu.Target>
        {/* Hidden while the menu is open, or it covers the first option. */}
        <Tooltip
          label={t('language.selectorTooltip')}
          withArrow
          position="bottom"
          disabled={opened}
        >
          <UnstyledButton aria-label={label} className="language-button">
            <Flag language={language} width={24} />
          </UnstyledButton>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {SUPPORTED_LANGUAGES.map((option) => (
          <Menu.Item
            key={option}
            lang={option}
            leftSection={<Flag language={option} width={20} />}
            rightSection={option === language ? <CheckIcon size={14} aria-hidden="true" /> : null}
            aria-current={option === language ? 'true' : undefined}
            onClick={() => void setLanguage(option)}
          >
            {t('language.name', { lng: option })}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
