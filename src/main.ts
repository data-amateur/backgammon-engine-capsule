import { CapsuleController, type CapsuleStatus } from "./capsule/controller";
import { getAllowedParentOrigins } from "./capsule/config";
import "./styles.css";

const statusElement = document.querySelector<HTMLElement>("#capsule-status");
const assetBase = import.meta.env.VITE_GNUBG_ASSET_BASE;
if (!assetBase) {
  throw new Error("VITE_GNUBG_ASSET_BASE is required");
}
const engineAssetBaseUrl = new URL(assetBase, window.location.href);

const labels: Record<CapsuleStatus, string> = {
  waiting: "Waiting for a private channel",
  connected: "Private channel connected",
  initializing: "Initializing GNU Backgammon",
  ready: "GNU Backgammon ready",
  failed: "Engine initialization failed",
  disposed: "Session disposed",
};

const controller = new CapsuleController({
  allowedParentOrigins: getAllowedParentOrigins(),
  workerAssetUrl: new URL(
    "./gnubg-engine.worker.js",
    window.location.href,
  ).href,
  engineAssets: {
    moduleUrl: new URL("gnubg-wasm.mjs", engineAssetBaseUrl).href,
    wasmUrl: new URL("gnubg-wasm.wasm", engineAssetBaseUrl).href,
    dataUrl: new URL("gnubg-wasm.data", engineAssetBaseUrl).href,
  },
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
