import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HomePage } from './pages/HomePage';
import { useScrollbarReveal } from './hooks/useScrollbarReveal';
import { ViewAsProvider } from './components/ViewAsProvider';

const AcceptInvitePage = lazy(() =>
  import('./pages/AcceptInvitePage').then((m) => ({ default: m.AcceptInvitePage })),
);
const RoomMembersRedirect = lazy(() =>
  import('./pages/RoomSetupPage').then((m) => ({ default: m.RoomMembersRedirect })),
);
const RoomSetupPage = lazy(() =>
  import('./pages/RoomSetupPage').then((m) => ({ default: m.RoomSetupPage })),
);
const RoomDocumentsPage = lazy(() =>
  import('./pages/RoomDocumentsPage').then((m) => ({ default: m.RoomDocumentsPage })),
);
const DocumentDetailPage = lazy(() =>
  import('./pages/DocumentDetailPage').then((m) => ({ default: m.DocumentDetailPage })),
);
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })),
);
const AddFriendPage = lazy(() =>
  import('./pages/AddFriendPage').then((m) => ({ default: m.AddFriendPage })),
);
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })),
);
const RoomMapsPage = lazy(() =>
  import('./pages/RoomMapsPage').then((m) => ({ default: m.RoomMapsPage })),
);
const RelationshipMapPage = lazy(() =>
  import('./pages/RelationshipMapPage').then((m) => ({ default: m.RelationshipMapPage })),
);
const MentionMapPage = lazy(() =>
  import('./pages/MentionMapPage').then((m) => ({ default: m.MentionMapPage })),
);

/**
 * The route table. Every page but the home page is loaded on demand so the
 * entry chunk stays small (the map pages pull in @xyflow/react). Every page
 * checks the session itself and shows a sign-in prompt when there is none,
 * except the public privacy notice (spec 31_3). `ViewAsProvider` turns a
 * Room's pages into the Master's read-only preview as a member when the URL
 * asks (spec 22b).
 */
function App() {
  // Subscribes the whole tree to language changes: every page re-renders in
  // the new language, including components that read their strings through
  // plain helpers (`userDisplayName`, `formatRelativeTime`) rather than a hook.
  useTranslation();
  // Every page's scrollbar is hidden until the page scrolls (`index.css`).
  useScrollbarReveal();

  return (
    <ViewAsProvider>
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/invite/:code" element={<AcceptInvitePage />} />
        <Route path="/friends/add/:code" element={<AddFriendPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/rooms/:roomId/setup" element={<RoomSetupPage />} />
        <Route path="/rooms/:roomId/members" element={<RoomMembersRedirect />} />
        <Route path="/rooms/:roomId/documents" element={<RoomDocumentsPage />} />
        <Route path="/rooms/:roomId/documents/:documentId" element={<DocumentDetailPage />} />
        <Route path="/rooms/:roomId/documents/:documentId/mention-map" element={<MentionMapPage />} />
        <Route path="/rooms/:roomId/maps" element={<RoomMapsPage />} />
        <Route path="/rooms/:roomId/maps/:mapId" element={<RelationshipMapPage />} />
      </Routes>
      </Suspense>
    </ViewAsProvider>
  );
}

export default App;
