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

The one-time Window bootstrap uses kind `bep.channel-connect` and transfers one
`MessagePort`. Host messages on that port are `bep.request`, `bep.cancel`, and
`bep.dispose`; engine messages are `bep.result` and `bep.error`.

Methods are:

- `hello`: selects v1 and reports engine metadata/capabilities.
- `choose-turn`: echoes the position revision and returns one supplied opaque
  legal-turn ID.
- `decide-cube`: echoes the revision and returns one supplied legal action.

The board uses absolute points 0–23. White enters on 23 and moves toward 0;
black enters on 0 and moves toward 23. Adapters must not rotate the BEP board
for the engine player.

The capsule identity must be `gnubg-capsule` and its runtime transport must be
`iframe`. The mock advertises standard match/money play, all five accepted
strength presets, checker play, and cube play. It does not claim evaluation,
rankings, or rollouts.

Payloads are limited to 2 MiB, depth 16, 100,000 nodes, 4,096 legal turns, and
four checker steps. Cycles, non-finite numbers, unsafe identifiers, inconsistent
positions, duplicate IDs, and malformed method payloads are rejected.
