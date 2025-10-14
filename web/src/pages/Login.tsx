import { auth, google } from "../firebase";
import { signInWithPopup } from "firebase/auth";

export default function Login() {
  return (
    <div style={{ maxWidth: 420, margin: "6rem auto" }}>
      <h1>PlanPoint – Sign In</h1>
      <button onClick={() => signInWithPopup(auth, google)}>Sign in with Google</button>
    </div>
  );
}
