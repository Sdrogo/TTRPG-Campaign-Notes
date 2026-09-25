import { Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HomePage } from './pages/HomePage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { RoomMembersPage } from './pages/RoomMembersPage';
import { RoomDocumentsPage } from './pages/RoomDocumentsPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';
import { AccountPage } from './pages/AccountPage';

/**
 * The route table. Every page checks the session itself and shows a sign-in
 * prompt when there is none.
 */
function App() {
  // Subscribes the whole tree to language changes: every page re-renders in
  // the new language, including components that read their strings through
  // plain helpers (`userDisplayName`, `formatRelativeTime`) rather than a hook.
  useTranslation();

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/invite/:code" element={<AcceptInvitePage />} />
      <Route path="/rooms/:roomId/members" element={<RoomMembersPage />} />
      <Route path="/rooms/:roomId/documents" element={<RoomDocumentsPage />} />
      <Route path="/rooms/:roomId/documents/:documentId" element={<DocumentDetailPage />} />
    </Routes>
  );
}

export default App;
