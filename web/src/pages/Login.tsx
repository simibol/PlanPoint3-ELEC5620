import { signInWithPopup } from "firebase/auth";
import { auth, google } from "../firebase";

export default function Login() {
  return (
    <div style={{ maxWidth: 420, margin: "6rem auto", textAlign: "center" }}>
      <h1>PlanPoint – Sign In</h1>
      <button onClick={() => signInWithPopup(auth, google)}>Sign in with Google</button>
    </div>
  );
}
