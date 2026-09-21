import { useRef, useState } from 'react';
import { ActionIcon, Button, FileButton, Group, Popover, Stack, TextInput, Tooltip } from '@mantine/core';
import { ImageIcon, LinkIcon } from '@phosphor-icons/react';
import { ACCEPTED_IMAGE_TYPES, isHttpUrl } from '../lib/images';

interface ImageAttachButtonsProps {
  // How many more images may be added; the buttons disable at 0.
  remaining: number;
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
}

// Compact "attach an image" controls for a form: a file picker and a URL
// field in a popover. Nothing is uploaded here - the form decides when.
export function ImageAttachButtons({ remaining, onAddFiles, onAddUrl }: ImageAttachButtonsProps) {
  const [urlOpened, setUrlOpened] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedUrl = url.trim();
  const urlError = trimmedUrl && !isHttpUrl(trimmedUrl) ? 'Inserisci un URL http(s) valido' : null;
  const full = remaining <= 0;
  const hint = full ? 'Limite di immagini raggiunto' : undefined;

  const addUrl = () => {
    if (trimmedUrl && !urlError) {
      onAddUrl(trimmedUrl);
      setUrl('');
      setUrlOpened(false);
    }
  };

  return (
    <Group gap={4}>
      <FileButton
        onChange={(files) => onAddFiles(files.slice(0, remaining))}
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        disabled={full}
      >
        {(props) => (
          <Tooltip label={hint ?? 'Aggiungi immagini dal computer'} withArrow>
            <ActionIcon {...props} variant="subtle" color="gray" aria-label="Aggiungi immagini">
              <ImageIcon size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </FileButton>
      <Popover
        opened={urlOpened}
        onChange={setUrlOpened}
        position="top-start"
        withArrow
        shadow="md"
        // Not `autoFocus` on the input: that focuses it before the dropdown
        // is positioned, which scrolls the page to the top and closes the
        // popover when the composer is below the fold.
        onOpen={() => requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))}
      >
        <Popover.Target>
          <Tooltip label={hint ?? 'Aggiungi immagine da URL'} withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={full}
              onClick={() => setUrlOpened((current) => !current)}
              aria-label="Aggiungi immagine da URL"
            >
              <LinkIcon size={18} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
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
                  addUrl();
                }
              }}
              error={urlError}
              ref={inputRef}
            />
            <Button size="xs" disabled={!trimmedUrl || urlError !== null} onClick={addUrl}>
              Aggiungi
            </Button>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}
