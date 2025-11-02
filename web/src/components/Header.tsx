import { useAuth } from "../hooks/useAuth";
import { Link } from "react-router-dom";

export default function Header() {
  const { user, signOut } = useAuth();

  return (
    <header
      style={{
        background: "linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%)",
        color: "white",
        padding: "0.9rem 1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "1.5rem",
        boxShadow: "0 10px 30px rgba(15,23,42,0.25)",
      }}
    >
      <Link
        to="/"
        style={{
          fontWeight: 700,
          fontSize: "1.05rem",
          letterSpacing: "-0.02em",
          color: "white",
          textDecoration: "none",
        }}
      >
        PlanPoint
      </Link>
      <nav style={{ display: "flex", gap: "1rem" }}>
        <NavLink to="/">Home</NavLink>
        <NavLink to="/ingest">Schedule Ingestion</NavLink>
        <NavLink to="/milestones">Milestones</NavLink>
        <NavLink to="/planner">Planner</NavLink>
      </nav>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {user && (
          <span style={{ fontSize: "0.9rem", opacity: 0.85 }}>
            {user.displayName || user.email}
          </span>
        )}
        {user ? (
          <button
            onClick={signOut}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.5)",
              background: "transparent",
              color: "white",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      style={{
        color: "rgba(255,255,255,0.85)",
        textDecoration: "none",
        fontSize: "0.92rem",
        fontWeight: 600,
      }}
    >
      {children}
    </Link>
  );
}
