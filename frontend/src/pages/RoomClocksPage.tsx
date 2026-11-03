import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Modal,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { CaretDownIcon, CaretRightIcon, GearSixIcon, PlusIcon, TimerIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useRoom } from '../hooks/useRooms';
import { useMembers } from '../hooks/useMembers';
import { useDocuments } from '../hooks/useDocuments';
import { useReadOnly } from '../hooks/useViewAs';
import {
  useArchiveClock,
  useClockGroups,
  useClockRules,
  useClocks,
  useCreateClock,
  useDeleteClock,
  useOpenClock,
  useUpdateClock,
} from '../hooks/useClocks';
import { useClockEvents } from '../hooks/useClockEvents';
import { useClockMarker } from '../hooks/useClockMarker';
import { canCreateClocks, emptySettings, splitClocks } from '../lib/clocks';
import { notifyError } from '../lib/notify';
import { userDisplayName } from '../lib/members';
import { FullPageLoader, SectionLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { PageHeading } from '../components/PageHeading';
import { EmptyState } from '../components/EmptyState';
import { ClockCard, MarkKindLegend, type ClockCardActions } from '../components/clocks/ClockCard';
import { ClockDialog } from '../components/clocks/ClockDialog';
import { ClockRulesDialog } from '../components/clocks/ClockRulesDialog';
import { ClockHistoryModal } from '../components/clocks/ClockHistoryModal';
import { MarkDialog } from '../components/clocks/MarkDialog';
import type { Clock, ClockFormValues, ClockGroup } from '../types/clock';

/**
 * `/rooms/:roomId/clocks` (spec 61 Decision 17): the Room's clocks the viewer
 * sees. Groups first (a band each, with its mode), then the clocks outside
 * groups, in the Master's order; folded "Proposti", "Chiusi e non avvenuti",
 * "Archiviati". "Nuovo clock" (or "Proponi un clock") and, for the Master,
 * "Regole". Marks are live (Decision 22).
 */
export function RoomClocksPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading } = useSession();

  if (!roomId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('clocks.signInRequired')}</SignInRequired>;
  return <RoomClocksContent roomId={roomId} currentUserId={session.user.id} />;
}

/** Which dialog is open over the page. */
type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; clock: Clock }
  | { kind: 'rules' }
  | { kind: 'mark'; clock: Clock }
  | { kind: 'history'; clock: Clock }
  | { kind: 'delete'; clock: Clock }
  | null;

function RoomClocksContent({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const { t } = useTranslation();
  const room = useRoom(roomId, true);
  const members = useMembers(roomId, true);
  const clocks = useClocks(roomId);
  const rules = useClockRules(roomId);
  const groups = useClockGroups(roomId);
  const documents = useDocuments(roomId, true);
  const readOnly = useReadOnly();
  const glowing = useClockEvents(roomId, clocks.data);
  const marker = useClockMarker(roomId);
  const createClock = useCreateClock(roomId);
  const updateClock = useUpdateClock(roomId);
  const archiveClock = useArchiveClock(roomId);
  const deleteClock = useDeleteClock(roomId);
  const openClock = useOpenClock(roomId);
  const [dialog, setDialog] = useState<Dialog>(null);

  const me = members.data?.find((member) => member.userId === currentUserId);
  const isMaster = me?.role === 'master' && !readOnly;
  const kinds = rules.data?.markKinds ?? [];
  const labels = rules.data?.labels ?? [];
  const canCreate =
    !readOnly &&
    me !== undefined &&
    rules.data !== undefined &&
    canCreateClocks(rules.data, me.role === 'master', room.data?.playersCanCreateDocuments === true);
  const proposing = !isMaster && rules.data?.openPolicy === 'propose';
  const close = () => setDialog(null);

  const actions: ClockCardActions = readOnly
    ? { onMark: () => undefined }
    : {
        onMark: (clock, delta, kindId) => marker.mark(clock, { delta, kindId }),
        onMarkMany: (clock) => setDialog({ kind: 'mark', clock }),
        onHistory: (clock) => setDialog({ kind: 'history', clock }),
        onEdit: (clock) => setDialog({ kind: 'edit', clock }),
        onArchive: (clock, archived) =>
          archiveClock.mutate({ clockId: clock.id, archived }, { onError: notifyError }),
        onDelete: (clock) => setDialog({ kind: 'delete', clock }),
      };

  const lists = splitClocks(clocks.data ?? []);
  const grouped = new Set((groups.data ?? []).flatMap((group) => group.clockIds));
  const loose = lists.open.filter((clock) => !grouped.has(clock.id));
  const byId = new Map((clocks.data ?? []).map((clock) => [clock.id, clock]));
  const card = (clock: Clock) => (
    <ClockCard
      key={clock.id}
      roomId={roomId}
      clock={clock}
      kinds={kinds}
      labels={labels}
      isMaster={isMaster}
      glowing={glowing.has(clock.id)}
      actions={actions}
    />
  );

  return (
    <PageLayout
      backTo={`/rooms/${roomId}`}
      backLabel={t('roomLanding.home')}
      roomId={roomId}
      showIndex
      index={{ current: 'page_clocks' }}
    >
      <PageHeading
        kicker={room.data?.name}
        title={t('clocks.title')}
        description={t('clocks.description')}
        actions={
          <>
            {isMaster && rules.data && (
              <Button
                variant="default"
                leftSection={<GearSixIcon size={18} />}
                onClick={() => setDialog({ kind: 'rules' })}
              >
                {t('clocks.rules.button')}
              </Button>
            )}
            {canCreate && (
              <Button leftSection={<PlusIcon size={18} />} onClick={() => setDialog({ kind: 'create' })}>
                {proposing ? t('clocks.propose') : t('clocks.create')}
              </Button>
            )}
          </>
        }
      />
      {(clocks.isPending || rules.isPending) && <SectionLoader />}
      {clocks.isError && <Text c="red">{t('clocks.loadError')}</Text>}
      {clocks.data?.length === 0 && (
        <EmptyState icon={<TimerIcon size={28} weight="duotone" />}>{t('clocks.empty')}</EmptyState>
      )}
      <Stack gap="lg">
        {(groups.data ?? []).map((group) => {
          const shown = group.clockIds.flatMap((id) => {
            const clock = byId.get(id);
            return clock && !clock.archived ? [clock] : [];
          });
          return shown.length > 0 ? (
            <GroupBand key={group.id} group={group}>
              {shown.map(card)}
            </GroupBand>
          ) : null;
        })}
        {loose.length > 0 && (
          <Card withBorder radius="md" p="lg">
            {grouped.size > 0 && (
              <Title order={2} fz="h4" mb="sm" style={{ fontFamily: 'var(--font-display)' }}>
                {t('clocks.outsideGroups')}
              </Title>
            )}
            <Group gap="xl" align="flex-start">
              {loose.map(card)}
            </Group>
          </Card>
        )}
        <MarkKindLegend kinds={kinds} />
        {lists.proposed.length > 0 && (
          <Folded title={t('clocks.lists.proposed')} count={lists.proposed.length} defaultOpen>
            <Stack gap="xs">
              {lists.proposed.map((clock) => (
                <ProposalRow
                  key={clock.id}
                  clock={clock}
                  proposer={userDisplayName(members.data?.find((m) => m.userId === clock.createdBy))}
                  isMaster={isMaster}
                  pending={openClock.isPending || deleteClock.isPending}
                  onOpen={() => openClock.mutate(clock.id, { onError: notifyError })}
                  onEdit={() => setDialog({ kind: 'edit', clock })}
                  onReject={() => deleteClock.mutate(clock.id, { onError: notifyError })}
                />
              ))}
            </Stack>
          </Folded>
        )}
        {lists.finished.length > 0 && (
          <Folded title={t('clocks.lists.finished')} count={lists.finished.length}>
            <Group gap="xl" align="flex-start">
              {lists.finished.map(card)}
            </Group>
          </Folded>
        )}
        {lists.archived.length > 0 && (
          <Folded title={t('clocks.lists.archived')} count={lists.archived.length}>
            <Group gap="xl" align="flex-start">
              {lists.archived.map(card)}
            </Group>
          </Folded>
        )}
      </Stack>

      {rules.data && members.data && (dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <ClockDialog
          roomId={roomId}
          title={
            dialog.kind === 'edit'
              ? t('clocks.dialog.editTitle')
              : proposing
                ? t('clocks.propose')
                : t('clocks.create')
          }
          submitLabel={
            dialog.kind === 'edit'
              ? t('common.save')
              : proposing
                ? t('clocks.dialog.submitPropose')
                : t('clocks.dialog.submitCreate')
          }
          initialValues={dialog.kind === 'edit' ? formOf(dialog.clock) : newForm(room.data?.defaultVisibility)}
          rules={rules.data}
          isMaster={isMaster}
          isCreate={dialog.kind === 'create'}
          documents={documents.data ?? []}
          members={members.data}
          creatorId={dialog.kind === 'edit' ? dialog.clock.createdBy : currentUserId}
          submitting={createClock.isPending || updateClock.isPending}
          error={(dialog.kind === 'edit' ? updateClock.error : createClock.error)?.message ?? null}
          onClose={() => {
            createClock.reset();
            updateClock.reset();
            close();
          }}
          onSubmit={(values) =>
            dialog.kind === 'edit'
              ? updateClock.mutate({ clock: dialog.clock, values }, { onSuccess: close })
              : createClock.mutate(values, { onSuccess: close })
          }
        />
      )}
      {rules.data && dialog?.kind === 'rules' && (
        <ClockRulesDialog roomId={roomId} rules={rules.data} onClose={close} />
      )}
      {dialog?.kind === 'mark' && (
        <MarkDialog
          clock={dialog.clock}
          kinds={kinds}
          isMaster={isMaster}
          onClose={close}
          onSubmit={(input) => {
            marker.mark(dialog.clock, input);
            close();
          }}
        />
      )}
      {members.data && dialog?.kind === 'history' && (
        <ClockHistoryModal
          roomId={roomId}
          clock={dialog.clock}
          kinds={kinds}
          members={members.data}
          onClose={close}
        />
      )}
      <Modal
        opened={dialog?.kind === 'delete'}
        onClose={close}
        title={t('clocks.deleteTitle')}
        centered
      >
        {dialog?.kind === 'delete' && (
          <Stack gap="sm">
            <Text>{t('clocks.deleteBody', { name: dialog.clock.name })}</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button
                color="danger"
                loading={deleteClock.isPending}
                onClick={() =>
                  deleteClock.mutate(dialog.clock.id, { onError: notifyError, onSuccess: close })
                }
              >
                {t('common.delete')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageLayout>
  );
}

/** A new clock's form: the "Vuoto" template, the Room's default visibility. */
function newForm(visibility: ClockFormValues['visibility'] | undefined): ClockFormValues {
  return {
    ...emptySettings(),
    name: '',
    documentId: null,
    visibility: visibility ?? 'room',
    selectiveUserIds: [],
  };
}

/** A clock's form, from the clock as loaded. */
function formOf(clock: Clock): ClockFormValues {
  return {
    description: clock.description,
    segments: clock.segments,
    color: clock.color,
    stageLabels: clock.stageLabels,
    closingCondition: clock.closingCondition,
    consequence: clock.consequence,
    forwardOnly: clock.forwardOnly,
    markPolicy: clock.markPolicy,
    labelIds: clock.labelIds,
    name: clock.name,
    documentId: clock.document?.id ?? null,
    visibility: clock.visibility,
    selectiveUserIds: clock.selectiveUserIds ?? [],
  };
}

/** A group's band (Decision 17): its name, its mode, its result once ended. */
function GroupBand({ group, children }: { group: ClockGroup; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="sm" mb="sm">
        <Title order={2} fz="h4" style={{ fontFamily: 'var(--font-display)' }}>
          {group.name}
        </Title>
        <Badge variant="outline" color="gray" size="sm">
          {t(`clocks.groupMode.${group.mode}`)}
        </Badge>
        {group.ended && (
          <Badge variant="light" color="gray" size="sm">
            {t('clocks.groupEnded')}
          </Badge>
        )}
      </Group>
      <Group gap="xl" align="flex-start">
        {children}
      </Group>
    </Card>
  );
}

/** A folded list under the clocks (Decision 17), with its count. */
function Folded({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box>
      <UnstyledButton onClick={() => setOpen((o) => !o)} aria-expanded={open} mb="xs">
        <Group gap={6}>
          {open ? <CaretDownIcon size={14} /> : <CaretRightIcon size={14} />}
          <Text size="sm" fw={600} tt="uppercase" c="dimmed">
            {title}
          </Text>
          <Badge size="sm" variant="light" color="gray">
            {count}
          </Badge>
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>{children}</Collapse>
    </Box>
  );
}

/** A proposal (Decision 13): who proposed it, its size; the Master opens, edits or rejects it. */
function ProposalRow({
  clock,
  proposer,
  isMaster,
  pending,
  onOpen,
  onEdit,
  onReject,
}: {
  clock: Clock;
  proposer: string;
  isMaster: boolean;
  pending: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder radius="md" p="sm" className="clock-proposal">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="wrap">
          <Badge color="violet" variant="light" size="sm">
            {t('clocks.state.proposed')}
          </Badge>
          <Text fw={600} style={{ fontFamily: 'var(--font-display)' }}>
            {clock.name}
          </Text>
          <Text size="sm" c="dimmed">
            {t('clocks.proposalDetail', { name: proposer, count: clock.segments })}
          </Text>
        </Group>
        {isMaster && (
          <Group gap="xs">
            <Button variant="subtle" color="gray" size="xs" disabled={pending} onClick={onReject}>
              {t('clocks.reject')}
            </Button>
            <Button variant="default" size="xs" disabled={pending} onClick={onEdit}>
              {t('clocks.editProposal')}
            </Button>
            <Button size="xs" loading={pending} onClick={onOpen}>
              {t('clocks.openProposal')}
            </Button>
          </Group>
        )}
      </Group>
    </Card>
  );
}
