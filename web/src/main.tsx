import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Login from "./pages/Login";
import Ingest from "./pages/Ingest";
import Milestones from "./pages/Milestones";
import Planner from "./pages/Planner";
import Progress from "./pages/Progress";
import Notifications from "./pages/Notifications";
import AuthGate from "./components/AuthGate";
import Header from "./components/Header";
import "./index.css";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <div>{children}</div>
    </>
  );
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/ingest",
    element: (
      <AuthGate>
        <Shell><Ingest /></Shell>
      </AuthGate>
    ),
  },
  {
    path: "/planner",
    element: (
      <AuthGate>
        <Shell><Planner /></Shell>
      </AuthGate>
    ),
  },
  {
    path: "/progress",
    element: (
      <AuthGate>
        <Shell><Progress /></Shell>
      </AuthGate>
    ),
  },
  {
    path: "/notifications",
    element: (
      <AuthGate>
        <Shell><Notifications /></Shell>
      </AuthGate>
    ),
  },
  {
    path: "/milestones",
    element: (
      <AuthGate>
        <Shell><Milestones /></Shell>
      </AuthGate>
    ),
  },
  // default route → guarded ingest
  {
    path: "/",
    element: (
      <AuthGate>
        <Shell><Ingest /></Shell>
      </AuthGate>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
