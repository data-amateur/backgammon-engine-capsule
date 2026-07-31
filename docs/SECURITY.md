# Security model

The capsule assumes all incoming structured-clone data is untrusted even
though it arrives through a private port.

Controls include:

- exact parent-origin allowlist;
- `event.source === parent`;
- exactly one port accepted once;
- Window listener removal after bootstrap;
- nonce validation on every port message;
- bounded JSON-shape and method validation;
- request/result correlation;
- legal ID/action checks before returning Worker output;
- late-result suppression after cancellation;
- credentialless CORS asset loads;
- restrictive CSP and `frame-ancestors`;
- no cookies, storage, sockets, analytics, third-party scripts, or Service
  Worker;
- no `eval`, arbitrary commands, or unsafe HTML.

The capsule's wildcard CORS applies only to public immutable engine assets and
never permits credentials. It is required because a sandbox without
`allow-same-origin` performs asset requests from an opaque origin. Parent
authorization is enforced separately at the one-time bootstrap.

Report security issues privately to the project owner until a public security
contact is configured.
