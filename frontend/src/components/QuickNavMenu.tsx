import { useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { Avatar, Burger, Loader, Menu, ScrollArea, Text } from '@mantine/core';
import { BooksIcon, CheckIcon, HouseIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useMyRooms } from '../hooks/useRooms';
import { currentLanguage } from '../i18n';
import type { MyRoom } from '../types/room';

/** The user's Rooms in use, alphabetical: archived ones stay on the Rooms page. */
function sortedRooms(myRooms: MyRoom[]): MyRoom[] {
  const collator = new Intl.Collator(currentLanguage(), { sensitivity: 'base' });
  return myRooms
    .filter((myRoom) => myRoom.room.status === 'active')
    .sort((a, b) => collator.compare(a.room.name, b.room.name));
}

/**
 * The burger at the left of the header (spec 45, Decision 2a): quick
 * navigation to the landing page, the Rooms page and each of the user's
 * Rooms. The Rooms are fetched on the first open and listed inline under a
 * label, on every screen (product owner, 2026-10-25: no side sub-menu).
 */
export function QuickNavMenu() {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [requested, setRequested] = useState(false);
  const currentRoomId = useMatch('/rooms/:roomId/*')?.params.roomId;
  const myRooms = useMyRooms(requested);

  const handleChange = (next: boolean) => {
    setOpened(next);
    if (next) setRequested(true);
  };

  let roomItems;
  if (myRooms.isLoading) {
    roomItems = <Loader size="xs" color="accent" m="xs" />;
  } else if (myRooms.isError) {
    roomItems = (
      <Text size="sm" c="dimmed" px="sm" py={6}>
        {t('rooms.loadError')}
      </Text>
    );
  } else {
    const rooms = sortedRooms(myRooms.data ?? []);
    roomItems =
      rooms.length === 0 ? (
        <Text size="sm" c="dimmed" px="sm" py={6}>
          {t('nav.noRooms')}
        </Text>
      ) : (
        rooms.map(({ room }) => (
          <Menu.Item
            key={room.id}
            component={Link}
            to={`/rooms/${room.id}/documents`}
            leftSection={<Avatar src={room.imageUrl} name={room.name} size={22} radius="sm" />}
            rightSection={room.id === currentRoomId ? <CheckIcon size={16} aria-hidden="true" /> : null}
            aria-current={room.id === currentRoomId ? 'page' : undefined}
          >
            {room.name}
          </Menu.Item>
        ))
      );
  }

  return (
    <Menu opened={opened} onChange={handleChange} position="bottom-start" width={260} shadow="md">
      <Menu.Target>
        <Burger opened={opened} size="sm" aria-label={t('nav.menu')} />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component={Link} to="/" leftSection={<HouseIcon size={18} aria-hidden="true" />}>
          {t('nav.home')}
        </Menu.Item>
        <Menu.Item component={Link} to="/rooms" leftSection={<BooksIcon size={18} aria-hidden="true" />}>
          {t('common.myRooms')}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Label>{t('nav.rooms')}</Menu.Label>
        <ScrollArea.Autosize mah="50dvh">{roomItems}</ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
}
