import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { warmBackend } from "./lib/api";
import "./index.css";

// warm cold-started backends before first paint
warmBackend();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
