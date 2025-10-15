import { Navigate, useLocation } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) return <div style={{ padding: 24 }}>Checking sign-in…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;

  return <>{children}</>;
}
