import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useLandingEvents, useRoomSections } from '../hooks/useLanding';
import { useDocuments } from '../hooks/useDocuments';
import { useMaps } from '../hooks/useMaps';
import { useMembers } from '../hooks/useMembers';
import { useRoom } from '../hooks/useRooms';
import { useSessionZeroOverview } from '../hooks/useSessionZero';
import { useTags } from '../hooks/useTags';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, SignInRequired, SectionLoader } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { EditModeButton } from '../components/landing/EditModeButton';
import { SectionBlock } from '../components/landing/SectionBlock';
import { SectionEditor } from '../components/landing/SectionEditor';
import { blockContent, isBlockEmpty, type BlockSources } from '../components/landing/blockItems';
import { landingHref } from '../lib/landing';
import { blockHeading, featureLabel, groupLabel, sectionTitle } from '../lib/landingText';
import { markdownToPlain } from '../lib/markdownText';
import type { LandingSection } from '../types/landing';
import { PageHeading } from '../components/PageHeading';

/**
 * `/rooms/:roomId/sections/:sectionId`: a custom Section of the landing
 * (spec 55): its title and description, then its blocks, each listing what
 * the viewer sees of its source. The Master edits it in place
 * (`SectionEditor`). A page card's id leads to the page it opens.
 */
export function RoomSectionPage() {
  const { t } = useTranslation();
  const { roomId, sectionId } = useParams<{ roomId: string; sectionId: string }>();
  const { session, loading } = useSession();

  if (!roomId || !sectionId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('documents.signInRequired')}</SignInRequired>;
  return <RoomSectionContent roomId={roomId} sectionId={sectionId} currentUserId={session.user.id} />;
}

function RoomSectionContent({ roomId, sectionId, currentUserId }: { roomId: string; sectionId: string; currentUserId: string }) {
  const { t } = useTranslation();
  const sections = useRoomSections(roomId);
  const room = useRoom(roomId, true);
  const members = useMembers(roomId, true);
  const readOnly = useReadOnly();
  useLandingEvents(roomId);
  const section = sections.data?.find((candidate) => candidate.id === sectionId);
  const me = members.data?.find((member) => member.userId === currentUserId);
  const isMaster = me?.role === 'master' && !readOnly;
  const canEdit = isMaster && Boolean(section?.canEdit);
  const [editing, setEditing] = useState(false);
  const blocks = section?.blocks ?? [];
  const tags = useTags(roomId, true);
  const documents = useDocuments(roomId, editing || blocks.some((block) => block.kind === 'documents'));
  const maps = useMaps(roomId, editing || blocks.some((block) => block.kind === 'maps'));
  const overview = useSessionZeroOverview(roomId, editing || blocks.some((block) => block.kind === 'session_zero'));
  const sources: BlockSources = {
    documents: documents.data,
    maps: maps.data,
    overview: overview.data,
    tags: tags.data ?? [],
  };

  return (
    <PageLayout
      backTo={landingHref(roomId)}
      backLabel={t('roomLanding.home')}
      roomId={roomId}
      showIndex
      index={section ? { current: section.id, detail: indexDetail(section, sources) } : undefined}
    >
      {sections.isPending && <SectionLoader />}
      {sections.isError && <Text c="red">{t('roomLanding.loadError')}</Text>}
      {sections.data && !section && <Text c="dimmed">{t('roomLanding.notFound')}</Text>}
      {section && (
        <>
          <PageHeading
            kicker={room.data?.name ?? t('roomLanding.home')}
            title={sectionTitle(section)}
            titleAfter={canEdit && <EditModeButton editing={editing} onChange={setEditing} />}
            description={section.description && markdownToPlain(section.description, { separator: ' ' })}
          />
          {canEdit && editing ? (
            <SectionEditor roomId={roomId} section={section} sources={sources} />
          ) : (
            <SectionBlocks roomId={roomId} section={section} sources={sources} isMaster={isMaster} />
          )}
        </>
      )}
    </PageLayout>
  );
}

/** The Section's blocks for reading; a short empty state when none has anything to show. */
function SectionBlocks({ roomId, section, sources, isMaster }: { roomId: string; section: LandingSection; sources: BlockSources; isMaster: boolean }) {
  const { t } = useTranslation();
  const contents = section.blocks.map((block) => blockContent(block, sources));
  const allEmpty = contents.every(isBlockEmpty);
  if (section.blocks.length === 0 || (allEmpty && !isMaster)) {
    return <Text c="dimmed">{t('roomLanding.sectionEmpty')}</Text>;
  }
  return (
    <Stack gap="xl">
      {section.blocks.map((block, index) => (
        <SectionBlock
          key={block.id}
          roomId={roomId}
          block={block}
          heading={blockHeading(block, sources.tags)}
          content={contents[index]}
          isMaster={isMaster}
        />
      ))}
    </Stack>
  );
}

/** What the Index lists of the Section on screen: each block with its groups or features. */
function indexDetail(section: LandingSection, sources: BlockSources) {
  return {
    title: sectionTitle(section),
    entries: section.blocks.map((block) => ({
      id: block.id,
      label: blockHeading(block, sources.tags),
      children:
        block.kind === 'documents'
          ? block.groups.map((group) => groupLabel(group, sources.tags))
          : block.kind === 'session_zero' && block.features.length > 1
            ? block.features.map(featureLabel)
            : [],
    })),
  };
}
