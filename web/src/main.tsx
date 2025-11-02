import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import Home from "./pages/Home";
import Ingest from "./pages/Ingest";
import Milestones from "./pages/Milestones";
import Planner from "./pages/Planner";
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
  { path: "/signup", element: <SignUp /> },
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
    path: "/milestones",
    element: (
      <AuthGate>
        <Shell><Milestones /></Shell>
      </AuthGate>
    ),
  },
  {
    path: "/",
    element: (
      <AuthGate>
        <Shell><Home /></Shell>
      </AuthGate>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
