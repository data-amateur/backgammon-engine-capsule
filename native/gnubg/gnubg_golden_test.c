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
    position.cube.state = BGC_CUBE_STATE_AVAILABLE;
    position.cube.offered_by = -1;
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

    position.match.score.white = 256;
    expect_status("wide match score rejection",
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

static const char *
cube_action_name(const bgc_cube_action action)
{
    switch (action) {
    case BGC_CUBE_ACTION_DOUBLE:
        return "double";
    case BGC_CUBE_ACTION_NO_DOUBLE:
        return "no-double";
    case BGC_CUBE_ACTION_TOO_GOOD:
        return "too-good";
    case BGC_CUBE_ACTION_TAKE:
        return "take";
    case BGC_CUBE_ACTION_PASS:
        return "pass";
    case BGC_CUBE_ACTION_BEAVER:
        return "beaver";
    default:
        return "invalid";
    }
}

static bgc_position
cube_double_take_position(void)
{
    bgc_position position = empty_money_position(BGC_PLAYER_WHITE, 0, 0);

    position.board.points[16].white = 2;
    position.board.points[19].white = 2;
    position.board.points[21].white = 2;
    position.board.points[22].white = 9;
    position.board.points[4].black = 1;
    position.board.points[7].black = 11;
    position.board.points[17].black = 1;
    position.board.points[18].black = 2;
    return position;
}

static bgc_position
cube_double_pass_position(void)
{
    bgc_position position = empty_money_position(BGC_PLAYER_WHITE, 0, 0);

    position.board.points[11].white = 6;
    position.board.points[13].white = 2;
    position.board.points[16].white = 1;
    position.board.points[22].white = 6;
    position.board.points[1].black = 3;
    position.board.points[10].black = 4;
    position.board.points[12].black = 1;
    position.board.points[23].black = 7;
    return position;
}

static bgc_position
cube_no_double_position(void)
{
    bgc_position position = empty_money_position(BGC_PLAYER_WHITE, 0, 0);

    position.board.points[6].white = 1;
    position.board.points[17].white = 12;
    position.board.points[19].white = 1;
    position.board.points[20].white = 1;
    position.board.points[2].black = 3;
    position.board.points[5].black = 1;
    position.board.points[7].black = 7;
    position.board.points[8].black = 4;
    return position;
}

static bgc_position
cube_too_good_position(void)
{
    bgc_position position = empty_money_position(BGC_PLAYER_WHITE, 0, 0);

    position.board.points[3].white = 2;
    position.board.points[4].white = 3;
    position.board.points[6].white = 2;
    position.board.points[17].white = 8;
    position.board.points[0].black = 8;
    position.board.points[10].black = 1;
    position.board.points[13].black = 5;
    position.board.points[15].black = 1;
    return position;
}

static bgc_position
cube_beaver_position(void)
{
    bgc_position position = empty_money_position(BGC_PLAYER_WHITE, 0, 0);

    position.board.points[6].white = 1;
    position.board.points[11].white = 2;
    position.board.points[12].white = 11;
    position.board.points[21].white = 1;
    position.board.points[1].black = 3;
    position.board.points[15].black = 2;
    position.board.points[16].black = 8;
    position.board.points[18].black = 2;
    position.rules.jacoby = 1;
    position.rules.beavers = 1;
    return position;
}

static bgc_position
reflect_position(const bgc_position *position)
{
    bgc_position reflected = *position;
    unsigned int point;

    memset(&reflected.board, 0, sizeof(reflected.board));
    for (point = 0; point < BGC_POINT_COUNT; point++) {
        reflected.board.points[23 - point].white =
            position->board.points[point].black;
        reflected.board.points[23 - point].black =
            position->board.points[point].white;
    }
    reflected.board.bar.white = position->board.bar.black;
    reflected.board.bar.black = position->board.bar.white;
    reflected.board.borne_off.white = position->board.borne_off.black;
    reflected.board.borne_off.black = position->board.borne_off.white;
    reflected.player_on_roll = position->player_on_roll == BGC_PLAYER_WHITE
        ? BGC_PLAYER_BLACK : BGC_PLAYER_WHITE;
    reflected.cube.owner = position->cube.owner == -1
        ? -1 : !position->cube.owner;
    reflected.cube.offered_by = position->cube.offered_by == -1
        ? -1 : !position->cube.offered_by;
    reflected.match.score.white = position->match.score.black;
    reflected.match.score.black = position->match.score.white;
    return reflected;
}

static int
expect_cube_call(bgc_engine *engine, const char *test,
                 const bgc_position *position,
                 const bgc_cube_decision_phase phase,
                 const bgc_player engine_player,
                 const bgc_cube_action *actions,
                 const size_t action_count,
                 const bgc_cube_action expected_action,
                 const size_t expected_index,
                 const int expected_evaluated,
                 bgc_cube_analysis *analysis_out)
{
    const bgc_settings settings = { BGC_STRENGTH_EXPERT };
    bgc_cube_analysis local_analysis;
    bgc_cube_analysis *analysis = analysis_out ? analysis_out : &local_analysis;
    bgc_error error;
    bgc_status status = bgc_engine_decide_cube(
        engine, position, phase, engine_player, actions, action_count,
        &settings, analysis, &error);

    if (!expect_status(test, status, BGC_STATUS_OK, &error))
        return 0;
    if (analysis->decision != expected_action ||
        analysis->selected_index != expected_index ||
        analysis->selected_index >= action_count ||
        actions[analysis->selected_index] != analysis->decision ||
        analysis->evaluated != expected_evaluated) {
        char message[256];
        snprintf(message, sizeof(message),
                 "expected %s at index %zu (evaluated=%d), received %s at "
                 "index %u (evaluated=%d)",
                 cube_action_name(expected_action), expected_index,
                 expected_evaluated, cube_action_name(analysis->decision),
                 analysis->selected_index, analysis->evaluated);
        record_failure(test, message);
        return 0;
    }
    return 1;
}

static void
expect_equity(const char *test, const char *field,
              const float actual, const float expected)
{
    if (!isfinite(actual) || fabsf(actual - expected) > 1e-5f) {
        char message[192];
        snprintf(message, sizeof(message),
                 "%s expected %.9f, received %.9f",
                 field, expected, actual);
        record_failure(test, message);
    }
}

static void
expect_cube_equities(const char *test, const bgc_cube_analysis *analysis,
                     const float optimal, const float no_double,
                     const float double_take, const float double_pass)
{
    expect_equity(test, "pre-offer optimal equity",
                  analysis->preoffer_optimal_equity, optimal);
    expect_equity(test, "no-double equity",
                  analysis->no_double_equity, no_double);
    expect_equity(test, "double/take equity",
                  analysis->double_take_equity, double_take);
    expect_equity(test, "double/pass equity",
                  analysis->double_pass_equity, double_pass);
}

static void
test_cube_goldens(bgc_engine *engine)
{
    const bgc_cube_action offer_actions[] = {
        BGC_CUBE_ACTION_TOO_GOOD,
        BGC_CUBE_ACTION_NO_DOUBLE,
        BGC_CUBE_ACTION_DOUBLE
    };
    const bgc_cube_action response_actions[] = {
        BGC_CUBE_ACTION_PASS,
        BGC_CUBE_ACTION_TAKE
    };
    const bgc_cube_action no_double_only[] = {
        BGC_CUBE_ACTION_NO_DOUBLE
    };
    const bgc_cube_action double_or_too_good[] = {
        BGC_CUBE_ACTION_DOUBLE,
        BGC_CUBE_ACTION_TOO_GOOD
    };
    bgc_cube_analysis analysis;
    bgc_cube_analysis reflected_analysis;
    bgc_position position;
    bgc_position response;
    bgc_position reflected;

    position = cube_double_take_position();
    expect_position_id("double/take Position ID", &position,
                       "YAH4PwIAAGP2Hw");
    if (expect_cube_call(engine, "double/take offer", &position,
                         BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                         offer_actions, 3, BGC_CUBE_ACTION_DOUBLE, 2, 1,
                         &analysis)) {
        expect_cube_equities("double/take offer", &analysis,
                             0.885209322f, 0.796325445f,
                             0.885209322f, 1.0f);
        expect_equity("double/take selected equity", "selected equity",
                      analysis.selected_action_equity, 0.885209322f);
    }

    response = position;
    response.cube.state = BGC_CUBE_STATE_OFFERED;
    response.cube.offered_by = BGC_PLAYER_WHITE;
    expect_cube_call(engine, "double/take response", &response,
                     BGC_CUBE_PHASE_RESPOND_TO_OFFER, BGC_PLAYER_BLACK,
                     response_actions, 2, BGC_CUBE_ACTION_TAKE, 1, 1,
                     &analysis);

    reflected = reflect_position(&position);
    expect_position_id("reflected double/take Position ID", &reflected,
                       "YAH4PwIAAGP2Hw");
    if (expect_cube_call(engine, "reflected double/take offer", &reflected,
                         BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_BLACK,
                         offer_actions, 3, BGC_CUBE_ACTION_DOUBLE, 2, 1,
                         &reflected_analysis)) {
        expect_equity("reflected no-double equity", "no-double equity",
                      reflected_analysis.no_double_equity,
                      analysis.no_double_equity);
        expect_equity("reflected double/take equity", "double/take equity",
                      reflected_analysis.double_take_equity,
                      analysis.double_take_equity);
        expect_equity("reflected double/pass equity", "double/pass equity",
                      reflected_analysis.double_pass_equity,
                      analysis.double_pass_equity);
    }

    position = cube_double_pass_position();
    expect_position_id("double/pass Position ID", &position,
                       "fwDkARwA+BmBHw");
    if (expect_cube_call(engine, "double/pass offer", &position,
                         BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                         offer_actions, 3, BGC_CUBE_ACTION_DOUBLE, 2, 1,
                         &analysis))
        expect_cube_equities("double/pass offer", &analysis,
                             1.0f, 0.903714538f, 1.050116777f, 1.0f);

    response = position;
    response.cube.state = BGC_CUBE_STATE_OFFERED;
    response.cube.offered_by = BGC_PLAYER_WHITE;
    expect_cube_call(engine, "double/pass response", &response,
                     BGC_CUBE_PHASE_RESPOND_TO_OFFER, BGC_PLAYER_BLACK,
                     response_actions, 2, BGC_CUBE_ACTION_PASS, 0, 1,
                     &analysis);

    position.cube.value = 2;
    position.cube.owner = BGC_PLAYER_WHITE;
    position.cube.state = BGC_CUBE_STATE_ACCEPTED;
    expect_cube_call(engine, "owned-cube redouble", &position,
                     BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                     offer_actions, 3, BGC_CUBE_ACTION_DOUBLE, 2, 1,
                     &analysis);
    reflected = reflect_position(&position);
    expect_cube_call(engine, "reflected owned-cube redouble", &reflected,
                     BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_BLACK,
                     offer_actions, 3, BGC_CUBE_ACTION_DOUBLE, 2, 1,
                     &reflected_analysis);
    expect_equity("reflected redouble equity", "selected equity",
                  reflected_analysis.selected_action_equity,
                  analysis.selected_action_equity);

    position = cube_no_double_position();
    expect_position_id("no-double Position ID", &position,
                       "AID3Jw5AAPw/BQ");
    if (expect_cube_call(engine, "no-double offer", &position,
                         BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                         offer_actions, 3, BGC_CUBE_ACTION_NO_DOUBLE, 1, 1,
                         &analysis))
        expect_cube_equities("no-double offer", &analysis,
                             -0.010182460f, -0.010182460f,
                             -0.395585269f, 1.0f);
    expect_cube_call(engine, "no-double subset alias", &position,
                     BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                     double_or_too_good, 2, BGC_CUBE_ACTION_TOO_GOOD, 1, 1,
                     &analysis);
    expect_cube_call(engine, "forced no-double singleton", &position,
                     BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                     no_double_only, 1, BGC_CUBE_ACTION_NO_DOUBLE, 0, 0,
                     &analysis);
}

static void
test_cube_beavers_and_jacoby(bgc_engine *engine)
{
    const bgc_cube_action offer_actions[] = {
        BGC_CUBE_ACTION_DOUBLE,
        BGC_CUBE_ACTION_NO_DOUBLE,
        BGC_CUBE_ACTION_TOO_GOOD
    };
    const bgc_cube_action full_response[] = {
        BGC_CUBE_ACTION_PASS,
        BGC_CUBE_ACTION_BEAVER,
        BGC_CUBE_ACTION_TAKE
    };
    const bgc_cube_action ordinary_response[] = {
        BGC_CUBE_ACTION_PASS,
        BGC_CUBE_ACTION_TAKE
    };
    const bgc_cube_action beaver_or_pass[] = {
        BGC_CUBE_ACTION_BEAVER,
        BGC_CUBE_ACTION_PASS
    };
    const bgc_cube_action beaver_only[] = {
        BGC_CUBE_ACTION_BEAVER
    };
    const bgc_settings settings = { BGC_STRENGTH_EXPERT };
    bgc_cube_analysis analysis;
    bgc_position position = cube_beaver_position();
    bgc_position response;
    bgc_error error;

    expect_position_id("beaver Position ID", &position,
                       "YP4NABxAsP8DCA");
    if (expect_cube_call(engine, "beaver offer", &position,
                         BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                         offer_actions, 3, BGC_CUBE_ACTION_NO_DOUBLE, 1, 1,
                         &analysis))
        expect_cube_equities("beaver offer", &analysis,
                             -0.348086745f, -0.348086745f,
                             -0.999342144f, 1.0f);

    response = position;
    response.cube.state = BGC_CUBE_STATE_OFFERED;
    response.cube.offered_by = BGC_PLAYER_WHITE;
    expect_cube_call(engine, "beaver response", &response,
                     BGC_CUBE_PHASE_RESPOND_TO_OFFER, BGC_PLAYER_BLACK,
                     full_response, 3, BGC_CUBE_ACTION_BEAVER, 1, 1,
                     &analysis);
    expect_cube_call(engine, "beaver omitted fallback", &response,
                     BGC_CUBE_PHASE_RESPOND_TO_OFFER, BGC_PLAYER_BLACK,
                     ordinary_response, 2, BGC_CUBE_ACTION_TAKE, 1, 1,
                     &analysis);

    response = cube_double_take_position();
    response.rules.beavers = 1;
    response.cube.state = BGC_CUBE_STATE_OFFERED;
    response.cube.offered_by = BGC_PLAYER_WHITE;
    expect_cube_call(engine, "equity-ranked beaver/pass subset", &response,
                     BGC_CUBE_PHASE_RESPOND_TO_OFFER, BGC_PLAYER_BLACK,
                     beaver_or_pass, 2, BGC_CUBE_ACTION_PASS, 1, 1,
                     &analysis);

    response = cube_beaver_position();
    response.cube.state = BGC_CUBE_STATE_OFFERED;
    response.cube.offered_by = BGC_PLAYER_WHITE;
    response.cube.value = 1024;
    expect_cube_call(engine, "maximum legal beaver cube", &response,
                     BGC_CUBE_PHASE_RESPOND_TO_OFFER, BGC_PLAYER_BLACK,
                     beaver_only, 1, BGC_CUBE_ACTION_BEAVER, 0, 0,
                     &analysis);
    response.cube.value = 2048;
    expect_status("oversize beaver cube rejection",
                  bgc_engine_decide_cube(
                      engine, &response, BGC_CUBE_PHASE_RESPOND_TO_OFFER,
                      BGC_PLAYER_BLACK, beaver_only, 1, &settings,
                      &analysis, &error),
                  BGC_STATUS_INVALID_ARGUMENT, &error);

    position = cube_too_good_position();
    expect_position_id("too-good Position ID", &position,
                       "APkIwD/YGQD/AA");
    if (expect_cube_call(engine, "too-good without Jacoby", &position,
                         BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                         offer_actions, 3, BGC_CUBE_ACTION_TOO_GOOD, 2, 1,
                         &analysis))
        expect_cube_equities("too-good without Jacoby", &analysis,
                             1.385210276f, 1.385210276f,
                             2.332368374f, 1.0f);
    position.rules.jacoby = 1;
    if (expect_cube_call(engine, "Jacoby double/pass", &position,
                         BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                         offer_actions, 3, BGC_CUBE_ACTION_DOUBLE, 0, 1,
                         &analysis))
        expect_cube_equities("Jacoby double/pass", &analysis,
                             1.0f, 0.888083518f, 2.332368374f, 1.0f);
}

static void
test_cube_boundaries_and_validation(bgc_engine *engine)
{
    const bgc_cube_action offer_actions[] = {
        BGC_CUBE_ACTION_DOUBLE,
        BGC_CUBE_ACTION_NO_DOUBLE
    };
    const bgc_cube_action response_actions[] = {
        BGC_CUBE_ACTION_TAKE,
        BGC_CUBE_ACTION_PASS
    };
    const bgc_cube_action duplicate_actions[] = {
        BGC_CUBE_ACTION_DOUBLE,
        BGC_CUBE_ACTION_DOUBLE
    };
    const bgc_cube_action mixed_actions[] = {
        BGC_CUBE_ACTION_DOUBLE,
        BGC_CUBE_ACTION_TAKE
    };
    const bgc_settings settings = { BGC_STRENGTH_EXPERT };
    bgc_position position = starting_position(BGC_PLAYER_WHITE, 0, 0);
    bgc_cube_analysis analysis;
    bgc_error error;

    position.match.mode = BGC_MATCH_MODE_MATCH;
    position.match.length = 64;
    position.cube.value = 64;
    expect_cube_call(engine, "match cube-64 offer short-circuit", &position,
                     BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                     offer_actions, 2, BGC_CUBE_ACTION_NO_DOUBLE, 1, 0,
                     &analysis);
    position.cube.state = BGC_CUBE_STATE_OFFERED;
    position.cube.offered_by = BGC_PLAYER_WHITE;
    expect_status("match cube-64 response bound",
                  bgc_engine_decide_cube(
                      engine, &position, BGC_CUBE_PHASE_RESPOND_TO_OFFER,
                      BGC_PLAYER_BLACK, response_actions, 2, &settings,
                      &analysis, &error),
                  BGC_STATUS_UNSUPPORTED, &error);

    position = starting_position(BGC_PLAYER_WHITE, 0, 0);
    position.cube.value = BGC_MAX_CUBE_VALUE;
    expect_cube_call(engine, "money cube-4096 offer short-circuit", &position,
                     BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                     offer_actions, 2, BGC_CUBE_ACTION_NO_DOUBLE, 1, 0,
                     &analysis);
    position.cube.state = BGC_CUBE_STATE_OFFERED;
    position.cube.offered_by = BGC_PLAYER_WHITE;
    expect_status("money cube-4096 response bound",
                  bgc_engine_decide_cube(
                      engine, &position, BGC_CUBE_PHASE_RESPOND_TO_OFFER,
                      BGC_PLAYER_BLACK, response_actions, 2, &settings,
                      &analysis, &error),
                  BGC_STATUS_UNSUPPORTED, &error);

    position = cube_double_take_position();
    position.match.mode = BGC_MATCH_MODE_MATCH;
    position.match.length = 5;
    position.match.score.white = 4;
    position.match.score.black = 2;
    position.match.crawford = BGC_CRAWFORD_POST;
    expect_cube_call(engine, "post-Crawford leader offer short-circuit",
                     &position, BGC_CUBE_PHASE_CONSIDER_OFFER,
                     BGC_PLAYER_WHITE, offer_actions, 2,
                     BGC_CUBE_ACTION_NO_DOUBLE, 1, 0, &analysis);
    position.cube.state = BGC_CUBE_STATE_OFFERED;
    position.cube.offered_by = BGC_PLAYER_WHITE;
    expect_cube_call(engine, "post-Crawford pending response", &position,
                     BGC_CUBE_PHASE_RESPOND_TO_OFFER, BGC_PLAYER_BLACK,
                     response_actions, 2, BGC_CUBE_ACTION_TAKE, 0, 1,
                     &analysis);

    position = starting_position(BGC_PLAYER_WHITE, 1, 2);
    expect_status("nonempty cube dice rejection",
                  bgc_engine_decide_cube(
                      engine, &position, BGC_CUBE_PHASE_CONSIDER_OFFER,
                      BGC_PLAYER_WHITE, offer_actions, 2, &settings,
                      &analysis, &error),
                  BGC_STATUS_INVALID_POSITION, &error);
    position.dice[0] = 0;
    position.dice[1] = 0;
    expect_status("wrong offer player rejection",
                  bgc_engine_decide_cube(
                      engine, &position, BGC_CUBE_PHASE_CONSIDER_OFFER,
                      BGC_PLAYER_BLACK, offer_actions, 2, &settings,
                      &analysis, &error),
                  BGC_STATUS_INVALID_POSITION, &error);
    expect_status("duplicate cube action rejection",
                  bgc_engine_decide_cube(
                      engine, &position, BGC_CUBE_PHASE_CONSIDER_OFFER,
                      BGC_PLAYER_WHITE, duplicate_actions, 2, &settings,
                      &analysis, &error),
                  BGC_STATUS_INVALID_ARGUMENT, &error);
    expect_status("mixed cube action families rejection",
                  bgc_engine_decide_cube(
                      engine, &position, BGC_CUBE_PHASE_CONSIDER_OFFER,
                      BGC_PLAYER_WHITE, mixed_actions, 2, &settings,
                      &analysis, &error),
                  BGC_STATUS_INVALID_ARGUMENT, &error);

    position.cube.state = BGC_CUBE_STATE_OFFERED;
    position.cube.offered_by = BGC_PLAYER_BLACK;
    expect_status("offerer/on-roll mismatch rejection",
                  bgc_engine_decide_cube(
                      engine, &position, BGC_CUBE_PHASE_RESPOND_TO_OFFER,
                      BGC_PLAYER_WHITE, response_actions, 2, &settings,
                      &analysis, &error),
                  BGC_STATUS_INVALID_POSITION, &error);

    position = starting_position(BGC_PLAYER_WHITE, 0, 0);
    position.match.mode = BGC_MATCH_MODE_MATCH;
    position.match.length = 5;
    position.match.score.white = 4;
    position.match.crawford = BGC_CRAWFORD_GAME;
    position.cube.state = BGC_CUBE_STATE_OFFERED;
    position.cube.offered_by = BGC_PLAYER_WHITE;
    expect_status("Crawford pending offer rejection",
                  bgc_engine_decide_cube(
                      engine, &position, BGC_CUBE_PHASE_RESPOND_TO_OFFER,
                      BGC_PLAYER_BLACK, response_actions, 2, &settings,
                      &analysis, &error),
                  BGC_STATUS_INVALID_POSITION, &error);
}

static void
test_no_database_race_regression(bgc_engine *engine)
{
    const bgc_cube_action actions[] = {
        BGC_CUBE_ACTION_DOUBLE,
        BGC_CUBE_ACTION_NO_DOUBLE,
        BGC_CUBE_ACTION_TOO_GOOD
    };
    bgc_position position = empty_money_position(BGC_PLAYER_WHITE, 0, 0);
    bgc_cube_analysis analysis;

    position.board.points[1].white = 10;
    position.board.borne_off.white = 5;
    position.board.points[5].black = 15;
    if (expect_cube_call(engine, "no-database race fallback", &position,
                         BGC_CUBE_PHASE_CONSIDER_OFFER, BGC_PLAYER_WHITE,
                         actions, 3, BGC_CUBE_ACTION_TOO_GOOD, 2, 1,
                         &analysis) &&
        (!isfinite(analysis.no_double_equity) ||
         !isfinite(analysis.double_take_equity)))
        record_failure("no-database race fallback",
                       "returned non-finite race equities");
}

static void
test_cube_decisions(bgc_engine *engine)
{
    test_cube_goldens(engine);
    test_cube_beavers_and_jacoby(engine);
    test_cube_boundaries_and_validation(engine);
    test_no_database_race_regression(engine);
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
    test_cube_decisions(engine);
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
