import { useState } from 'react';
import { Button, Group, Popover, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

interface RemoveFriendButtonProps {
  name: string;
  loading: boolean;
  onConfirm: () => void;
}

/** "Remove" on a Friend, confirmed in a small popover: undoing it needs a new request. */
export function RemoveFriendButton({ name, loading, onConfirm }: RemoveFriendButtonProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <Button
          size="xs"
          variant="subtle"
          color="red"
          loading={loading}
          onClick={() => setOpened((current) => !current)}
        >
          {t('common.remove')}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" maw={240}>
            {t('account.friends.removeConfirm', { name })}
          </Text>
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="subtle" color="gray" onClick={() => setOpened(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="xs"
              color="red"
              onClick={() => {
                setOpened(false);
                onConfirm();
              }}
            >
              {t('common.remove')}
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
