/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * Explicit reference regeneration tool. It calls upstream GNUbg with literal
 * actor-relative boards and cubeinfo, never the capsule analysis or mapping.
 * Normal regression runs compare against checked-in numerical expectations.
 */
#ifdef HAVE_CONFIG_H
#include "config.h"
#endif
#include "gnubg_adapter.h"
#include "eval.h"
#include "positionid.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int
dump(const int match_play, const int weak_play, const int deep)
{
    TanBoard board = {{0}};
    TanBoard played_board;
    cubeinfo cube;
    movelist generated = {0};
    const int score[2] = {1, 3};
    const evalcontext context = {TRUE, 0, FALSE, TRUE, 0.0f};
    positionkey played_key;
    move *owned;
    float best = -INFINITY, played = -INFINITY;
    unsigned int index, best_index = 0, played_rank = 1, evaluated = 0;
    unsigned int ranks[BGC_MAX_CANDIDATES] = {0};
    int selected[BGC_MAX_CANDIDATES] = {0};
    float quick[BGC_MAX_CANDIDATES] = {0};
    /* Both rows use their own home-relative coordinates; no adapter mapping. */
    for (index = 0; index < 2; index++) {
        board[index][23] = 2;
        board[index][12] = 5;
        board[index][7] = 3;
        board[index][5] = 5;
    }
    memcpy(played_board, board, sizeof(board));
    played_board[1][weak_play ? 7 : 23]--;
    played_board[1][weak_play ? 4 : 20]++;
    PositionKey((ConstTanBoard) played_board, &played_key);
    if (SetCubeInfo(&cube, match_play ? 2 : 1, match_play ? 0 : -1, 0,
                    match_play ? 5 : 0, score, FALSE, FALSE, FALSE, VARIATION_STANDARD))
        return 1;
    GenerateMoves(&generated, (ConstTanBoard) board, 1, 2, FALSE);
    owned = calloc(generated.cMoves, sizeof(*owned));
    if (!owned) return 1;
    memcpy(owned, generated.amMoves, generated.cMoves * sizeof(*owned));
    for (index = 0; index < generated.cMoves; index++) {
        if (ScoreMove(NULL, &owned[index], &cube, &context, 0)) {
            free(owned);
            return 1;
        }
        if (owned[index].rScore > best) {
            best = owned[index].rScore;
            best_index = index;
        }
        if (EqualKeys(played_key, owned[index].key)) played = owned[index].rScore;
    }
    /* Pairwise ranks keep selection independent of analyzer sorting/compaction. */
    for (index = 0; index < generated.cMoves; index++) {
        ranks[index] = 1;
        quick[index] = owned[index].rScore;
        for (unsigned int other = 0; other < generated.cMoves; other++)
            if (owned[other].rScore > owned[index].rScore ||
                (owned[other].rScore == owned[index].rScore &&
                 (owned[other].rScore2 > owned[index].rScore2 ||
                  (owned[other].rScore2 == owned[index].rScore2 &&
                   memcmp(&owned[other].key, &owned[index].key, sizeof(positionkey)) < 0))))
                ranks[index]++;
        selected[index] = !deep || ranks[index] <= 2 ||
            (ranks[index] <= 8 && (double) best - owned[index].rScore <= 0.160) ||
            EqualKeys(played_key, owned[index].key);
    }
    if (deep) {
        const evalcontext deeper = {TRUE, 2, TRUE, TRUE, 0.0f};
        best = played = -INFINITY;
        for (index = 0; index < generated.cMoves; index++) {
            if (!selected[index]) continue;
            if (ScoreMove(NULL, &owned[index], &cube, &deeper, 2)) { free(owned); return 1; }
            if (owned[index].rScore > best) { best = owned[index].rScore; best_index = index; }
            if (EqualKeys(played_key, owned[index].key)) played = owned[index].rScore;
        }
    }
    for (index = 0; index < generated.cMoves; index++) {
        if (!selected[index]) continue;
        evaluated++;
        if (owned[index].rScore > played) played_rank++;
    }
    printf("{\"context\":\"%s\",\"profile\":\"%s\",\"legalPositionCount\":%u,"
           "\"evaluatedPositionCount\":%u,\"bestEquity\":%.9g,\"playedEquity\":%.9g,"
           "\"equityLoss\":%.9g,\"playedRank\":%u,\"bestPositionId\":\"%s\",\"roots\":[",
           match_play ? "match-5-score-1-3-cube-2-white-owned" :
               weak_play ? "money-centered-cube-1-played-8-to-5" : "money-centered-cube-1",
           deep ? "deep-2ply-v1" : "quick-0ply-v1", generated.cMoves, evaluated,
           best, played, (double) best - played, played_rank,
           PositionIDFromKey(&owned[best_index].key));
    unsigned int printed = 0;
    for (index = 0; index < generated.cMoves; index++) {
        if (!selected[index]) continue;
        printf("%s{\"positionId\":\"%s\",\"quickRank\":%u,\"quickEquity\":%.9g,\"equity\":%.9g}",
            printed++ ? "," : "", PositionIDFromKey(&owned[index].key), ranks[index], quick[index], owned[index].rScore);
    }
    printf("],");
    PositionFromKey(board, &owned[best_index].key);
    for (unsigned int row = 0; row < 2; row++) {
        printf("\"%s\":[", row ? "bestActor" : "bestOpponent");
        for (index = 0; index < 25; index++)
            printf("%s%u", index ? "," : "", board[row][index]);
        printf("]%s", row ? "}\n" : ",");
    }
    free(owned);
    return 0;
}

/* Cube references call upstream directly, using known GNUbg Position IDs.
 * SetCubeInfo's fMove=0 matches the literal actor row, without capsule mapping. */
static int
dump_cube(const int deep)
{
    const struct { const char *name, *id; int cube, owner, length, score0, score1, crawford; } cases[] = {
        {"double-take", "YAH4PwIAAGP2Hw", 1, -1, 0, 0, 0, 0},
        {"double-pass", "fwDkARwA+BmBHw", 1, -1, 0, 0, 0, 0},
        {"no-double", "AID3Jw5AAPw/BQ", 1, -1, 0, 0, 0, 0},
        {"too-good", "APkIwD/YGQD/AA", 1, -1, 0, 0, 0, 0},
        {"owned-redouble", "fwDkARwA+BmBHw", 2, 0, 0, 0, 0, 0},
        {"match-5-score-1-3", "YAH4PwIAAGP2Hw", 1, -1, 5, 1, 3, 0},
        {"match-7-double-take", "YAH4PwIAAGP2Hw", 1, -1, 7, 0, 0, 0},
        {"match-7-double-pass", "fwDkARwA+BmBHw", 1, -1, 7, 0, 0, 0},
        {"match-7-too-good", "APkIwD/YGQD/AA", 1, -1, 7, 0, 0, 0},
        {"post-crawford-trailing", "YAH4PwIAAGP2Hw", 1, -1, 5, 1, 4, 0},
        {"post-crawford-leading", "YAH4PwIAAGP2Hw", 1, -1, 5, 4, 1, 0},
        {"crawford", "YAH4PwIAAGP2Hw", 1, -1, 5, 4, 0, 1},
        {"double-match-point", "YAH4PwIAAGP2Hw", 1, -1, 5, 4, 4, 0},
    };
    const evalcontext context = {TRUE, deep ? 2u : 0u, deep ? TRUE : FALSE, TRUE, 0.0f};
    for (unsigned int index = 0; index < sizeof(cases)/sizeof(cases[0]); index++) {
        TanBoard board;
        cubeinfo cube;
        const int score[2] = {cases[index].score0, cases[index].score1};
        float outputs[2][NUM_ROLLOUT_OUTPUTS] = {{0}};
        float equities[NUM_CUBEFUL_OUTPUTS] = {0};
        if (!PositionFromID(board, cases[index].id) || SetCubeInfo(&cube,
            cases[index].cube, cases[index].owner, 0, cases[index].length, score,
            cases[index].crawford, FALSE, FALSE, VARIATION_STANDARD)) return 1;
        const int available = GetDPEq(NULL, NULL, &cube);
        cubedecision decision = NOT_AVAILABLE;
        if (available) {
            if (GeneralCubeDecisionE(outputs, (ConstTanBoard) board, &cube, &context, NULL)) return 1;
            decision = FindCubeDecision(equities, outputs, &cube);
        }
        printf("{\"name\":\"%s\",\"positionId\":\"%s\",\"cube\":%d,\"owner\":%d,"
            "\"length\":%d,\"score\":[%d,%d],\"crawford\":%d,\"evaluated\":%s,"
            "\"decision\":%d,\"optimal\":%.9g,\"noDouble\":%.9g,\"take\":%.9g,\"pass\":%.9g,"
            "\"actor\":[", cases[index].name, cases[index].id, cases[index].cube, cases[index].owner,
            cases[index].length, score[0], score[1], cases[index].crawford, available ? "true" : "false",
            decision, equities[OUTPUT_OPTIMAL], equities[OUTPUT_NODOUBLE], equities[OUTPUT_TAKE], equities[OUTPUT_DROP]);
        for (unsigned int point = 0; point < 25; point++) printf("%s%u", point ? "," : "", board[1][point]);
        printf("],\"opponent\":[");
        for (unsigned int point = 0; point < 25; point++) printf("%s%u", point ? "," : "", board[0][point]);
        printf("]}\n");
    }
    return 0;
}

int
main(const int argc, char **argv)
{
    char weights[4096], met[4096];
    bgc_engine *engine = NULL;
    bgc_error error;
    int status;
    if (argc != 2 && argc != 3) return EXIT_FAILURE;
    if (snprintf(weights, sizeof(weights), "%s/gnubg.weights", argv[1]) >= (int) sizeof(weights) ||
        snprintf(met, sizeof(met), "%s/met/Kazaross-XG2.xml", argv[1]) >= (int) sizeof(met))
        return EXIT_FAILURE;
    if (bgc_engine_create(weights, met, &engine, &error) != BGC_STATUS_OK)
        return EXIT_FAILURE;
    const int deep = argc == 3 && (!strcmp(argv[2], "--deep") || !strcmp(argv[2], "--cube-deep"));
    status = argc == 3 && (!strcmp(argv[2], "--cube") || !strcmp(argv[2], "--cube-deep"))
        ? dump_cube(deep) : dump(0, 0, deep) || dump(1, 0, deep) || dump(0, 1, deep);
    bgc_engine_dispose(engine);
    return status ? EXIT_FAILURE : EXIT_SUCCESS;
}
