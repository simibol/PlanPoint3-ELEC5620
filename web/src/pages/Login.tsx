import { signInWithPopup } from "firebase/auth";
import { auth, google } from "../firebase";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation() as any;
  const { user } = useAuth();
  const from = loc.state?.from || "/";

  async function go() {
    await signInWithPopup(auth, google);
    nav(from, { replace: true });
  }

  if (user) nav(from, { replace: true });

  return (
    <div style={{ maxWidth: 420, margin: "6rem auto", textAlign: "center" }}>
      <h1>PlanPoint – Sign In</h1>
      <button onClick={go}>Sign in with Google</button>
    </div>
  );
}
