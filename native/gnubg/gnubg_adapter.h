/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef GNUBG_CAPSULE_ADAPTER_H
#define GNUBG_CAPSULE_ADAPTER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BGC_POINT_COUNT 24
#define BGC_CHECKERS_PER_PLAYER 15
#define BGC_MAX_TURN_STEPS 4
#define BGC_MAX_CANDIDATES 4096
#define BGC_MAX_CUBE_VALUE 4096
#define BGC_POSITION_ID_LENGTH 14
#define BGC_ERROR_MESSAGE_LENGTH 256

typedef enum {
    BGC_STATUS_OK = 0,
    BGC_STATUS_INVALID_ARGUMENT,
    BGC_STATUS_INVALID_POSITION,
    BGC_STATUS_ILLEGAL_TURN,
    BGC_STATUS_NOT_READY,
    BGC_STATUS_INITIALIZATION_FAILED,
    BGC_STATUS_EVALUATION_FAILED,
    BGC_STATUS_UNSUPPORTED
} bgc_status;

typedef enum {
    BGC_PLAYER_WHITE = 0,
    BGC_PLAYER_BLACK = 1
} bgc_player;

typedef enum {
    BGC_LOCATION_POINT = 0,
    BGC_LOCATION_BAR,
    BGC_LOCATION_BORNE_OFF
} bgc_location_kind;

typedef enum {
    BGC_MATCH_MODE_MONEY = 0,
    BGC_MATCH_MODE_MATCH
} bgc_match_mode;

typedef enum {
    BGC_CRAWFORD_NONE = 0,
    BGC_CRAWFORD_GAME,
    BGC_CRAWFORD_POST
} bgc_crawford_state;

typedef enum {
    BGC_VARIATION_STANDARD = 0
} bgc_variation;

typedef enum {
    BGC_STRENGTH_BEGINNER = 0,
    BGC_STRENGTH_CASUAL,
    BGC_STRENGTH_INTERMEDIATE,
    BGC_STRENGTH_EXPERT,
    BGC_STRENGTH_MAXIMUM
} bgc_strength;

typedef struct {
    uint8_t white;
    uint8_t black;
} bgc_checker_counts;

typedef struct {
    bgc_checker_counts points[BGC_POINT_COUNT];
    bgc_checker_counts bar;
    bgc_checker_counts borne_off;
} bgc_board;

typedef struct {
    int value;
    int owner; /* -1 for centered, otherwise a bgc_player value. */
} bgc_cube;

typedef struct {
    bgc_match_mode mode;
    int length; /* Zero for money play. */
    bgc_checker_counts score;
    bgc_crawford_state crawford;
} bgc_match;

typedef struct {
    bgc_variation variation;
    int jacoby;
    int beavers;
    int raccoons;
    unsigned int automatic_doubles; /* Already reflected in cube.value. */
} bgc_rules;

typedef struct {
    bgc_board board;
    bgc_player player_on_roll;
    unsigned int dice[2];
    bgc_cube cube;
    bgc_match match;
    bgc_rules rules;
} bgc_position;

typedef struct {
    bgc_location_kind kind;
    int point; /* Used only when kind is BGC_LOCATION_POINT. */
} bgc_location;

typedef struct {
    bgc_location from;
    bgc_location to;
    unsigned int die;
    int hit;
} bgc_turn_step;

typedef struct {
    const bgc_turn_step *steps;
    size_t step_count;
} bgc_candidate;

typedef struct {
    bgc_strength strength;
} bgc_settings;

typedef struct {
    float score;
    float cubeless_score;
} bgc_candidate_score;

typedef struct {
    char message[BGC_ERROR_MESSAGE_LENGTH];
} bgc_error;

typedef struct bgc_engine bgc_engine;

/*
 * GNUbg's evaluator lifecycle is process-scoped. The adapter therefore allows
 * one engine instance per process/Worker and intentionally rejects re-init
 * after disposal. A browser integration should terminate and recreate the
 * compute Worker to obtain a fresh runtime.
 */
bgc_status bgc_engine_create(
    const char *weights_path,
    const char *match_equity_path,
    bgc_engine **engine_out,
    bgc_error *error
);

bgc_status bgc_engine_choose_turn(
    bgc_engine *engine,
    const bgc_position *position,
    const bgc_candidate *candidates,
    size_t candidate_count,
    const bgc_settings *settings,
    bgc_candidate_score *scores_out,
    size_t scores_capacity,
    size_t *best_index_out,
    bgc_error *error
);

bgc_status bgc_engine_reset(bgc_engine *engine, bgc_error *error);

void bgc_engine_dispose(bgc_engine *engine);

/* Diagnostic helper used by native mapping fixtures. */
bgc_status bgc_position_id(
    const bgc_position *position,
    char *output,
    size_t output_capacity,
    bgc_error *error
);

const char *bgc_status_name(bgc_status status);

#ifdef __cplusplus
}
#endif

#endif
