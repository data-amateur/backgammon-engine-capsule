const PROTOCOL = "backgammon-engine-protocol";
const VERSION = 1;
const NONCE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const status = document.querySelector("#status");
const messages = [];
const pending = new Map();

const points = Array.from({ length: 24 }, () => ({ white: 0, black: 0 }));
points[23].white = 2;
points[12].white = 5;
points[7].white = 3;
points[5].white = 5;
points[0].black = 2;
points[11].black = 5;
points[16].black = 3;
points[18].black = 5;

const board = {
  points,
  bar: { white: 0, black: 0 },
  borneOff: { white: 0, black: 0 },
};

const basePosition = {
  board,
  playerOnRoll: "white",
  cube: {
    value: 1,
    owner: null,
    state: "available",
    offeredBy: null,
  },
  match: {
    mode: "match",
    length: 5,
    score: { white: 0, black: 0 },
    crawford: "none",
  },
  rules: {
    variation: "standard",
    jacoby: false,
    beavers: false,
    raccoons: false,
    automaticDoubles: 0,
  },
};

const settings = {
  strength: "intermediate",
  limits: { timeMs: 500, candidateLimit: 16 },
  randomization: {
    mode: "deterministic",
    seed: "browser-fixture",
    variability: 0,
  },
};

function createIframe() {
  const iframe = document.createElement("iframe");
  iframe.src = "http://localhost:4174/";
  iframe.title = "Backgammon computer engine";
  iframe.referrerPolicy = "no-referrer";
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("credentialless", "");
  document.body.append(iframe);
  return iframe;
}

function request(port, requestId, method, payload) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${method} timed out`));
    }, 5_000);
    pending.set(requestId, {
      resolve: (message) => {
        clearTimeout(timeoutId);
        resolve(message);
      },
    });
    port.postMessage({
      protocol: PROTOCOL,
      version: VERSION,
      sessionNonce: NONCE,
      kind: "bep.request",
      requestId,
      method,
      payload,
    });
  });
}

async function run() {
  const iframe = createIframe();
  await new Promise((resolve, reject) => {
    iframe.addEventListener("load", resolve, { once: true });
    iframe.addEventListener("error", () => reject(new Error("iframe failed")), {
      once: true,
    });
  });

  const channel = new MessageChannel();
  channel.port1.addEventListener("message", (event) => {
    messages.push(event.data);
    const entry = pending.get(event.data?.requestId);
    if (entry) {
      pending.delete(event.data.requestId);
      entry.resolve(event.data);
    }
  });
  channel.port1.start();

  iframe.contentWindow.postMessage(
    {
      protocol: PROTOCOL,
      version: VERSION,
      sessionNonce: NONCE,
      kind: "bep.channel-connect",
    },
    "*",
    [channel.port2],
  );

  const hello = await request(channel.port1, "request:hello", "hello", {
    supportedProtocolVersions: [1],
    host: { name: "Capsule browser fixture", version: "1" },
  });

  const choose = await request(
    channel.port1,
    "request:choose",
    "choose-turn",
    {
      enginePlayer: "white",
      position: {
        ...basePosition,
        revision: "position:checker",
        phase: "checker-play",
        dice: [1, 2],
      },
      legalTurns: [
        {
          id: "turn:first",
          steps: [
            {
              from: { kind: "point", point: 23 },
              to: { kind: "point", point: 22 },
              die: 1,
              hit: false,
            },
            {
              from: { kind: "point", point: 22 },
              to: { kind: "point", point: 20 },
              die: 2,
              hit: false,
            },
          ],
        },
        {
          id: "turn:second",
          steps: [
            {
              from: { kind: "point", point: 12 },
              to: { kind: "point", point: 10 },
              die: 2,
              hit: false,
            },
            {
              from: { kind: "point", point: 10 },
              to: { kind: "point", point: 9 },
              die: 1,
              hit: false,
            },
          ],
        },
      ],
      settings,
    },
  );

  const cube = await request(
    channel.port1,
    "request:cube",
    "decide-cube",
    {
      enginePlayer: "white",
      position: {
        ...basePosition,
        revision: "position:cube",
        phase: "before-roll",
        dice: [],
      },
      phase: "consider-offer",
      legalDecisions: ["double", "no-double"],
      settings,
    },
  );

  channel.port1.postMessage({
    protocol: PROTOCOL,
    version: VERSION,
    sessionNonce: NONCE,
    kind: "bep.request",
    requestId: "request:cancelled",
    method: "choose-turn",
    payload: {
      enginePlayer: "white",
      position: {
        ...basePosition,
        revision: "position:cancelled",
        phase: "checker-play",
        dice: [1, 2],
      },
      legalTurns: [
        {
          id: "turn:cancelled",
          steps: [
            {
              from: { kind: "point", point: 23 },
              to: { kind: "point", point: 22 },
              die: 1,
              hit: false,
            },
          ],
        },
      ],
      settings,
    },
  });
  channel.port1.postMessage({
    protocol: PROTOCOL,
    version: VERSION,
    sessionNonce: NONCE,
    kind: "bep.cancel",
    requestId: "request:cancelled",
    reason: "caller",
  });

  const secondChannel = new MessageChannel();
  const secondChannelMessages = [];
  secondChannel.port1.addEventListener("message", (event) => {
    secondChannelMessages.push(event.data);
  });
  secondChannel.port1.start();
  iframe.contentWindow.postMessage(
    {
      protocol: PROTOCOL,
      version: VERSION,
      sessionNonce: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      kind: "bep.channel-connect",
    },
    "*",
    [secondChannel.port2],
  );

  await new Promise((resolve) => setTimeout(resolve, 150));
  window.capsuleTestResults = {
    hello,
    choose,
    cube,
    cancelledResultCount: messages.filter(
      (message) => message.requestId === "request:cancelled",
    ).length,
    secondChannelMessageCount: secondChannelMessages.length,
    sandbox: iframe.getAttribute("sandbox"),
    credentialless: iframe.hasAttribute("credentialless"),
  };
  status.textContent = "done";
}

run().catch((error) => {
  window.capsuleTestError = error instanceof Error ? error.message : String(error);
  status.textContent = "failed";
});
