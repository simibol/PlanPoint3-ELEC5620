import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Login from "./pages/Login";
import Ingest from "./pages/Ingest";
import Milestones from "./pages/Milestones";
import "./index.css";

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/ingest", element: <Ingest /> },
  { path: "/milestones", element: <Milestones /> },
  { path: "/", element: <Ingest /> }, // default
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
