# Backgammon Engine Protocol v1

The executable public contract is implemented in `src/protocol/types.ts` and
`src/protocol/validation.ts`.

Every envelope contains:

```json
{
  "protocol": "backgammon-engine-protocol",
  "version": 1,
  "sessionNonce": "host-issued-safe-identifier"
}
```

Session nonces are safe identifiers between 32 and 128 characters. The host
must generate them with cryptographically secure randomness; their purpose is
to bind every private-port message to its one accepted bootstrap session.

The one-time Window bootstrap uses kind `bep.channel-connect` and transfers one
`MessagePort`. Host messages on that port are `bep.request`, `bep.cancel`, and
`bep.dispose`; engine messages are `bep.result` and `bep.error`.

Methods are:

- `hello`: selects v1 and reports engine metadata/capabilities.
- `choose-turn`: echoes the position revision and returns one supplied opaque
  legal-turn ID.
- `decide-cube`: echoes the revision and returns one supplied legal action.

Decision results include search statistics. `completed: false` is valid when
the engine returns its best legal decision after reaching an internal search
limit. Cancellation is different: a cancelled request produces no result, and
the controller suppresses any late Worker response. `elapsedMs` accepts finite
non-negative fractional milliseconds so engines can retain `performance.now()`
precision.

Search limits are hard upper bounds. The capsule enforces `timeMs` by
terminating the compute Worker at the deadline. GNUbg rejects `maxNodes`
because this adapter cannot count native search nodes, and rejects `memoryMb`
below its 128-MiB WebAssembly ceiling. `candidateLimit` only bounds returned
rankings; every host-supplied legal turn remains eligible for selection.
Maximum-strength checker play uses measured two-ply evaluation only for eight
or fewer candidates with at least 500 ms and depth two available. Larger or
tighter requests use expert zero-ply evaluation and report `completed: false`.

The board uses absolute points 0–23. White enters on 23 and moves toward 0;
black enters on 0 and moves toward 23. Adapters must not rotate the BEP board
for the engine player.

Legal-turn candidates may consume fewer than all rolled dice when the
authoritative host has determined that the remaining dice cannot be played.
The capsule validates that every supplied step consumes an available die and
moves in the correct direction, but it does not independently regenerate the
host's legal-turn set.

The capsule identity must be `gnubg-capsule` and its runtime transport must be
`iframe`. The mock advertises standard match/money play, all five accepted
strength presets, checker play, and cube play. It does not claim evaluation,
rankings, or rollouts.

Payloads are limited to 2 MiB, depth 16, 100,000 nodes, 4,096 legal turns, and
four checker steps. Match play is limited to length 64 and cube value 64;
money play retains the general cube ceiling of 4,096. Cycles, non-finite
numbers, unsafe identifiers, inconsistent positions, duplicate IDs, and
malformed method payloads are rejected.
