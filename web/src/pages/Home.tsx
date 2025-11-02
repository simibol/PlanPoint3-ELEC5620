import ProgressDashboard from "../components/ProgressDashboard";
import { useAuth } from "../hooks/useAuth";

export default function Home() {
  const { user } = useAuth();
  const displayName = user?.displayName || user?.email || undefined;

  return (
    <ProgressDashboard
      allowToggle={false}
      showGreeting
      greetingName={displayName}
      notificationsMode="link-only"
    />
  );
}
