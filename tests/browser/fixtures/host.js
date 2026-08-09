const PROTOCOL = "backgammon-engine-protocol";
const VERSION = 1;
const NONCE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const status = document.querySelector("#status");
const messages = [];
const pending = new Map();

function createBoard(entries) {
  const points = Array.from({ length: 24 }, () => ({
    white: 0,
    black: 0,
  }));
  for (const [point, white, black] of entries) {
    points[point] = { white, black };
  }
  return {
    points,
    bar: { white: 0, black: 0 },
    borneOff: { white: 0, black: 0 },
  };
}

const startingBoard = createBoard([
  [23, 2, 0],
  [12, 5, 0],
  [7, 3, 0],
  [5, 5, 0],
  [0, 0, 2],
  [11, 0, 5],
  [16, 0, 3],
  [18, 0, 5],
]);

const cubeBoard = createBoard([
  [16, 2, 0],
  [19, 2, 0],
  [21, 2, 0],
  [22, 9, 0],
  [4, 0, 1],
  [7, 0, 11],
  [17, 0, 1],
  [18, 0, 2],
]);

function createPosition(revision, phase, board, dice) {
  return {
    revision,
    phase,
    board,
    playerOnRoll: "white",
    dice,
    cube: {
      value: 1,
      owner: null,
      state: "available",
      offeredBy: null,
    },
    match: {
      mode: "money",
      length: null,
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
}

const settings = {
  strength: "expert",
  limits: { timeMs: 2_000, candidateLimit: 16 },
  randomization: {
    mode: "deterministic",
    seed: "browser-fixture",
    variability: 0,
  },
};

const checkerTurns = [
  {
    id: "turn:worse",
    steps: [
      {
        from: { kind: "point", point: 7 },
        to: { kind: "point", point: 6 },
        die: 1,
        hit: false,
      },
      {
        from: { kind: "point", point: 6 },
        to: { kind: "point", point: 4 },
        die: 2,
        hit: false,
      },
    ],
  },
  {
    id: "turn:best",
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
];

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
    }, 10_000);
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

async function connect() {
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
    // A sandbox without allow-same-origin has an opaque origin, so the
    // bootstrap cannot name it as a target origin. Trust is enforced inside
    // the capsule with event.source plus the exact parent-origin allowlist.
    "*",
    [channel.port2],
  );

  return { channel, iframe };
}

function hello(port, requestId) {
  return request(port, requestId, "hello", {
    supportedProtocolVersions: [1],
    host: { name: "Capsule browser fixture", version: "1" },
  });
}

async function runAssetRetry() {
  const { channel, iframe } = await connect();
  const firstHello = await hello(channel.port1, "request:asset-failure");
  const retryHello = await hello(channel.port1, "request:asset-retry");

  window.capsuleTestResults = {
    firstHello,
    retryHello,
    sandbox: iframe.getAttribute("sandbox"),
    credentialless: iframe.hasAttribute("credentialless"),
  };
  status.textContent = "done";
}

async function runRealEngine() {
  const { channel, iframe } = await connect();

  const helloResult = await hello(channel.port1, "request:hello");
  const choose = await request(
    channel.port1,
    "request:choose",
    "choose-turn",
    {
      enginePlayer: "white",
      position: createPosition(
        "position:checker",
        "checker-play",
        startingBoard,
        [1, 2],
      ),
      legalTurns: checkerTurns,
      settings,
    },
  );
  const cube = await request(
    channel.port1,
    "request:cube",
    "decide-cube",
    {
      enginePlayer: "white",
      position: createPosition(
        "position:cube",
        "before-roll",
        cubeBoard,
        [],
      ),
      phase: "consider-offer",
      legalDecisions: ["too-good", "no-double", "double"],
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
      position: createPosition(
        "position:cancelled",
        "checker-play",
        startingBoard,
        [1, 2],
      ),
      legalTurns: checkerTurns,
      settings: {
        ...settings,
        strength: "maximum",
      },
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

  await new Promise((resolve) => setTimeout(resolve, 50));
  const postCancelHello = await hello(
    channel.port1,
    "request:post-cancel-hello",
  );

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
    hello: helloResult,
    choose,
    cube,
    postCancelHello,
    cancelledResultCount: messages.filter(
      (message) => message.requestId === "request:cancelled",
    ).length,
    secondChannelMessageCount: secondChannelMessages.length,
    sandbox: iframe.getAttribute("sandbox"),
    credentialless: iframe.hasAttribute("credentialless"),
  };
  status.textContent = "done";
}

const assetRetry = new URLSearchParams(window.location.search).has(
  "asset-retry",
);
(assetRetry ? runAssetRetry() : runRealEngine()).catch((error) => {
  window.capsuleTestError =
    error instanceof Error ? error.message : String(error);
  status.textContent = "failed";
});
