import { isBepChannelConnectMessage } from "../protocol/validation";
import type { BepChannelConnectMessage } from "../protocol/types";

export interface BootstrapTrustOptions {
  readonly parentWindow: MessageEventSource | null;
  readonly allowedParentOrigins: ReadonlySet<string>;
  readonly alreadyConnected: boolean;
}

export interface TrustedBootstrap {
  readonly message: BepChannelConnectMessage;
  readonly port: MessagePort;
}

export function getTrustedBootstrap(
  event: MessageEvent<unknown>,
  options: BootstrapTrustOptions,
): TrustedBootstrap | null {
  if (
    options.alreadyConnected ||
    event.source !== options.parentWindow ||
    !options.allowedParentOrigins.has(event.origin) ||
    event.ports.length !== 1 ||
    !isBepChannelConnectMessage(event.data)
  ) {
    return null;
  }
  const port = event.ports[0];
  if (!port) {
    return null;
  }
  return {
    message: event.data,
    port,
  };
}
