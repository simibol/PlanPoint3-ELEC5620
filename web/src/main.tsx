import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Login from "./pages/Login";
import Ingest from "./pages/Ingest";
import Milestones from "./pages/Milestones";
import "./index.css";

const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/login", element: <Login /> },
  { path: "/ingest", element: <Ingest /> },
  { path: "/milestones", element: <Milestones /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><RouterProvider router={router} /></React.StrictMode>
);
