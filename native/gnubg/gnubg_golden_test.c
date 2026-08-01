/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_adapter.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static void
record_failure(const char *test, const char *message)
{
    fprintf(stderr, "FAIL %s: %s\n", test, message);
    failures++;
}

static int
expect_status(const char *test, const bgc_status actual,
              const bgc_status expected, const bgc_error *error)
{
    if (actual == expected)
        return 1;
    fprintf(stderr, "FAIL %s: expected %s, received %s (%s)\n",
            test, bgc_status_name(expected), bgc_status_name(actual),
            error && error->message[0] ? error->message : "no detail");
    failures++;
    return 0;
}

static bgc_position
empty_money_position(const bgc_player player_on_roll,
                     const unsigned int die0,
                     const unsigned int die1)
{
    bgc_position position;
    memset(&position, 0, sizeof(position));
    position.player_on_roll = player_on_roll;
    position.dice[0] = die0;
    position.dice[1] = die1;
    position.cube.value = 1;
    position.cube.owner = -1;
    position.match.mode = BGC_MATCH_MODE_MONEY;
    position.match.length = 0;
    position.match.crawford = BGC_CRAWFORD_NONE;
    return position;
}

static bgc_position
starting_position(const bgc_player player_on_roll,
                  const unsigned int die0,
                  const unsigned int die1)
{
    bgc_position position = empty_money_position(player_on_roll, die0, die1);

    position.board.points[23].white = 2;
    position.board.points[12].white = 5;
    position.board.points[7].white = 3;
    position.board.points[5].white = 5;
    position.board.points[0].black = 2;
    position.board.points[11].black = 5;
    position.board.points[16].black = 3;
    position.board.points[18].black = 5;
    return position;
}

static void
expect_position_id(const char *test, const bgc_position *position,
                   const char *expected)
{
    char actual[BGC_POSITION_ID_LENGTH + 1];
    bgc_error error;
    const bgc_status status = bgc_position_id(
        position, actual, sizeof(actual), &error);

    if (!expect_status(test, status, BGC_STATUS_OK, &error))
        return;
    if (strcmp(actual, expected) != 0) {
        char message[128];
        snprintf(message, sizeof(message), "expected %s, received %s",
                 expected, actual);
        record_failure(test, message);
    }
}

static void
test_position_mapping(void)
{
    bgc_position start = starting_position(BGC_PLAYER_WHITE, 1, 2);
    bgc_position asymmetric = empty_money_position(BGC_PLAYER_WHITE, 1, 2);
    char too_small[BGC_POSITION_ID_LENGTH];
    bgc_error error;

    expect_position_id("starting position mapping", &start,
                       "4HPwATDgc/ABMA");
    expect_status("Position ID zero capacity",
                  bgc_position_id(&start, too_small, 0, &error),
                  BGC_STATUS_INVALID_ARGUMENT, &error);
    expect_status("Position ID short capacity",
                  bgc_position_id(&start, too_small, sizeof(too_small), &error),
                  BGC_STATUS_INVALID_ARGUMENT, &error);

    asymmetric.board.points[20].white = 1;
    asymmetric.board.points[5].white = 14;
    asymmetric.board.points[3].black = 2;
    asymmetric.board.points[10].black = 13;
    expect_position_id("asymmetric white-on-roll mapping", &asymmetric,
                       "AOD/Awbg/wcABA");

    asymmetric.player_on_roll = BGC_PLAYER_BLACK;
    expect_position_id("asymmetric black-on-roll mapping", &asymmetric,
                       "4P8HAAQA4P8DBg");
}

static void
test_complete_bar_hit(bgc_engine *engine)
{
    const char *test = "complete bar-hit legal turn";
    bgc_position position = empty_money_position(BGC_PLAYER_WHITE, 3, 6);
    const bgc_turn_step steps[] = {
        {
            { BGC_LOCATION_BAR, 0 },
            { BGC_LOCATION_POINT, 21 },
            3,
            1
        }
    };
    const bgc_turn_step non_boolean_hit_steps[] = {
        {
            { BGC_LOCATION_BAR, 0 },
            { BGC_LOCATION_POINT, 21 },
            3,
            2
        }
    };
    const bgc_candidate candidate = { steps, 1 };
    const bgc_candidate non_boolean_hit_candidate = {
        non_boolean_hit_steps,
        1
    };
    const bgc_settings settings = { BGC_STRENGTH_EXPERT };
    bgc_candidate_score score;
    size_t best_index = 99;
    bgc_error error;
    bgc_status status;

    position.board.bar.white = 1;
    position.board.borne_off.white = 14;
    position.board.points[21].black = 1;
    position.board.points[18].black = 2;
    position.board.points[15].black = 2;
    position.board.borne_off.black = 10;

    expect_position_id("bar-hit position mapping", &position,
                       "xBgAAAAAQAAAAA");
    status = bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                    &settings, &score, 1, &best_index, &error);
    if (!expect_status(test, status, BGC_STATUS_OK, &error))
        return;
    if (best_index != 0 || !isfinite(score.score) ||
        !isfinite(score.cubeless_score))
        record_failure(test, "did not return a finite score for candidate zero");

    status = bgc_engine_choose_turn(engine, &position,
                                    &non_boolean_hit_candidate, 1,
                                    &settings, &score, 1, &best_index, &error);
    expect_status("non-boolean hit flag rejection", status,
                  BGC_STATUS_ILLEGAL_TURN, &error);

    status = bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                    &settings, &score, 0, &best_index, &error);
    expect_status("score buffer capacity guard", status,
                  BGC_STATUS_INVALID_ARGUMENT, &error);

    position.cube.value = BGC_MAX_CUBE_VALUE * 2;
    status = bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                    &settings, &score, 1, &best_index, &error);
    expect_status("cube value bound", status,
                  BGC_STATUS_INVALID_POSITION, &error);

    position.cube.value = 1;
    position.rules.automatic_doubles = 17;
    status = bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                    &settings, &score, 1, &best_index, &error);
    expect_status("automatic-doubles bound", status,
                  BGC_STATUS_INVALID_POSITION, &error);

    position.rules.automatic_doubles = 0;
    position.rules.jacoby = 2;
    status = bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                    &settings, &score, 1, &best_index, &error);
    expect_status("non-boolean rule flag rejection", status,
                  BGC_STATUS_INVALID_POSITION, &error);

    position.rules.jacoby = 0;
    position.rules.variation = (bgc_variation) 1;
    status = bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                    &settings, &score, 1, &best_index, &error);
    expect_status("unsupported variation", status,
                  BGC_STATUS_UNSUPPORTED, &error);
}

static void
test_oversize_bearoff_rejected(bgc_engine *engine)
{
    const char *test = "oversize bear-off rejection";
    bgc_position position = empty_money_position(BGC_PLAYER_WHITE, 6, 6);
    const bgc_turn_step steps[] = {
        {
            { BGC_LOCATION_POINT, 1 },
            { BGC_LOCATION_BORNE_OFF, 0 },
            6,
            0
        }
    };
    const bgc_candidate candidate = { steps, 1 };
    const bgc_settings settings = { BGC_STRENGTH_EXPERT };
    bgc_candidate_score score;
    size_t best_index = 0;
    bgc_error error;

    position.board.points[4].white = 1;
    position.board.points[1].white = 1;
    position.board.borne_off.white = 13;
    position.board.points[0].black = 1;
    position.board.borne_off.black = 14;

    expect_status(test,
                  bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                         &settings, &score, 1, &best_index, &error),
                  BGC_STATUS_ILLEGAL_TURN, &error);
}

static void
test_invalid_match_score_rejected(bgc_engine *engine)
{
    const char *test = "finished match score rejection";
    bgc_position position = starting_position(BGC_PLAYER_WHITE, 1, 2);
    const bgc_turn_step steps[] = {
        {
            { BGC_LOCATION_POINT, 23 },
            { BGC_LOCATION_POINT, 22 },
            1,
            0
        },
        {
            { BGC_LOCATION_POINT, 22 },
            { BGC_LOCATION_POINT, 20 },
            2,
            0
        }
    };
    const bgc_candidate candidate = { steps, 2 };
    const bgc_settings settings = { BGC_STRENGTH_EXPERT };
    bgc_candidate_score score;
    size_t best_index = 0;
    bgc_error error;

    position.match.mode = BGC_MATCH_MODE_MATCH;
    position.match.length = 5;
    position.match.score.white = 5;

    expect_status(test,
                  bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                         &settings, &score, 1, &best_index, &error),
                  BGC_STATUS_INVALID_POSITION, &error);

    position.match.score.white = 4;
    position.match.crawford = BGC_CRAWFORD_GAME;
    position.cube.value = 2;
    position.cube.owner = BGC_PLAYER_WHITE;
    expect_status("Crawford cube state rejection",
                  bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                         &settings, &score, 1, &best_index, &error),
                  BGC_STATUS_INVALID_POSITION, &error);

    position.match.length = 1;
    position.match.score.white = 0;
    position.match.crawford = BGC_CRAWFORD_NONE;
    expect_status("one-point match cube state rejection",
                  bgc_engine_choose_turn(engine, &position, &candidate, 1,
                                         &settings, &score, 1, &best_index, &error),
                  BGC_STATUS_INVALID_POSITION, &error);
}

static int
score_start_candidates(bgc_engine *engine, const bgc_player player,
                       const int match_play, const bgc_strength strength,
                       bgc_candidate_score scores[2], size_t *best_index)
{
    bgc_position position = starting_position(player, 1, 2);
    bgc_turn_step steps_a[2];
    bgc_turn_step steps_b[2];
    bgc_candidate candidates[2];
    const bgc_settings settings = { strength };
    bgc_error error;
    bgc_status status;

    if (match_play) {
        position.match.mode = BGC_MATCH_MODE_MATCH;
        position.match.length = 5;
        position.match.score.white =
            player == BGC_PLAYER_WHITE ? 1 : 3;
        position.match.score.black =
            player == BGC_PLAYER_BLACK ? 1 : 3;
        position.cube.value = 2;
        position.cube.owner = player;
    }

    if (player == BGC_PLAYER_WHITE) {
        const bgc_turn_step white_a[] = {
            { { BGC_LOCATION_POINT, 23 }, { BGC_LOCATION_POINT, 22 }, 1, 0 },
            { { BGC_LOCATION_POINT, 22 }, { BGC_LOCATION_POINT, 20 }, 2, 0 }
        };
        const bgc_turn_step white_b[] = {
            { { BGC_LOCATION_POINT, 7 }, { BGC_LOCATION_POINT, 6 }, 1, 0 },
            { { BGC_LOCATION_POINT, 6 }, { BGC_LOCATION_POINT, 4 }, 2, 0 }
        };
        memcpy(steps_a, white_a, sizeof(steps_a));
        memcpy(steps_b, white_b, sizeof(steps_b));
    } else {
        const bgc_turn_step black_a[] = {
            { { BGC_LOCATION_POINT, 0 }, { BGC_LOCATION_POINT, 1 }, 1, 0 },
            { { BGC_LOCATION_POINT, 1 }, { BGC_LOCATION_POINT, 3 }, 2, 0 }
        };
        const bgc_turn_step black_b[] = {
            { { BGC_LOCATION_POINT, 16 }, { BGC_LOCATION_POINT, 17 }, 1, 0 },
            { { BGC_LOCATION_POINT, 17 }, { BGC_LOCATION_POINT, 19 }, 2, 0 }
        };
        memcpy(steps_a, black_a, sizeof(steps_a));
        memcpy(steps_b, black_b, sizeof(steps_b));
    }

    candidates[0].steps = steps_a;
    candidates[0].step_count = 2;
    candidates[1].steps = steps_b;
    candidates[1].step_count = 2;
    status = bgc_engine_choose_turn(engine, &position, candidates, 2,
                                    &settings, scores, 2, best_index, &error);
    return expect_status(player == BGC_PLAYER_WHITE
                             ? "white candidate scoring"
                             : "black candidate scoring",
                         status, BGC_STATUS_OK, &error);
}

static void
test_color_reflection_scores(bgc_engine *engine)
{
    bgc_candidate_score white_scores[2];
    bgc_candidate_score black_scores[2];
    bgc_candidate_score white_match_scores[2];
    bgc_candidate_score black_match_scores[2];
    bgc_candidate_score maximum_scores[2];
    size_t white_best;
    size_t black_best;
    size_t white_match_best;
    size_t black_match_best;
    size_t maximum_best;
    size_t index;

    if (!score_start_candidates(engine, BGC_PLAYER_WHITE, 0,
                                BGC_STRENGTH_EXPERT,
                                white_scores, &white_best) ||
        !score_start_candidates(engine, BGC_PLAYER_BLACK, 0,
                                BGC_STRENGTH_EXPERT,
                                black_scores, &black_best))
        return;

    if (white_best != black_best)
        record_failure("color-reflection scoring",
                       "reflected positions selected different candidates");
    for (index = 0; index < 2; index++) {
        if (fabsf(white_scores[index].score - black_scores[index].score) > 1e-6f ||
            fabsf(white_scores[index].cubeless_score -
                  black_scores[index].cubeless_score) > 1e-6f)
            record_failure("color-reflection scoring",
                           "reflected candidate scores differ");
    }

    if (!score_start_candidates(engine, BGC_PLAYER_WHITE, 1,
                                BGC_STRENGTH_EXPERT,
                                white_match_scores, &white_match_best) ||
        !score_start_candidates(engine, BGC_PLAYER_BLACK, 1,
                                BGC_STRENGTH_EXPERT,
                                black_match_scores, &black_match_best))
        return;
    if (white_match_best != black_match_best)
        record_failure("match color-reflection scoring",
                       "reflected match positions selected different candidates");
    for (index = 0; index < 2; index++) {
        if (fabsf(white_match_scores[index].score -
                  black_match_scores[index].score) > 1e-6f ||
            fabsf(white_match_scores[index].cubeless_score -
                  black_match_scores[index].cubeless_score) > 1e-6f)
            record_failure("match color-reflection scoring",
                           "reflected match candidate scores differ");
    }

    if (!score_start_candidates(engine, BGC_PLAYER_WHITE, 0,
                                BGC_STRENGTH_MAXIMUM,
                                maximum_scores, &maximum_best))
        return;
    if (maximum_best > 1 ||
        !isfinite(maximum_scores[0].score) ||
        !isfinite(maximum_scores[1].score))
        record_failure("maximum multi-candidate scoring",
                       "two-ply scoring did not preserve both candidates");

    if (white_best != 0 ||
        fabsf(white_scores[0].score - (-0.022146732f)) > 1e-5f ||
        fabsf(white_scores[1].score - (-0.127965674f)) > 1e-5f)
        record_failure("golden checker scores",
                       "authenticated expert evaluator output changed");

    printf("Golden checker scores: %.9f %.9f; selected candidate %zu\n",
           white_scores[0].score, white_scores[1].score, white_best);
}

int
main(int argc, char **argv)
{
    char weights_path[4096];
    char match_equity_path[4096];
    bgc_engine *engine = NULL;
    bgc_error error;
    bgc_status status;

    if (argc != 2) {
        fprintf(stderr, "Usage: %s <extracted-gnubg-source-directory>\n", argv[0]);
        return EXIT_FAILURE;
    }
    if (snprintf(weights_path, sizeof(weights_path), "%s/gnubg.weights", argv[1]) >=
            (int) sizeof(weights_path) ||
        snprintf(match_equity_path, sizeof(match_equity_path),
                 "%s/met/Kazaross-XG2.xml", argv[1]) >=
            (int) sizeof(match_equity_path)) {
        fprintf(stderr, "GNUbg source path is too long\n");
        return EXIT_FAILURE;
    }

    status = bgc_engine_create(weights_path, match_equity_path, &engine, &error);
    if (!expect_status("engine initialization", status, BGC_STATUS_OK, &error))
        return EXIT_FAILURE;

    test_position_mapping();
    test_complete_bar_hit(engine);
    test_oversize_bearoff_rejected(engine);
    test_invalid_match_score_rejected(engine);
    test_color_reflection_scores(engine);
    expect_status("engine reset", bgc_engine_reset(engine, &error),
                  BGC_STATUS_OK, &error);

    bgc_engine_dispose(engine);
    if (failures) {
        fprintf(stderr, "%d native golden test(s) failed\n", failures);
        return EXIT_FAILURE;
    }
    printf("All GNUbg native golden tests passed\n");
    return EXIT_SUCCESS;
}
