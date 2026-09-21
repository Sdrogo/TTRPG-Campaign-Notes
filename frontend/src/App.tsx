import { Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { RoomMembersPage } from './pages/RoomMembersPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/invite/:code" element={<AcceptInvitePage />} />
      <Route path="/rooms/:roomId/members" element={<RoomMembersPage />} />
    </Routes>
  );
}

export default App;
