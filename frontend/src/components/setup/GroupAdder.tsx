import { useState } from 'react';
import { Button, Group, MultiSelect, Stack, Text } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { sameTagSet } from '../../lib/mainItems';
import { sortTagsByName } from '../../lib/tags';
import type { Tag } from '../../types/tag';

interface GroupAdderProps {
  /** Every Tag of the Room: any of them can make an item. */
  tags: Tag[];
  /** The Tag ids of each item already in the grouping. */
  listed: string[][];
  /** Adds the picked Tags as one new last item, in the order they were picked. */
  onAdd: (tagIds: string[]) => void;
}

/**
 * The one field that adds a Grouping item (spec 25c Decision 2): one Tag
 * picked makes a Main Tag (spec 11), two or more a combination (spec 11_2).
 * "Add" stays disabled for an empty pick and for a set already listed, in any
 * order, with the reason under the field: the backend would reject it anyway.
 */
export function GroupAdder({ tags, listed, onAdd }: GroupAdderProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>([]);

  const duplicate = picked.length > 0 && listed.some((ids) => sameTagSet(ids, picked));
  const reason = !duplicate
    ? null
    : picked.length === 1
      ? t('setup.tags.grouping.alreadyMain')
      : t('setup.tags.grouping.alreadyCombination');

  /** Hands the picked Tags over and clears the field for the next item. */
  const handleAdd = () => {
    onAdd(picked);
    setPicked([]);
  };

  return (
    <Stack gap={4}>
      <Group align="flex-end" gap="xs" wrap="nowrap">
        <MultiSelect
          size="sm"
          label={t('setup.tags.grouping.addLabel')}
          description={t('setup.tags.grouping.addHint')}
          placeholder={picked.length === 0 ? t('setup.tags.grouping.addPlaceholder') : undefined}
          data={sortTagsByName(tags).map((tag) => ({
            value: tag.id,
            label: `#${tag.name}`,
          }))}
          value={picked}
          onChange={setPicked}
          searchable
          clearable
          error={reason !== null}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button
          size="sm"
          variant="light"
          leftSection={<PlusIcon size={14} />}
          onClick={handleAdd}
          disabled={picked.length === 0 || duplicate}
        >
          {t('setup.tags.grouping.add')}
        </Button>
      </Group>
      {reason && (
        <Text size="xs" c="red">
          {reason}
        </Text>
      )}
    </Stack>
  );
}
