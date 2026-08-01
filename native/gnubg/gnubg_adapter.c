/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include "gnubg_adapter.h"

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "eval.h"
#include "matchequity.h"
#include "multithread.h"
#include "positionid.h"

#define BGC_MAX_MATCH_LENGTH 64
#define BGC_MAX_MATCH_CUBE 64

struct bgc_engine {
    int ready;
};

typedef enum {
    BGC_RUNTIME_UNUSED = 0,
    BGC_RUNTIME_ACTIVE,
    BGC_RUNTIME_FINISHED
} bgc_runtime_state;

static bgc_runtime_state runtime_state = BGC_RUNTIME_UNUSED;

static bgc_status
fail(bgc_error *error, bgc_status status, const char *format, ...)
{
    if (error) {
        va_list arguments;
        va_start(arguments, format);
        vsnprintf(error->message, sizeof(error->message), format, arguments);
        va_end(arguments);
    }
    return status;
}

static void
clear_error(bgc_error *error)
{
    if (error)
        error->message[0] = '\0';
}

static int
is_player(const bgc_player player)
{
    return player == BGC_PLAYER_WHITE || player == BGC_PLAYER_BLACK;
}

static int
gnu_point(const bgc_player player, const int absolute_point)
{
    return player == BGC_PLAYER_WHITE ? absolute_point : 23 - absolute_point;
}

static unsigned int
checker_count(const bgc_checker_counts counts, const bgc_player player)
{
    return player == BGC_PLAYER_WHITE ? counts.white : counts.black;
}

static bgc_status
map_board(const bgc_position *position, TanBoard board, bgc_error *error)
{
    unsigned int point;
    unsigned int totals[2] = { 0, 0 };
    int player;

    if (!position)
        return fail(error, BGC_STATUS_INVALID_ARGUMENT, "position is required");
    if (!is_player(position->player_on_roll))
        return fail(error, BGC_STATUS_INVALID_POSITION, "player_on_roll is invalid");

    memset(board, 0, sizeof(TanBoard));

    for (point = 0; point < BGC_POINT_COUNT; point++) {
        const bgc_checker_counts counts = position->board.points[point];

        if (counts.white > BGC_CHECKERS_PER_PLAYER ||
            counts.black > BGC_CHECKERS_PER_PLAYER ||
            (counts.white && counts.black))
            return fail(error, BGC_STATUS_INVALID_POSITION,
                        "absolute point %u has invalid checker counts", point);

        for (player = BGC_PLAYER_WHITE; player <= BGC_PLAYER_BLACK; player++) {
            const bgc_player color = (bgc_player) player;
            const unsigned int count = checker_count(counts, color);
            const int row = color == position->player_on_roll ? 1 : 0;
            board[row][gnu_point(color, (int) point)] = count;
            totals[player] += count;
        }
    }

    for (player = BGC_PLAYER_WHITE; player <= BGC_PLAYER_BLACK; player++) {
        const bgc_player color = (bgc_player) player;
        const unsigned int bar = checker_count(position->board.bar, color);
        const unsigned int borne_off = checker_count(position->board.borne_off, color);
        const int row = color == position->player_on_roll ? 1 : 0;

        if (bar > BGC_CHECKERS_PER_PLAYER || borne_off > BGC_CHECKERS_PER_PLAYER)
            return fail(error, BGC_STATUS_INVALID_POSITION,
                        "%s bar or borne-off count is invalid",
                        color == BGC_PLAYER_WHITE ? "white" : "black");
        if (totals[player] + bar + borne_off != BGC_CHECKERS_PER_PLAYER)
            return fail(error, BGC_STATUS_INVALID_POSITION,
                        "%s checker total is not %d",
                        color == BGC_PLAYER_WHITE ? "white" : "black",
                        BGC_CHECKERS_PER_PLAYER);

        board[row][24] = bar;
    }

    if (!CheckPosition((ConstTanBoard) board))
        return fail(error, BGC_STATUS_INVALID_POSITION,
                    "position is not legal in GNUbg's board model");

    return BGC_STATUS_OK;
}

static bgc_status
validate_position_metadata(const bgc_position *position, bgc_error *error)
{
    const int cube_value = position->cube.value;

    if (position->dice[0] < 1 || position->dice[0] > 6 ||
        position->dice[1] < 1 || position->dice[1] > 6)
        return fail(error, BGC_STATUS_INVALID_POSITION,
                    "checker-play dice must be between 1 and 6");

    if (cube_value < 1 || cube_value > BGC_MAX_CUBE_VALUE ||
        (cube_value & (cube_value - 1)) != 0)
        return fail(error, BGC_STATUS_INVALID_POSITION,
                    "cube value must be a power of two from 1 through %d",
                    BGC_MAX_CUBE_VALUE);
    if (position->cube.owner < -1 || position->cube.owner > 1)
        return fail(error, BGC_STATUS_INVALID_POSITION, "cube owner is invalid");

    if ((position->rules.jacoby != 0 && position->rules.jacoby != 1) ||
        (position->rules.beavers != 0 && position->rules.beavers != 1) ||
        (position->rules.raccoons != 0 && position->rules.raccoons != 1))
        return fail(error, BGC_STATUS_INVALID_POSITION,
                    "Jacoby, beaver, and raccoon flags must be zero or one");
    if (position->rules.automatic_doubles > 16)
        return fail(error, BGC_STATUS_INVALID_POSITION,
                    "automatic doubles must be between 0 and 16");

    if (position->match.mode == BGC_MATCH_MODE_MONEY) {
        if (position->match.length != 0 ||
            position->match.crawford != BGC_CRAWFORD_NONE)
            return fail(error, BGC_STATUS_INVALID_POSITION,
                        "money play cannot have a match length or Crawford state");
    } else if (position->match.mode == BGC_MATCH_MODE_MATCH) {
        if (position->match.length < 1 ||
            position->match.length > BGC_MAX_MATCH_LENGTH ||
            position->match.score.white >= position->match.length ||
            position->match.score.black >= position->match.length)
            return fail(error, BGC_STATUS_INVALID_POSITION,
                        "match length must be 1..%d and both scores must be lower",
                        BGC_MAX_MATCH_LENGTH);
        if ((position->match.crawford == BGC_CRAWFORD_GAME ||
             position->match.length == 1) &&
            (cube_value != 1 || position->cube.owner != -1))
            return fail(error, BGC_STATUS_INVALID_POSITION,
                        "Crawford and one-point games require a centered cube at 1");
        if (position->match.crawford != BGC_CRAWFORD_NONE &&
            (position->match.length <= 1 ||
             (position->match.score.white != position->match.length - 1 &&
              position->match.score.black != position->match.length - 1)))
            return fail(error, BGC_STATUS_INVALID_POSITION,
                        "Crawford and post-Crawford states require a one-away score");
        if (cube_value > BGC_MAX_MATCH_CUBE)
            return fail(error, BGC_STATUS_UNSUPPORTED,
                        "GNUbg match evaluation supports cube values through %d",
                        BGC_MAX_MATCH_CUBE);
    } else {
        return fail(error, BGC_STATUS_INVALID_POSITION, "match mode is invalid");
    }

    if (position->match.crawford < BGC_CRAWFORD_NONE ||
        position->match.crawford > BGC_CRAWFORD_POST)
        return fail(error, BGC_STATUS_INVALID_POSITION, "Crawford state is invalid");

    if (position->rules.variation != BGC_VARIATION_STANDARD)
        return fail(error, BGC_STATUS_UNSUPPORTED,
                    "only standard backgammon is supported");
    if (position->rules.raccoons)
        return fail(error, BGC_STATUS_UNSUPPORTED,
                    "GNUbg's cubeinfo cannot represent raccoon policy");

    return BGC_STATUS_OK;
}

static bgc_status
set_cube_info(const bgc_position *position, cubeinfo *cube, bgc_error *error)
{
    const int score[2] = {
        position->match.score.white,
        position->match.score.black
    };
    const int match_length = position->match.mode == BGC_MATCH_MODE_MATCH
        ? position->match.length : 0;
    const int crawford = position->match.crawford == BGC_CRAWFORD_GAME;

    if (SetCubeInfo(cube,
                    position->cube.value,
                    position->cube.owner,
                    position->player_on_roll,
                    match_length,
                    score,
                    crawford,
                    !!position->rules.jacoby,
                    !!position->rules.beavers,
                    VARIATION_STANDARD) != 0)
        return fail(error, BGC_STATUS_INVALID_POSITION,
                    "GNUbg rejected the match or cube state");

    return BGC_STATUS_OK;
}

static bgc_status
consume_die(unsigned int remaining[4], const unsigned int die,
            bgc_error *error, const size_t candidate_index,
            const size_t step_index)
{
    size_t index;

    if (die < 1 || die > 6)
        return fail(error, BGC_STATUS_ILLEGAL_TURN,
                    "candidate %zu step %zu has an invalid die",
                    candidate_index, step_index);
    for (index = 0; index < 4; index++) {
        if (remaining[index] == die) {
            remaining[index] = 0;
            return BGC_STATUS_OK;
        }
    }
    return fail(error, BGC_STATUS_ILLEGAL_TURN,
                "candidate %zu step %zu consumes an unavailable die",
                candidate_index, step_index);
}

static bgc_status
replay_candidate(const bgc_position *position,
                 const bgc_candidate *candidate,
                 const size_t candidate_index,
                 const TanBoard base_board,
                 positionkey *key_out,
                 bgc_error *error)
{
    TanBoard board;
    unsigned int remaining[4] = {
        position->dice[0],
        position->dice[1],
        position->dice[0] == position->dice[1] ? position->dice[0] : 0,
        position->dice[0] == position->dice[1] ? position->dice[0] : 0
    };
    size_t step_index;

    if (!candidate || !candidate->steps || candidate->step_count < 1 ||
        candidate->step_count > BGC_MAX_TURN_STEPS)
        return fail(error, BGC_STATUS_ILLEGAL_TURN,
                    "candidate %zu has an invalid number of steps",
                    candidate_index);

    memcpy(board, base_board, sizeof(TanBoard));

    for (step_index = 0; step_index < candidate->step_count; step_index++) {
        const bgc_turn_step *step = &candidate->steps[step_index];
        int source;
        int destination;
        int expected_destination;
        int expected_hit;
        bgc_status status;

        status = consume_die(remaining, step->die, error,
                             candidate_index, step_index);
        if (status != BGC_STATUS_OK)
            return status;

        if (step->from.kind == BGC_LOCATION_BAR) {
            source = 24;
        } else if (step->from.kind == BGC_LOCATION_POINT &&
                   step->from.point >= 0 && step->from.point < BGC_POINT_COUNT) {
            source = gnu_point(position->player_on_roll, step->from.point);
        } else {
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "candidate %zu step %zu has an invalid source",
                        candidate_index, step_index);
        }

        if (source != 24 && board[1][24] != 0)
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "candidate %zu step %zu moves a point checker while on the bar",
                        candidate_index, step_index);
        if (board[1][source] == 0)
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "candidate %zu step %zu moves an empty source",
                        candidate_index, step_index);

        expected_destination = source - (int) step->die;
        if (step->to.kind == BGC_LOCATION_POINT &&
            step->to.point >= 0 && step->to.point < BGC_POINT_COUNT) {
            destination = gnu_point(position->player_on_roll, step->to.point);
            if (expected_destination < 0 || destination != expected_destination)
                return fail(error, BGC_STATUS_ILLEGAL_TURN,
                            "candidate %zu step %zu destination does not match its die",
                            candidate_index, step_index);
        } else if (step->to.kind == BGC_LOCATION_BORNE_OFF) {
            destination = -1;
            if (expected_destination >= 0)
                return fail(error, BGC_STATUS_ILLEGAL_TURN,
                            "candidate %zu step %zu bears off before reaching home",
                            candidate_index, step_index);
        } else {
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "candidate %zu step %zu has an invalid destination",
                        candidate_index, step_index);
        }

        if (step->hit != 0 && step->hit != 1)
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "candidate %zu step %zu hit flag must be zero or one",
                        candidate_index, step_index);
        expected_hit = expected_destination >= 0 &&
            board[0][23 - expected_destination] == 1;
        if (step->hit != expected_hit)
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "candidate %zu step %zu has an incorrect hit flag",
                        candidate_index, step_index);
        if (expected_destination >= 0 &&
            board[0][23 - expected_destination] > 1)
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "candidate %zu step %zu lands on a blocked point",
                        candidate_index, step_index);

        if (ApplySubMove(board, source, (int) step->die, TRUE) != 0)
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "GNUbg rejected candidate %zu step %zu",
                        candidate_index, step_index);
    }

    PositionKey((ConstTanBoard) board, key_out);
    return BGC_STATUS_OK;
}

static int
find_generated_move(const movelist *moves, const positionkey key)
{
    unsigned int index;
    for (index = 0; index < moves->cMoves; index++) {
        if (EqualKeys(moves->amMoves[index].key, key))
            return (int) index;
    }
    return -1;
}

static bgc_status
evaluation_context(const bgc_settings *settings,
                   evalcontext *context,
                   bgc_error *error)
{
    int setting_index;

    if (!settings)
        return fail(error, BGC_STATUS_INVALID_ARGUMENT, "settings are required");

    switch (settings->strength) {
    case BGC_STRENGTH_BEGINNER:
        setting_index = SETTINGS_BEGINNER;
        break;
    case BGC_STRENGTH_CASUAL:
        setting_index = SETTINGS_NOVICE;
        break;
    case BGC_STRENGTH_INTERMEDIATE:
        setting_index = SETTINGS_INTERMEDIATE;
        break;
    case BGC_STRENGTH_EXPERT:
        setting_index = SETTINGS_EXPERT;
        break;
    case BGC_STRENGTH_MAXIMUM:
        /* Two-ply world-class is the native checkpoint maximum. */
        setting_index = SETTINGS_WORLDCLASS;
        break;
    default:
        return fail(error, BGC_STATUS_INVALID_ARGUMENT, "strength is invalid");
    }

    *context = aecSettings[setting_index];
    return BGC_STATUS_OK;
}

static int
file_is_readable(const char *path)
{
    FILE *file;
    if (!path || !path[0])
        return 0;
    file = fopen(path, "rb");
    if (!file)
        return 0;
    fclose(file);
    return 1;
}

bgc_status
bgc_engine_create(const char *weights_path,
                  const char *match_equity_path,
                  bgc_engine **engine_out,
                  bgc_error *error)
{
    bgc_engine *engine;

    clear_error(error);
    if (!engine_out)
        return fail(error, BGC_STATUS_INVALID_ARGUMENT, "engine_out is required");
    *engine_out = NULL;

    if (runtime_state != BGC_RUNTIME_UNUSED)
        return fail(error, BGC_STATUS_INITIALIZATION_FAILED,
                    "GNUbg may be initialized only once per process");
    if (!file_is_readable(weights_path))
        return fail(error, BGC_STATUS_INITIALIZATION_FAILED,
                    "GNUbg weights file is not readable");
    if (!file_is_readable(match_equity_path))
        return fail(error, BGC_STATUS_INITIALIZATION_FAILED,
                    "GNUbg match-equity file is not readable");

    engine = calloc(1, sizeof(*engine));
    if (!engine)
        return fail(error, BGC_STATUS_INITIALIZATION_FAILED,
                    "could not allocate the GNUbg adapter");

    InitMatchEquity(match_equity_path);
    EvalInitialise((char *) weights_path, NULL, TRUE, NULL);
    MT_InitThreads();

    engine->ready = 1;
    runtime_state = BGC_RUNTIME_ACTIVE;
    *engine_out = engine;
    return BGC_STATUS_OK;
}

bgc_status
bgc_engine_choose_turn(bgc_engine *engine,
                       const bgc_position *position,
                       const bgc_candidate *candidates,
                       const size_t candidate_count,
                       const bgc_settings *settings,
                       bgc_candidate_score *scores_out,
                       const size_t scores_capacity,
                       size_t *best_index_out,
                       bgc_error *error)
{
    TanBoard board;
    movelist generated;
    cubeinfo cube;
    evalcontext context;
    size_t candidate_index;
    size_t best_index = 0;
    float best_score = -INFINITY;
    float best_cubeless = -INFINITY;
    bgc_status status;
    positionkey *candidate_keys;

    clear_error(error);
    if (!engine || !engine->ready || runtime_state != BGC_RUNTIME_ACTIVE)
        return fail(error, BGC_STATUS_NOT_READY, "GNUbg engine is not ready");
    if (!position || !candidates || !scores_out || !best_index_out)
        return fail(error, BGC_STATUS_INVALID_ARGUMENT,
                    "position, candidates, score output, and best index are required");
    if (candidate_count < 1 || candidate_count > BGC_MAX_CANDIDATES)
        return fail(error, BGC_STATUS_INVALID_ARGUMENT,
                    "candidate count must be between 1 and %d", BGC_MAX_CANDIDATES);
    if (scores_capacity < candidate_count)
        return fail(error, BGC_STATUS_INVALID_ARGUMENT,
                    "score output capacity is smaller than candidate count");

    status = validate_position_metadata(position, error);
    if (status != BGC_STATUS_OK)
        return status;
    status = map_board(position, board, error);
    if (status != BGC_STATUS_OK)
        return status;
    status = set_cube_info(position, &cube, error);
    if (status != BGC_STATUS_OK)
        return status;
    status = evaluation_context(settings, &context, error);
    if (status != BGC_STATUS_OK)
        return status;

    memset(&generated, 0, sizeof(generated));
    GenerateMoves(&generated, (ConstTanBoard) board,
                  (int) position->dice[0], (int) position->dice[1], FALSE);
    if (generated.cMoves == 0)
        return fail(error, BGC_STATUS_ILLEGAL_TURN,
                    "GNUbg found no playable checker turn");

    candidate_keys = calloc(candidate_count, sizeof(*candidate_keys));
    if (!candidate_keys)
        return fail(error, BGC_STATUS_EVALUATION_FAILED,
                    "could not allocate candidate position keys");

    /*
     * GenerateMoves and recursive ScoreMove calls share GNUbg's thread-local
     * move buffer. Resolve and copy every legal key before scoring anything,
     * because a one-ply-or-deeper score overwrites that generated move list.
     */
    for (candidate_index = 0; candidate_index < candidate_count; candidate_index++) {
        status = replay_candidate(position, &candidates[candidate_index],
                                  candidate_index, (ConstTanBoard) board,
                                  &candidate_keys[candidate_index], error);
        if (status != BGC_STATUS_OK) {
            free(candidate_keys);
            return status;
        }

        if (find_generated_move(&generated, candidate_keys[candidate_index]) < 0) {
            free(candidate_keys);
            return fail(error, BGC_STATUS_ILLEGAL_TURN,
                        "candidate %zu is not a complete legal GNUbg turn",
                        candidate_index);
        }
    }

    for (candidate_index = 0; candidate_index < candidate_count; candidate_index++) {
        move scored_move;
        memset(&scored_move, 0, sizeof(scored_move));
        scored_move.key = candidate_keys[candidate_index];

        if (ScoreMove(NULL, &scored_move, &cube, &context, context.nPlies) != 0 ||
            !isfinite(scored_move.rScore) || !isfinite(scored_move.rScore2)) {
            free(candidate_keys);
            return fail(error, BGC_STATUS_EVALUATION_FAILED,
                        "GNUbg could not score candidate %zu", candidate_index);
        }

        scores_out[candidate_index].score = scored_move.rScore;
        scores_out[candidate_index].cubeless_score = scored_move.rScore2;

        if (candidate_index == 0 || scored_move.rScore > best_score ||
            (scored_move.rScore == best_score &&
             scored_move.rScore2 > best_cubeless)) {
            best_index = candidate_index;
            best_score = scored_move.rScore;
            best_cubeless = scored_move.rScore2;
        }
    }

    free(candidate_keys);
    *best_index_out = best_index;
    return BGC_STATUS_OK;
}

bgc_status
bgc_engine_reset(bgc_engine *engine, bgc_error *error)
{
    clear_error(error);
    if (!engine || !engine->ready || runtime_state != BGC_RUNTIME_ACTIVE)
        return fail(error, BGC_STATUS_NOT_READY, "GNUbg engine is not ready");
    fInterrupt = FALSE;
    EvalCacheFlush();
    return BGC_STATUS_OK;
}

void
bgc_engine_dispose(bgc_engine *engine)
{
    if (!engine)
        return;
    if (engine->ready && runtime_state == BGC_RUNTIME_ACTIVE) {
        engine->ready = 0;
        MT_Close();
        EvalShutdown();
        runtime_state = BGC_RUNTIME_FINISHED;
    }
    free(engine);
}

bgc_status
bgc_position_id(const bgc_position *position,
                char *output,
                const size_t output_capacity,
                bgc_error *error)
{
    TanBoard board;
    const char *position_id;
    bgc_status status;

    clear_error(error);
    if (!position || !output)
        return fail(error, BGC_STATUS_INVALID_ARGUMENT,
                    "position and output are required");
    if (output_capacity < BGC_POSITION_ID_LENGTH + 1)
        return fail(error, BGC_STATUS_INVALID_ARGUMENT,
                    "Position ID output capacity must be at least %d",
                    BGC_POSITION_ID_LENGTH + 1);
    output[0] = '\0';

    status = map_board(position, board, error);
    if (status != BGC_STATUS_OK)
        return status;
    position_id = PositionID((ConstTanBoard) board);
    if (!position_id || strlen(position_id) != BGC_POSITION_ID_LENGTH)
        return fail(error, BGC_STATUS_INVALID_POSITION,
                    "GNUbg could not encode the position");
    memcpy(output, position_id, BGC_POSITION_ID_LENGTH + 1);
    return BGC_STATUS_OK;
}

const char *
bgc_status_name(const bgc_status status)
{
    switch (status) {
    case BGC_STATUS_OK:
        return "ok";
    case BGC_STATUS_INVALID_ARGUMENT:
        return "invalid-argument";
    case BGC_STATUS_INVALID_POSITION:
        return "invalid-position";
    case BGC_STATUS_ILLEGAL_TURN:
        return "illegal-turn";
    case BGC_STATUS_NOT_READY:
        return "not-ready";
    case BGC_STATUS_INITIALIZATION_FAILED:
        return "initialization-failed";
    case BGC_STATUS_EVALUATION_FAILED:
        return "evaluation-failed";
    case BGC_STATUS_UNSUPPORTED:
        return "unsupported";
    default:
        return "unknown";
    }
}
