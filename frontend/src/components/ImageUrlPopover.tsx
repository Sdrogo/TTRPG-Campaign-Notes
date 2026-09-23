import { useRef, useState, type ReactElement } from 'react';
import { Button, Popover, Stack, TextInput, type PopoverProps } from '@mantine/core';
import { isHttpUrl } from '../lib/images';

interface ImageUrlPopoverProps {
  onAddUrl: (url: string) => void;
  /** The element that opens the popover; call `toggle` from its onClick. */
  children: (toggle: () => void) => ReactElement;
  position?: PopoverProps['position'];
  submitLabel?: string;
}

/**
 * A small "paste an image URL" popover, shared by every place that accepts an
 * image by URL (Comment composer, avatar). The backend fetches and validates
 * the image; this only checks it looks like an http(s) URL.
 */
export function ImageUrlPopover({
  onAddUrl,
  children,
  position = 'top-start',
  submitLabel = 'Aggiungi',
}: ImageUrlPopoverProps) {
  const [opened, setOpened] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedUrl = url.trim();
  const urlError = trimmedUrl && !isHttpUrl(trimmedUrl) ? 'Inserisci un URL http(s) valido' : null;

  const submit = () => {
    if (trimmedUrl && !urlError) {
      onAddUrl(trimmedUrl);
      setUrl('');
      setOpened(false);
    }
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position={position}
      withArrow
      shadow="md"
      // Not `autoFocus` on the input: that focuses it before the dropdown
      // is positioned, which scrolls the page to the top and closes the
      // popover when the target is below the fold.
      onOpen={() => requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))}
    >
      <Popover.Target>{children(() => setOpened((current) => !current))}</Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" w={280}>
          <TextInput
            size="xs"
            aria-label="URL dell'immagine"
            placeholder="https://… URL dell'immagine"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            error={urlError}
            ref={inputRef}
          />
          <Button size="xs" disabled={!trimmedUrl || urlError !== null} onClick={submit}>
            {submitLabel}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
