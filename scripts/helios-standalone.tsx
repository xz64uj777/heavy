import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LaunchSim } from "@/components/LaunchSim";
import "@/styles.css";

const el = document.getElementById("app");
if (!el) throw new Error("Helios Heavy: missing #app");
createRoot(el).render(
  <StrictMode>
    <LaunchSim />
  </StrictMode>,
);
