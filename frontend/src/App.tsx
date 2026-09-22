import { Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { RoomMembersPage } from './pages/RoomMembersPage';
import { RoomDocumentsPage } from './pages/RoomDocumentsPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/invite/:code" element={<AcceptInvitePage />} />
      <Route path="/rooms/:roomId/members" element={<RoomMembersPage />} />
      <Route path="/rooms/:roomId/documents" element={<RoomDocumentsPage />} />
      <Route path="/rooms/:roomId/documents/:documentId" element={<DocumentDetailPage />} />
    </Routes>
  );
}

export default App;
