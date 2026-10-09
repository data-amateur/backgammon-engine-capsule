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
dump(const int match_play, const int weak_play)
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
    unsigned int index, best_index = 0, played_rank = 1;
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
    for (index = 0; index < generated.cMoves; index++)
        if (owned[index].rScore > played) played_rank++;
    printf("{\"context\":\"%s\",\"legalPositionCount\":%u,"
           "\"bestEquity\":%.9g,\"playedEquity\":%.9g,"
           "\"equityLoss\":%.9g,\"playedRank\":%u,\"bestPositionId\":\"%s\",",
           match_play ? "match-5-score-1-3-cube-2-white-owned" :
               weak_play ? "money-centered-cube-1-played-8-to-5" : "money-centered-cube-1",
           generated.cMoves, best, played, (double) best - played, played_rank,
           PositionIDFromKey(&owned[best_index].key));
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

int
main(const int argc, char **argv)
{
    char weights[4096], met[4096];
    bgc_engine *engine = NULL;
    bgc_error error;
    int status;
    if (argc != 2) return EXIT_FAILURE;
    if (snprintf(weights, sizeof(weights), "%s/gnubg.weights", argv[1]) >= (int) sizeof(weights) ||
        snprintf(met, sizeof(met), "%s/met/Kazaross-XG2.xml", argv[1]) >= (int) sizeof(met))
        return EXIT_FAILURE;
    if (bgc_engine_create(weights, met, &engine, &error) != BGC_STATUS_OK)
        return EXIT_FAILURE;
    status = dump(0, 0) || dump(1, 0) || dump(0, 1);
    bgc_engine_dispose(engine);
    return status ? EXIT_FAILURE : EXIT_SUCCESS;
}
