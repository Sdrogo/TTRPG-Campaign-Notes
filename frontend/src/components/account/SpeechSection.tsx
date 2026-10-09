import { useState } from 'react';
import { Button, Grid, Group, SegmentedControl, Select, Stack, Text } from '@mantine/core';
import { SpeakerHighIcon, StopIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AccountSection } from './AccountSection';
import { useReadAloud, useStopReadingOnLeave } from '../../hooks/useReadAloud';
import { useSpeechVoices } from '../../hooks/useSpeechVoices';
import { currentLanguage } from '../../i18n';
import {
  rankVoices,
  readSpeechPreferences,
  saveSpeechPreferences,
  SPEECH_RATES,
  speechSupported,
  voiceSpeaks,
  type SpeechPreferences,
  type SpeechRate,
} from '../../lib/speech';

// The Select's value for "Automatica": no voice stored, the best installed
// one is used (spec 30b).
const AUTOMATIC = '';

/**
 * "Lettura ad alta voce" on the Account page (spec 30 Decision 4): the voice
 * for the app language and the speed, kept on this device, with "Prova" to
 * hear them. The app language's voices are listed best first, and
 * "Automatica" names the one it uses (spec 30b). A browser without speech
 * synthesis gets a line saying so.
 */
export function SpeechSection() {
  const { t } = useTranslation();
  const supported = speechSupported();
  return (
    <AccountSection title={t('account.speech.title')} description={t('account.speech.description')}>
      {supported ? (
        <SpeechSettings />
      ) : (
        <Text size="sm" c="dimmed">
          {t('account.speech.unsupported')}
        </Text>
      )}
    </AccountSection>
  );
}

function SpeechSettings() {
  const { t } = useTranslation();
  const language = currentLanguage();
  const voices = useSpeechVoices();
  const [preferences, setPreferences] = useState<SpeechPreferences>(readSpeechPreferences);
  const sample = useReadAloud('account:sample', () => t('account.speech.sample'));
  useStopReadingOnLeave();

  const update = (next: SpeechPreferences) => {
    setPreferences(next);
    saveSpeechPreferences(next);
  };

  const toItem = (voice: SpeechSynthesisVoice) => ({
    value: voice.voiceURI,
    label: `${voice.name} (${voice.lang})`,
  });
  const own = rankVoices(voices, language);
  const others = voices.filter((voice) => !voiceSpeaks(voice, language));
  const chosen = preferences.voices[language];
  // A voice chosen on this device but no longer offered reads as "Automatica",
  // which is also what playing falls back to (`pickVoice`).
  const value = chosen && voices.some((voice) => voice.voiceURI === chosen) ? chosen : AUTOMATIC;
  const rateFormat = new Intl.NumberFormat(language);

  return (
    <Grid gap={{ base: 'md', md: 'xl' }} align="flex-end">
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap={4}>
          <Select
            label={t('account.speech.voice')}
            value={value}
            allowDeselect={false}
            searchable
            data={[
              {
                value: AUTOMATIC,
                label: own[0]
                  ? t('account.speech.automaticWith', { name: own[0].name })
                  : t('account.speech.automatic'),
              },
              ...(own.length > 0
                ? [{ group: t('account.speech.languageVoices'), items: own.map(toItem) }]
                : []),
              ...(others.length > 0
                ? [{ group: t('account.speech.otherVoices'), items: others.map(toItem) }]
                : []),
            ]}
            onChange={(uri) => {
              const { [language]: _dropped, ...rest } = preferences.voices;
              update({ ...preferences, voices: uri ? { ...rest, [language]: uri } : rest });
            }}
          />
          {voices.length > 0 && own.length === 0 && (
            <Text size="xs" c="dimmed">
              {t('account.speech.noVoices')}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {t('account.speech.betterVoices')}
          </Text>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Group justify="space-between" align="flex-end" gap="sm">
          <Stack gap={4}>
            <Text size="sm" fw={500} id="speech-rate-label">
              {t('account.speech.rate')}
            </Text>
            <SegmentedControl
              aria-labelledby="speech-rate-label"
              value={String(preferences.rate)}
              data={SPEECH_RATES.map((rate) => ({
                value: String(rate),
                label: `${rateFormat.format(rate)}×`,
              }))}
              onChange={(rate) => update({ ...preferences, rate: Number(rate) as SpeechRate })}
            />
          </Stack>
          {sample.status === 'idle' ? (
            <Button
              variant="outline"
              color="gray"
              leftSection={<SpeakerHighIcon size={16} />}
              onClick={sample.play}
            >
              {t('account.speech.try')}
            </Button>
          ) : (
            <Button
              variant="outline"
              color="gray"
              leftSection={<StopIcon size={16} />}
              onClick={sample.stop}
            >
              {t('speech.stop')}
            </Button>
          )}
        </Group>
      </Grid.Col>
    </Grid>
  );
}
