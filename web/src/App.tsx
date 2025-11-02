import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { auth } from "./firebase";

export default function App() {
  const nav = useNavigate();
  useEffect(() => auth.onAuthStateChanged(u => { if (!u) nav("/login"); }), [nav]);

  const u = auth.currentUser;
  if (!u) return null;

  return (
    <div style={{ padding: 24 }}>
      <h1>PlanPoint</h1>
      <p>Welcome, {u.displayName || u.email}</p>
      <nav style={{ display: "flex", gap: 12 }}>
        <Link to="/">Home</Link>
        <Link to="/ingest">Schedule Ingestion</Link>
        <Link to="/milestones">Milestones</Link>
        <Link to="/planner">Planner</Link>
      </nav>
    </div>
  );
}
