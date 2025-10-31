import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProgressDashboard from "../components/ProgressDashboard";

export default function ProgressPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const catchupRequested = searchParams.get("catchup") === "1";
  const [initialCatchup] = useState(catchupRequested);

  useEffect(() => {
    if (!catchupRequested) return;
    const params = new URLSearchParams(searchParams);
    params.delete("catchup");
    setSearchParams(params, { replace: true });
  }, [catchupRequested, searchParams, setSearchParams]);

  return (
    <ProgressDashboard
      allowToggle
      initialAutoCatchup={initialCatchup}
      notificationsMode="none"
    />
  );
}
