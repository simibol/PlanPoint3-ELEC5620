import { signInWithPopup, signOut } from "firebase/auth";
import { auth, google } from "../firebase";
import { useAuth } from "../hooks/useAuth";
import { Link } from "react-router-dom";

export default function Header() {
  const { user } = useAuth();

  return (
    <div style={{ display:"flex", gap:12, padding:12, borderBottom:"1px solid #eee" }}>
      <Link to="/ingest">Ingest</Link>
      <Link to="/milestones">Milestones</Link>
      <div style={{ marginLeft:"auto" }}>
        {user ? (
          <>
            <span style={{ marginRight:8 }}>{user.email}</span>
            <button onClick={() => signOut(auth)}>Sign out</button>
          </>
        ) : (
          <button onClick={() => signInWithPopup(auth, google)}>Sign in with Google</button>
        )}
      </div>
    </div>
  );
}
