import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { initializeCloudStorageBridge } from "./services/cloudStorageBridge.js";
import "./styles.css";

async function bootstrap() {
  await initializeCloudStorageBridge();
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();
