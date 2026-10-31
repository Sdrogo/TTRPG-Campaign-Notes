import { useState } from 'react';
import { ActionIcon, Box, Button, Card, Group, Menu, Modal, Stack, Text, TextInput } from '@mantine/core';
import { DotsThreeVerticalIcon, PlusIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LandingCard } from './LandingCard';
import { SectionInfoModal } from './SectionInfoModal';
import { DragHandle, SortableItem, SortableList } from './Sortable';
import { useCreateSection, useDeleteSection, useReorderSections } from '../../hooks/useLanding';
import { sectionHref } from '../../lib/landing';
import { pageName, sectionDescription, sectionTitle } from '../../lib/landingText';
import { notifyError } from '../../lib/notify';
import { useBackState } from '../../lib/backNav';
import { PAGE_SECTION_KINDS, type LandingSection, type SectionKind } from '../../types/landing';

/** What the Section page reads from the link that opens a Section just created (spec 55 Decision 12). */
export interface OpenInEditState {
  landingEdit?: 'add-block';
}

/**
 * The landing in the Master's edit mode (spec 55 Decision 12): the same
 * grid, each card with a drag handle and a ⋮ (Modifica info, Elimina), and
 * a dashed "Nuova sezione" card closing it. A new Section opens in edit
 * mode with the add-block picker open.
 */
export function LandingEditor({ roomId, sections }: { roomId: string; sections: LandingSection[] }) {
  const { t } = useTranslation();
  const backState = useBackState();
  const reorder = useReorderSections(roomId);
  const remove = useDeleteSection(roomId);
  const [editing, setEditing] = useState<LandingSection | null>(null);
  const [deleting, setDeleting] = useState<LandingSection | null>(null);
  const ids = sections.map((section) => section.id);

  return (
    <Box className="room-landing-editing">
      <SortableList ids={ids} layout="grid" onMove={(next) => reorder.mutate(next, { onError: notifyError })}>
        <Box className="documents-grid">
          {sections.map((section) => (
            <SortableItem key={section.id} id={section.id}>
              {({ ref, style }) => (
                <div ref={ref} style={style}>
                  <LandingCard
                    to={sectionHref(roomId, section)}
                    state={backState}
                    title={sectionTitle(section)}
                    description={sectionDescription(section)}
                    imageUrl={section.imageUrl}
                    headingOrder={2}
                    controls={
                      <Group gap={2} wrap="nowrap" className="room-landing-controls">
                        <DragHandle label={t('roomLanding.edit.dragSection', { name: sectionTitle(section) })} />
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('roomLanding.edit.sectionMenu', { name: sectionTitle(section) })}>
                              <DotsThreeVerticalIcon size={18} weight="bold" />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => setEditing(section)}>{t('roomLanding.edit.info')}</Menu.Item>
                            {section.kind !== 'page_documents' && (
                              <Menu.Item color="red" onClick={() => setDeleting(section)}>
                                {t('common.delete')}
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    }
                  />
                </div>
              )}
            </SortableItem>
          ))}
          <NewSectionCard roomId={roomId} missingPages={PAGE_SECTION_KINDS.filter((kind) => !sections.some((s) => s.kind === kind))} />
        </Box>
      </SortableList>
      {editing && <SectionInfoModal roomId={roomId} section={editing} onClose={() => setEditing(null)} />}
      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('roomLanding.edit.deleteTitle', { name: deleting ? sectionTitle(deleting) : '' })}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{t('roomLanding.edit.deleteBody')}</Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() =>
                deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError: notifyError })
              }
            >
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}

/**
 * The dashed card at the end of the grid: "Nuova sezione" asks only the
 * title (Enter confirms), creates the Section and opens it in edit mode; a
 * page card the Master deleted can be added back from here.
 */
function NewSectionCard({ roomId, missingPages }: { roomId: string; missingPages: SectionKind[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backState = useBackState();
  const create = useCreateSection(roomId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const submit = () => {
    if (!title.trim()) return;
    create.mutate(
      { title },
      {
        onSuccess: (section) => {
          setTitle('');
          setOpen(false);
          const state: OpenInEditState & typeof backState = { ...backState, landingEdit: 'add-block' };
          void navigate(sectionHref(roomId, section), { state });
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Card withBorder radius="md" padding="md" className="room-landing-new">
      {open ? (
        <Stack gap="xs">
          <TextInput
            autoFocus
            label={t('roomLanding.edit.newTitle')}
            placeholder={t('roomLanding.edit.newPlaceholder')}
            value={title}
            maxLength={100}
            onChange={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') setOpen(false);
            }}
          />
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="subtle" color="gray" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="xs" onClick={submit} loading={create.isPending} disabled={!title.trim()}>
              {t('roomLanding.edit.create')}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="xs" align="center" justify="center" h="100%">
          <Button variant="subtle" leftSection={<PlusIcon size={18} />} onClick={() => setOpen(true)}>
            {t('roomLanding.edit.newSection')}
          </Button>
          {missingPages.map((kind) => (
            <Button
              key={kind}
              size="xs"
              variant="subtle"
              color="gray"
              loading={create.isPending && create.variables?.kind === kind}
              onClick={() => create.mutate({ kind }, { onError: notifyError })}
            >
              {t('roomLanding.edit.addPage', { name: pageName(kind as Exclude<SectionKind, 'custom'>) })}
            </Button>
          ))}
        </Stack>
      )}
    </Card>
  );
}
