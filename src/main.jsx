import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sileo";
import App from "./app/App";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/components.css";
import "./styles/interior.css";
import "./styles/layout.css";
import "./styles/platform.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Toaster position="bottom-right" offset={{ bottom: 128, right: 16 }} />
    <App />
  </React.StrictMode>
);
