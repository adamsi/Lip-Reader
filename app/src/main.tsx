import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { warmBackend } from "./lib/api";
import "./index.css";

// Kick the backend awake immediately (before first paint) so a cold-started
// container is warming while the user is still reading the landing copy.
warmBackend();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
