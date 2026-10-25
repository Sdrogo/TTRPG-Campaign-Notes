import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  clearSigningIn,
  readPendingFriendCode,
  readPendingInvite,
  readSigningIn,
} from '../lib/pendingInvite';
import { useSession } from '../hooks/useSession';
import { FullPageLoader } from '../components/PageState';
import { LandingPage } from './LandingPage';

/**
 * `/`: the landing page, for everyone (spec 45). Right after the sign-in
 * round trip it carries the user on instead: to a pending invite or friend
 * link first, else to their Rooms.
 */
export function HomePage() {
  const { session, loading: sessionLoading } = useSession();
  // Read once: the marker is cleared below as soon as the session is there.
  const [justSignedIn] = useState(readSigningIn);

  useEffect(() => {
    if (session) clearSigningIn();
  }, [session]);

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (session) {
    // Signed in right after opening an invite link: finish joining the Room.
    const pendingInvite = readPendingInvite();
    if (pendingInvite) {
      return <Navigate to={`/invite/${encodeURIComponent(pendingInvite)}`} replace />;
    }

    // Signed in right after opening a friend link: finish sending the request.
    const pendingFriendCode = readPendingFriendCode();
    if (pendingFriendCode) {
      return <Navigate to={`/friends/add/${encodeURIComponent(pendingFriendCode)}`} replace />;
    }

    if (justSignedIn) {
      return <Navigate to="/rooms" replace />;
    }
  }

  return <LandingPage signedIn={Boolean(session)} />;
}
