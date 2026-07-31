import { CapsuleController, type CapsuleStatus } from "./capsule/controller";
import { getAllowedParentOrigins } from "./capsule/config";
import "./styles.css";

const statusElement = document.querySelector<HTMLElement>("#capsule-status");

const labels: Record<CapsuleStatus, string> = {
  waiting: "Waiting for a private channel",
  connected: "Private channel connected",
  initializing: "Initializing mock Worker",
  ready: "Mock Worker ready",
  failed: "Engine initialization failed",
  disposed: "Session disposed",
};

const controller = new CapsuleController({
  allowedParentOrigins: getAllowedParentOrigins(),
  workerAssetUrl: new URL("./mock-engine.worker.js", window.location.href).href,
  onStatusChange: (status, detail) => {
    if (statusElement) {
      statusElement.textContent = detail
        ? `${labels[status]}: ${detail}`
        : labels[status];
    }
    document.documentElement.dataset.capsuleStatus = status;
  },
});

// This runs before the iframe load event, so the one-time bootstrap message
// cannot race ahead of the listener.
controller.start();
