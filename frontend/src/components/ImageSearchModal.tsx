import { useState } from 'react';
import {
  Anchor,
  Box,
  Button,
  Center,
  Group,
  Image,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useImageSearch } from '../hooks/useImageSearch';
import type { ImageSearchResult } from '../types/imageSearch';
import { useTranslation } from 'react-i18next';

interface ImageSearchModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
  documentId: string;
  /** Adds the image at `url`; `onDone` runs once it is in the Document. */
  onAdd: (url: string, onDone: () => void) => void;
  /** The URL being added right now, if any. */
  addingUrl: string | null;
}

/** "Title · Creator · License", whichever of them the result has. */
function credit(result: ImageSearchResult): string {
  return [result.title, result.creator, result.license].filter(Boolean).join(' · ');
}

/**
 * The "Cerca" picker (spec 29): searches free images on Openverse and adds
 * the one clicked to the Document right away, through the same import as
 * "Da URL". It stays open so several can be added. A search runs on submit,
 * not on every keystroke, to spare the per-user throttle.
 */
export function ImageSearchModal({
  opened,
  onClose,
  roomId,
  documentId,
  onAdd,
  addingUrl,
}: ImageSearchModalProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const search = useImageSearch(roomId, documentId, query);
  const results = search.data ?? [];

  const submit = () => setQuery(text.trim().split(/\s+/).join(' '));

  return (
    <Modal opened={opened} onClose={onClose} title={t('imageSearch.title')} size="xl" centered>
      <Stack gap="md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <TextInput
              aria-label={t('imageSearch.queryLabel')}
              placeholder={t('imageSearch.placeholder')}
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              leftSection={<MagnifyingGlassIcon size={16} />}
              maxLength={200}
              style={{ flex: 1 }}
              data-autofocus
            />
            <Button type="submit" disabled={!text.trim()}>
              {t('imageSearch.submit')}
            </Button>
          </Group>
        </form>
        <Text size="xs" c="dimmed">
          {t('imageSearch.sourceHint')}
        </Text>

        {search.isError && (
          <Text size="sm" c="red" role="alert">
            {search.error.message}
          </Text>
        )}
        {search.isPending && query && (
          <Center py="lg">
            <Loader size="sm" aria-label={t('imageSearch.loading')} />
          </Center>
        )}
        {search.isSuccess && results.length === 0 && (
          <Text size="sm" c="dimmed">
            {t('imageSearch.empty')}
          </Text>
        )}

        {results.length > 0 && (
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
            {results.map((result) => {
              const isAdded = added.has(result.id);
              const isAdding = addingUrl === result.url;
              const label = credit(result);
              const byline = [result.creator, result.license].filter(Boolean).join(' · ');
              return (
                <Stack key={result.id} gap={4}>
                  <Tooltip label={label || t('imageSearch.untitled')} withArrow multiline w={240}>
                    <UnstyledButton
                      aria-label={t('imageSearch.add', {
                        title: result.title ?? t('imageSearch.untitled'),
                      })}
                      disabled={isAdded || addingUrl !== null}
                      onClick={() =>
                        onAdd(result.url, () => setAdded((current) => new Set(current).add(result.id)))
                      }
                      style={{
                        position: 'relative',
                        borderRadius: 'var(--mantine-radius-sm)',
                        overflow: 'hidden',
                        opacity: isAdded ? 0.5 : 1,
                      }}
                    >
                      <Image
                        src={result.thumbnailUrl}
                        alt={result.title ?? ''}
                        h={120}
                        fit="cover"
                        loading="lazy"
                      />
                      {(isAdding || isAdded) && (
                        <Center pos="absolute" inset={0} bg="rgba(0, 0, 0, 0.45)">
                          {isAdding ? (
                            <Loader size="sm" color="white" />
                          ) : (
                            <Group gap={4} c="white">
                              <CheckIcon size={16} />
                              <Text size="xs" fw={600}>
                                {t('imageSearch.added')}
                              </Text>
                            </Group>
                          )}
                        </Center>
                      )}
                    </UnstyledButton>
                  </Tooltip>
                  <Box>
                    {result.sourceUrl ? (
                      <Anchor
                        href={result.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="xs"
                        c="dimmed"
                        lineClamp={1}
                      >
                        {byline || t('imageSearch.source')}
                      </Anchor>
                    ) : (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {byline}
                      </Text>
                    )}
                  </Box>
                </Stack>
              );
            })}
          </SimpleGrid>
        )}

        {search.hasNextPage && (
          <Group justify="center">
            <Button
              variant="subtle"
              loading={search.isFetchingNextPage}
              onClick={() => void search.fetchNextPage()}
            >
              {t('imageSearch.more')}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
