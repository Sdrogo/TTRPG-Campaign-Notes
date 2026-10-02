import { useEffect, useRef, useState } from 'react';
import { Box, Center, Loader, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { currentLanguage } from '../../i18n';
import { loadEmojiPicker } from '../../lib/emojiPicker';

interface EmojiPickerProps {
  /** Called with the chosen emoji, skin tone included (its native text). */
  onSelect: (emoji: string) => void;
}

/**
 * emoji-mart's full picker, with search and skin tones (spec 19c Decision 1),
 * loaded the first time it is shown (`loadEmojiPicker`) and labelled in the UI
 * language. Its element lives in a node React doesn't render into.
 */
export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const language = currentLanguage();

  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const node = host.current;
    let cancelled = false;
    loadEmojiPicker(language).then(
      ({ Picker, data, i18n }) => {
        if (cancelled || !node) {
          return;
        }
        const picker = new Picker({
          data,
          i18n,
          locale: language,
          theme: 'dark',
          previewPosition: 'none',
          skinTonePosition: 'search',
          autoFocus: true,
          onEmojiSelect: (emoji: { native: string }) => select.current(emoji.native),
        });
        node.replaceChildren(picker as Node);
        setState('ready');
      },
      () => {
        if (!cancelled) {
          setState('failed');
        }
      },
    );
    return () => {
      cancelled = true;
      node?.replaceChildren();
    };
  }, [language]);

  return (
    <>
      {state === 'loading' && (
        <Center p="md">
          <Loader size="sm" aria-label={t('comments.reactions.loadingPicker')} />
        </Center>
      )}
      {state === 'failed' && (
        <Text size="sm" c="dimmed" p="md">
          {t('comments.reactions.pickerFailed')}
        </Text>
      )}
      <Box ref={host} />
    </>
  );
}
