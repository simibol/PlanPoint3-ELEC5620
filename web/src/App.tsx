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
        <Link to="/ingest">Upload Schedule (UC1)</Link>
        <Link to="/milestones">Milestones (UC2)</Link>
        <Link to="/planner">Auto Planner (UC3)</Link>
        <Link to="/progress">Progress Tracker (UC4)</Link>
        <Link to="/notifications">Notifications (UC5)</Link>
      </nav>
    </div>
  );
}
