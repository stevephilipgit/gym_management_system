import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { initializeTheme } from "./theme.js";
import { validateEnv } from "./utils/envCheck.js";

initializeTheme();
validateEnv();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
