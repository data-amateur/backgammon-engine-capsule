/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_adapter.h"
#include "gnubg_wasm_abi.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define TEST_ARENA_SIZE UINT32_C(4096)

#define INIT_REQUEST_OFFSET UINT32_C(0)
#define INIT_WEIGHTS_OFFSET UINT32_C(64)
#define INIT_MATCH_EQUITY_OFFSET UINT32_C(128)
#define INIT_ERROR_OFFSET UINT32_C(512)

#define CHOOSE_REQUEST_OFFSET UINT32_C(0)
#define CHOOSE_CANDIDATES_OFFSET UINT32_C(256)
#define CHOOSE_SCORES_OFFSET UINT32_C(512)
#define CHOOSE_RESULT_OFFSET UINT32_C(768)
#define CHOOSE_ERROR_OFFSET UINT32_C(1024)

#define CUBE_REQUEST_OFFSET UINT32_C(0)
#define CUBE_RESULT_OFFSET UINT32_C(256)
#define CUBE_ERROR_OFFSET UINT32_C(512)

#define CHECK(condition)                                                     \
    do {                                                                     \
        if (!(condition)) {                                                  \
            fprintf(stderr, "%s:%d: check failed: %s\n",                  \
                    __FILE__, __LINE__, #condition);                         \
            return 1;                                                        \
        }                                                                    \
    } while (0)

static const char EXPECTED_WEIGHTS_PATH[] = "fixtures/weights.bd";
static const char EXPECTED_MATCH_EQUITY_PATH[] = "fixtures/met.xml";

struct bgc_engine {
    uint32_t marker;
};

typedef enum {
    FAKE_ADAPTER_SUCCEEDS = 0,
    FAKE_ADAPTER_INIT_FAILS,
    FAKE_ADAPTER_INIT_RETURNS_NULL,
    FAKE_ADAPTER_CHOOSE_FAILS,
    FAKE_ADAPTER_CHOOSE_BAD_INDEX,
    FAKE_ADAPTER_CHOOSE_NAN_SCORE,
    FAKE_ADAPTER_CUBE_FAILS,
    FAKE_ADAPTER_CUBE_BAD_INDEX,
    FAKE_ADAPTER_CUBE_ACTION_MISMATCH,
    FAKE_ADAPTER_CUBE_NAN_EQUITY,
    FAKE_ADAPTER_RESET_FAILS
} fake_adapter_mode;

static struct bgc_engine fake_engine = {UINT32_C(0x454e474e)};
static fake_adapter_mode fake_mode = FAKE_ADAPTER_SUCCEEDS;
static unsigned int fake_create_calls;
static unsigned int fake_choose_calls;
static unsigned int fake_cube_calls;
static unsigned int fake_reset_calls;
static unsigned int fake_dispose_calls;
static unsigned int fake_assertion_failures;
static bgc_strength fake_expected_choose_strength = BGC_STRENGTH_EXPERT;
static bgc_strength fake_expected_cube_strength = BGC_STRENGTH_MAXIMUM;
static char fake_weights_path[BGC_WASM_MAX_PATH_BYTES + 1u];
static char fake_match_equity_path[BGC_WASM_MAX_PATH_BYTES + 1u];

static void
fake_expect(const int condition, const char *description)
{
    if (!condition) {
        fprintf(stderr, "fake adapter check failed: %s\n", description);
        fake_assertion_failures++;
    }
}

static void
set_fake_error(bgc_error *error, const char *message)
{
    if (!error)
        return;
    memset(error, 0, sizeof(*error));
    (void) snprintf(error->message, sizeof(error->message), "%s", message);
}

static void
clear_fake_error(bgc_error *error)
{
    if (error)
        memset(error, 0, sizeof(*error));
}

bgc_status
bgc_engine_create(const char *weights_path,
                  const char *match_equity_path,
                  bgc_engine **engine_out,
                  bgc_error *error)
{
    fake_create_calls++;
    fake_expect(weights_path != NULL, "weights path is required");
    fake_expect(match_equity_path != NULL, "match-equity path is required");
    fake_expect(engine_out != NULL, "engine output is required");

    if (weights_path) {
        (void) snprintf(fake_weights_path, sizeof(fake_weights_path),
                        "%s", weights_path);
    }
    if (match_equity_path) {
        (void) snprintf(fake_match_equity_path,
                        sizeof(fake_match_equity_path), "%s",
                        match_equity_path);
    }

    if (fake_mode == FAKE_ADAPTER_INIT_FAILS) {
        if (engine_out)
            *engine_out = NULL;
        set_fake_error(error, "fake init failed");
        return BGC_STATUS_INITIALIZATION_FAILED;
    }

    if (fake_mode == FAKE_ADAPTER_INIT_RETURNS_NULL) {
        if (engine_out)
            *engine_out = NULL;
        clear_fake_error(error);
        return BGC_STATUS_OK;
    }

    if (engine_out)
        *engine_out = &fake_engine;
    clear_fake_error(error);
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
    fake_choose_calls++;
    fake_expect(engine == &fake_engine, "choose received the fake engine");
    fake_expect(position != NULL, "choose position is required");
    fake_expect(candidates != NULL, "choose candidates are required");
    fake_expect(candidate_count == 2u, "choose candidate count is preserved");
    fake_expect(settings != NULL, "choose settings are required");
    fake_expect(scores_out != NULL, "choose score output is required");
    fake_expect(scores_capacity == 2u, "choose score capacity is preserved");
    fake_expect(best_index_out != NULL, "choose index output is required");

    if (position) {
        fake_expect(position->board.points[0].white == 15u,
                    "white checker counts are converted");
        fake_expect(position->board.points[23].black == 15u,
                    "black checker counts are converted");
        fake_expect(position->player_on_roll == BGC_PLAYER_WHITE,
                    "player on roll is converted");
        fake_expect(position->dice[0] == 3u && position->dice[1] == 5u,
                    "checker-play dice are converted");
        fake_expect(position->cube.value == 2 && position->cube.owner == -1,
                    "cube values are converted");
        fake_expect(position->match.mode == BGC_MATCH_MODE_MONEY &&
                    position->match.length == 0,
                    "money match metadata is converted");
        fake_expect(position->rules.jacoby == 1 &&
                    position->rules.beavers == 1,
                    "rule booleans are converted");
        fake_expect(position->rules.automatic_doubles == 2u,
                    "automatic doubles are converted");
    }

    if (candidates && candidate_count == 2u) {
        fake_expect(candidates[0].step_count == 1u &&
                    candidates[0].steps != NULL,
                    "first candidate owns one converted step");
        fake_expect(candidates[1].step_count == 1u &&
                    candidates[1].steps != NULL,
                    "second candidate owns one converted step");
        if (candidates[0].steps) {
            fake_expect(candidates[0].steps[0].from.kind ==
                            BGC_LOCATION_POINT &&
                        candidates[0].steps[0].from.point == 0 &&
                        candidates[0].steps[0].to.kind ==
                            BGC_LOCATION_POINT &&
                        candidates[0].steps[0].to.point == 3 &&
                        candidates[0].steps[0].die == 3u &&
                        candidates[0].steps[0].hit == 0,
                        "first candidate step is converted exactly");
        }
        if (candidates[1].steps) {
            fake_expect(candidates[1].steps[0].from.kind ==
                            BGC_LOCATION_POINT &&
                        candidates[1].steps[0].from.point == 0 &&
                        candidates[1].steps[0].to.kind ==
                            BGC_LOCATION_POINT &&
                        candidates[1].steps[0].to.point == 5 &&
                        candidates[1].steps[0].die == 5u &&
                        candidates[1].steps[0].hit == 0,
                        "second candidate step is converted exactly");
        }
    }
    if (settings) {
        fake_expect(settings->strength ==
                        fake_expected_choose_strength,
                    "checker strength is converted");
    }

    if (fake_mode == FAKE_ADAPTER_CHOOSE_FAILS) {
        if (scores_out && scores_capacity > 0u) {
            scores_out[0].score = 99.0f;
            scores_out[0].cubeless_score = -99.0f;
        }
        if (best_index_out)
            *best_index_out = 99u;
        set_fake_error(error, "fake choose failed");
        return BGC_STATUS_EVALUATION_FAILED;
    }

    if (scores_out && scores_capacity >= 2u) {
        scores_out[0].score = 1.25f;
        scores_out[0].cubeless_score = -0.5f;
        scores_out[1].score = 2.5f;
        scores_out[1].cubeless_score = 1.75f;
    }
    if (best_index_out)
        *best_index_out = 1u;
    if (fake_mode == FAKE_ADAPTER_CHOOSE_BAD_INDEX && best_index_out)
        *best_index_out = candidate_count;
    if (fake_mode == FAKE_ADAPTER_CHOOSE_NAN_SCORE &&
        scores_out && scores_capacity > 0u)
        scores_out[0].score = NAN;
    clear_fake_error(error);
    return BGC_STATUS_OK;
}

bgc_status
bgc_engine_decide_cube(bgc_engine *engine,
                       const bgc_position *position,
                       const bgc_cube_decision_phase phase,
                       const bgc_player engine_player,
                       const bgc_cube_action *legal_actions,
                       const size_t legal_action_count,
                       const bgc_settings *settings,
                       bgc_cube_analysis *analysis_out,
                       bgc_error *error)
{
    fake_cube_calls++;
    fake_expect(engine == &fake_engine, "cube received the fake engine");
    fake_expect(position != NULL, "cube position is required");
    fake_expect(phase == BGC_CUBE_PHASE_RESPOND_TO_OFFER,
                "cube phase is converted");
    fake_expect(engine_player == BGC_PLAYER_BLACK,
                "cube engine player is converted");
    fake_expect(legal_actions != NULL, "cube legal actions are required");
    fake_expect(legal_action_count == 3u,
                "cube legal-action count is preserved");
    fake_expect(settings != NULL, "cube settings are required");
    fake_expect(analysis_out != NULL, "cube analysis output is required");

    if (position) {
        fake_expect(position->dice[0] == 0u && position->dice[1] == 0u,
                    "cube dice tuple is empty");
        fake_expect(position->cube.state == BGC_CUBE_STATE_OFFERED &&
                    position->cube.owner == BGC_PLAYER_WHITE &&
                    position->cube.offered_by == BGC_PLAYER_WHITE,
                    "offered cube metadata is converted");
        fake_expect(position->rules.automatic_doubles == 2u,
                    "cube automatic doubles are converted");
    }
    if (legal_actions && legal_action_count == 3u) {
        fake_expect(legal_actions[0] == BGC_CUBE_ACTION_TAKE &&
                    legal_actions[1] == BGC_CUBE_ACTION_PASS &&
                    legal_actions[2] == BGC_CUBE_ACTION_BEAVER,
                    "cube legal actions retain order");
    }
    if (settings) {
        fake_expect(settings->strength ==
                        fake_expected_cube_strength,
                    "cube strength is converted");
    }

    if (fake_mode == FAKE_ADAPTER_CUBE_FAILS) {
        if (analysis_out) {
            memset(analysis_out, 0x5a, sizeof(*analysis_out));
            analysis_out->decision = BGC_CUBE_ACTION_DOUBLE;
            analysis_out->selected_index = 99u;
        }
        set_fake_error(error, "fake cube failed");
        return BGC_STATUS_EVALUATION_FAILED;
    }

    if (analysis_out) {
        memset(analysis_out, 0, sizeof(*analysis_out));
        analysis_out->decision = BGC_CUBE_ACTION_PASS;
        analysis_out->selected_index = 1u;
        analysis_out->evaluated = 1;
        analysis_out->selected_action_equity = 0.75f;
        analysis_out->preoffer_optimal_equity = 0.5f;
        analysis_out->no_double_equity = 0.25f;
        analysis_out->double_take_equity = -0.125f;
        analysis_out->double_pass_equity = 1.0f;
        if (fake_mode == FAKE_ADAPTER_CUBE_BAD_INDEX)
            analysis_out->selected_index =
                (uint32_t) legal_action_count;
        if (fake_mode == FAKE_ADAPTER_CUBE_ACTION_MISMATCH)
            analysis_out->decision = BGC_CUBE_ACTION_TAKE;
        if (fake_mode == FAKE_ADAPTER_CUBE_NAN_EQUITY)
            analysis_out->selected_action_equity = NAN;
    }
    clear_fake_error(error);
    return BGC_STATUS_OK;
}

bgc_status
bgc_engine_reset(bgc_engine *engine, bgc_error *error)
{
    fake_reset_calls++;
    fake_expect(engine == &fake_engine, "reset received the fake engine");
    if (fake_mode == FAKE_ADAPTER_RESET_FAILS) {
        set_fake_error(error, "fake reset failed");
        return BGC_STATUS_EVALUATION_FAILED;
    }
    clear_fake_error(error);
    return BGC_STATUS_OK;
}

void
bgc_engine_dispose(bgc_engine *engine)
{
    fake_dispose_calls++;
    fake_expect(engine == &fake_engine, "dispose received the fake engine");
}

bgc_status
bgc_position_id(const bgc_position *position,
                char *output,
                const size_t output_capacity,
                bgc_error *error)
{
    (void) position;
    if (!output || output_capacity < BGC_POSITION_ID_LENGTH + 1u) {
        set_fake_error(error, "fake position-id output is too small");
        return BGC_STATUS_INVALID_ARGUMENT;
    }
    (void) snprintf(output, output_capacity, "FAKEPOSITION1");
    clear_fake_error(error);
    return BGC_STATUS_OK;
}

const char *
bgc_status_name(const bgc_status status)
{
    switch (status) {
    case BGC_STATUS_OK:
        return "ok";
    case BGC_STATUS_INVALID_ARGUMENT:
        return "invalid_argument";
    case BGC_STATUS_INVALID_POSITION:
        return "invalid_position";
    case BGC_STATUS_ILLEGAL_TURN:
        return "illegal_turn";
    case BGC_STATUS_NOT_READY:
        return "not_ready";
    case BGC_STATUS_INITIALIZATION_FAILED:
        return "initialization_failed";
    case BGC_STATUS_EVALUATION_FAILED:
        return "evaluation_failed";
    case BGC_STATUS_UNSUPPORTED:
        return "unsupported";
    }
    return "unknown";
}

static int
bytes_are_zero(const void *memory, const size_t byte_count)
{
    const uint8_t *bytes = memory;
    size_t index;

    for (index = 0; index < byte_count; index++) {
        if (bytes[index] != 0u)
            return 0;
    }
    return 1;
}

static int
bytes_have_value(const void *memory,
                 const size_t byte_count,
                 const uint8_t value)
{
    const uint8_t *bytes = memory;
    size_t index;

    for (index = 0u; index < byte_count; index++) {
        if (bytes[index] != value)
            return 0;
    }
    return 1;
}

static int
error_has_zero_tail(const bgc_wasm_error_v1 *error, const char *message)
{
    const size_t message_length = strlen(message);

    if (message_length >= sizeof(error->message) ||
        memcmp(error->message, message, message_length + 1u) != 0)
        return 0;
    return bytes_are_zero(error->message + message_length + 1u,
                          sizeof(error->message) - message_length - 1u);
}

static void
fill_position(bgc_wasm_position_v1 *position, const int checker_play)
{
    memset(position, 0, sizeof(*position));
    position->board.points[0].white = 15u;
    position->board.points[23].black = 15u;
    position->player_on_roll = BGC_WASM_PLAYER_WHITE;
    position->dice[0] = checker_play ? 3u : 0u;
    position->dice[1] = checker_play ? 5u : 0u;
    position->cube.value = 2;
    position->cube.owner = checker_play
        ? BGC_WASM_PLAYER_NONE : (int32_t) BGC_WASM_PLAYER_WHITE;
    position->cube.state = checker_play
        ? BGC_WASM_CUBE_STATE_AVAILABLE : BGC_WASM_CUBE_STATE_OFFERED;
    position->cube.offered_by = checker_play
        ? BGC_WASM_PLAYER_NONE : (int32_t) BGC_WASM_PLAYER_WHITE;
    position->match.mode = BGC_WASM_MATCH_MODE_MONEY;
    position->match.length = 0;
    position->match.crawford = BGC_WASM_CRAWFORD_NONE;
    position->rules.variation = BGC_WASM_VARIATION_STANDARD;
    position->rules.jacoby = 1u;
    position->rules.beavers = 1u;
    position->rules.automatic_doubles = 2u;
}

static void
prepare_init(uint8_t *arena, const int malformed_reserved)
{
    bgc_wasm_init_request_v1 *request;

    memset(arena, 0, TEST_ARENA_SIZE);
    request = (bgc_wasm_init_request_v1 *)
        (void *) (arena + INIT_REQUEST_OFFSET);
    request->header.abi_version = BGC_WASM_ABI_VERSION;
    request->header.byte_size = (uint32_t) sizeof(*request);
    request->weights_path_offset = INIT_WEIGHTS_OFFSET;
    request->weights_path_length =
        (uint32_t) (sizeof(EXPECTED_WEIGHTS_PATH) - 1u);
    request->match_equity_path_offset = INIT_MATCH_EQUITY_OFFSET;
    request->match_equity_path_length =
        (uint32_t) (sizeof(EXPECTED_MATCH_EQUITY_PATH) - 1u);
    request->reserved[0] = malformed_reserved ? 1u : 0u;
    memcpy(arena + INIT_WEIGHTS_OFFSET, EXPECTED_WEIGHTS_PATH,
           sizeof(EXPECTED_WEIGHTS_PATH) - 1u);
    memcpy(arena + INIT_MATCH_EQUITY_OFFSET, EXPECTED_MATCH_EQUITY_PATH,
           sizeof(EXPECTED_MATCH_EQUITY_PATH) - 1u);
    memset(arena + INIT_ERROR_OFFSET, 0xa5,
           sizeof(bgc_wasm_error_v1));
}

static int32_t
initialize_successfully(uint8_t *arena)
{
    int32_t status;

    prepare_init(arena, 0);
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    if (status == BGC_WASM_STATUS_OK) {
        fake_expect(strcmp(fake_weights_path, EXPECTED_WEIGHTS_PATH) == 0,
                    "init preserves the exact weights path");
        fake_expect(strcmp(fake_match_equity_path,
                           EXPECTED_MATCH_EQUITY_PATH) == 0,
                    "init preserves the exact match-equity path");
    }
    return status;
}

static void
prepare_choose(uint8_t *arena)
{
    bgc_wasm_choose_request_v1 *request;
    bgc_wasm_candidate_v1 *candidates;

    memset(arena, 0, TEST_ARENA_SIZE);
    request = (bgc_wasm_choose_request_v1 *)
        (void *) (arena + CHOOSE_REQUEST_OFFSET);
    candidates = (bgc_wasm_candidate_v1 *)
        (void *) (arena + CHOOSE_CANDIDATES_OFFSET);

    request->header.abi_version = BGC_WASM_ABI_VERSION;
    request->header.byte_size = (uint32_t) sizeof(*request);
    fill_position(&request->position, 1);
    request->candidates_offset = CHOOSE_CANDIDATES_OFFSET;
    request->candidate_count = 2u;
    request->scores_offset = CHOOSE_SCORES_OFFSET;
    request->scores_capacity = 2u;
    request->settings.strength = BGC_WASM_STRENGTH_EXPERT;

    candidates[0].step_count = 1u;
    candidates[0].steps[0].from.kind = BGC_WASM_LOCATION_POINT;
    candidates[0].steps[0].from.point = 0;
    candidates[0].steps[0].to.kind = BGC_WASM_LOCATION_POINT;
    candidates[0].steps[0].to.point = 3;
    candidates[0].steps[0].die = 3u;
    candidates[0].steps[0].hit = 0u;

    candidates[1].step_count = 1u;
    candidates[1].steps[0].from.kind = BGC_WASM_LOCATION_POINT;
    candidates[1].steps[0].from.point = 0;
    candidates[1].steps[0].to.kind = BGC_WASM_LOCATION_POINT;
    candidates[1].steps[0].to.point = 5;
    candidates[1].steps[0].die = 5u;
    candidates[1].steps[0].hit = 0u;

    memset(arena + CHOOSE_SCORES_OFFSET, 0xa5,
           2u * sizeof(bgc_wasm_candidate_score_v1));
    memset(arena + CHOOSE_RESULT_OFFSET, 0xa5,
           sizeof(bgc_wasm_choose_result_v1));
    memset(arena + CHOOSE_ERROR_OFFSET, 0xa5,
           sizeof(bgc_wasm_error_v1));
}

static void
prepare_cube(uint8_t *arena)
{
    bgc_wasm_cube_request_v1 *request;

    memset(arena, 0, TEST_ARENA_SIZE);
    request = (bgc_wasm_cube_request_v1 *)
        (void *) (arena + CUBE_REQUEST_OFFSET);
    request->header.abi_version = BGC_WASM_ABI_VERSION;
    request->header.byte_size = (uint32_t) sizeof(*request);
    fill_position(&request->position, 0);
    request->phase = BGC_WASM_CUBE_PHASE_RESPOND_TO_OFFER;
    request->engine_player = BGC_WASM_PLAYER_BLACK;
    request->legal_action_count = 3u;
    request->legal_actions[0] = BGC_WASM_CUBE_ACTION_TAKE;
    request->legal_actions[1] = BGC_WASM_CUBE_ACTION_PASS;
    request->legal_actions[2] = BGC_WASM_CUBE_ACTION_BEAVER;
    request->settings.strength = BGC_WASM_STRENGTH_MAXIMUM;

    memset(arena + CUBE_RESULT_OFFSET, 0xa5,
           sizeof(bgc_wasm_cube_result_v1));
    memset(arena + CUBE_ERROR_OFFSET, 0xa5,
           sizeof(bgc_wasm_error_v1));
}

static int
check_choose_success(const uint8_t *arena)
{
    const bgc_wasm_choose_result_v1 *result =
        (const bgc_wasm_choose_result_v1 *)
            (const void *) (arena + CHOOSE_RESULT_OFFSET);
    const bgc_wasm_candidate_score_v1 *scores =
        (const bgc_wasm_candidate_score_v1 *)
            (const void *) (arena + CHOOSE_SCORES_OFFSET);
    const bgc_wasm_error_v1 *error =
        (const bgc_wasm_error_v1 *)
            (const void *) (arena + CHOOSE_ERROR_OFFSET);

    CHECK(result->header.abi_version == BGC_WASM_ABI_VERSION);
    CHECK(result->header.byte_size == sizeof(*result));
    CHECK(result->selected_index == 1u);
    CHECK(result->score_count == 2u);
    CHECK(bytes_are_zero(result->reserved, sizeof(result->reserved)));
    CHECK(scores[0].score == 1.25f);
    CHECK(scores[0].cubeless_score == -0.5f);
    CHECK(scores[1].score == 2.5f);
    CHECK(scores[1].cubeless_score == 1.75f);
    CHECK(bytes_are_zero(error, sizeof(*error)));
    return 0;
}

static int
check_choose_failure_is_transactional(const uint8_t *arena,
                                      const char *message)
{
    const bgc_wasm_choose_result_v1 *result =
        (const bgc_wasm_choose_result_v1 *)
            (const void *) (arena + CHOOSE_RESULT_OFFSET);
    const bgc_wasm_candidate_score_v1 *scores =
        (const bgc_wasm_candidate_score_v1 *)
            (const void *) (arena + CHOOSE_SCORES_OFFSET);
    const bgc_wasm_error_v1 *error =
        (const bgc_wasm_error_v1 *)
            (const void *) (arena + CHOOSE_ERROR_OFFSET);

    CHECK(result->header.abi_version == BGC_WASM_ABI_VERSION);
    CHECK(result->header.byte_size == sizeof(*result));
    CHECK(result->selected_index == 0u);
    CHECK(result->score_count == 0u);
    CHECK(bytes_are_zero(result->reserved, sizeof(result->reserved)));
    CHECK(bytes_are_zero(scores,
                         2u * sizeof(bgc_wasm_candidate_score_v1)));
    CHECK(error_has_zero_tail(error, message));
    return 0;
}

static int
check_choose_outputs_are_untouched(const uint8_t *arena)
{
    CHECK(bytes_have_value(arena + CHOOSE_SCORES_OFFSET,
                           2u * sizeof(bgc_wasm_candidate_score_v1), 0xa5u));
    CHECK(bytes_have_value(arena + CHOOSE_RESULT_OFFSET,
                           sizeof(bgc_wasm_choose_result_v1), 0xa5u));
    CHECK(bytes_have_value(arena + CHOOSE_ERROR_OFFSET,
                           sizeof(bgc_wasm_error_v1), 0xa5u));
    return 0;
}

static int
check_choose_bad_header_outputs(const uint8_t *arena,
                                const char *message)
{
    const bgc_wasm_choose_result_v1 *result =
        (const bgc_wasm_choose_result_v1 *)
            (const void *) (arena + CHOOSE_RESULT_OFFSET);
    const bgc_wasm_error_v1 *error =
        (const bgc_wasm_error_v1 *)
            (const void *) (arena + CHOOSE_ERROR_OFFSET);

    CHECK(result->header.abi_version == BGC_WASM_ABI_VERSION);
    CHECK(result->header.byte_size == sizeof(*result));
    CHECK(result->selected_index == 0u);
    CHECK(result->score_count == 0u);
    CHECK(bytes_are_zero(result->reserved, sizeof(result->reserved)));
    CHECK(bytes_have_value(arena + CHOOSE_SCORES_OFFSET,
                           2u * sizeof(bgc_wasm_candidate_score_v1), 0xa5u));
    CHECK(error_has_zero_tail(error, message));
    return 0;
}

static int
check_cube_success(const uint8_t *arena)
{
    const bgc_wasm_cube_result_v1 *result =
        (const bgc_wasm_cube_result_v1 *)
            (const void *) (arena + CUBE_RESULT_OFFSET);
    const bgc_wasm_error_v1 *error =
        (const bgc_wasm_error_v1 *)
            (const void *) (arena + CUBE_ERROR_OFFSET);

    CHECK(result->header.abi_version == BGC_WASM_ABI_VERSION);
    CHECK(result->header.byte_size == sizeof(*result));
    CHECK(result->decision == BGC_WASM_CUBE_ACTION_PASS);
    CHECK(result->selected_index == 1u);
    CHECK(result->evaluated == 1u);
    CHECK(result->reserved0 == 0u);
    CHECK(result->selected_action_equity == 0.75f);
    CHECK(result->preoffer_optimal_equity == 0.5f);
    CHECK(result->no_double_equity == 0.25f);
    CHECK(result->double_take_equity == -0.125f);
    CHECK(result->double_pass_equity == 1.0f);
    CHECK(bytes_are_zero(result->reserved, sizeof(result->reserved)));
    CHECK(bytes_are_zero(error, sizeof(*error)));
    return 0;
}

static int
check_cube_failure_is_transactional(const uint8_t *arena,
                                    const char *message)
{
    const bgc_wasm_cube_result_v1 *result =
        (const bgc_wasm_cube_result_v1 *)
            (const void *) (arena + CUBE_RESULT_OFFSET);
    const bgc_wasm_error_v1 *error =
        (const bgc_wasm_error_v1 *)
            (const void *) (arena + CUBE_ERROR_OFFSET);

    CHECK(result->header.abi_version == BGC_WASM_ABI_VERSION);
    CHECK(result->header.byte_size == sizeof(*result));
    CHECK(result->decision == 0u);
    CHECK(result->selected_index == 0u);
    CHECK(result->evaluated == 0u);
    CHECK(result->reserved0 == 0u);
    CHECK(result->selected_action_equity == 0.0f);
    CHECK(result->preoffer_optimal_equity == 0.0f);
    CHECK(result->no_double_equity == 0.0f);
    CHECK(result->double_take_equity == 0.0f);
    CHECK(result->double_pass_equity == 0.0f);
    CHECK(bytes_are_zero(result->reserved, sizeof(result->reserved)));
    CHECK(error_has_zero_tail(error, message));
    return 0;
}

static int
check_cube_outputs_are_untouched(const uint8_t *arena)
{
    CHECK(bytes_have_value(arena + CUBE_RESULT_OFFSET,
                           sizeof(bgc_wasm_cube_result_v1), 0xa5u));
    CHECK(bytes_have_value(arena + CUBE_ERROR_OFFSET,
                           sizeof(bgc_wasm_error_v1), 0xa5u));
    return 0;
}

static int
test_allocation_contract(void)
{
    uint8_t *allocation;

    CHECK(bgc_wasm_alloc(0u) == NULL);
    CHECK(bgc_wasm_alloc(BGC_WASM_MAX_ARENA_BYTES + 1u) == NULL);
    allocation = bgc_wasm_alloc(BGC_WASM_MAX_ARENA_BYTES);
    CHECK(allocation != NULL);
    CHECK(allocation[0] == 0u);
    CHECK(allocation[BGC_WASM_MAX_ARENA_BYTES - 1u] == 0u);
    bgc_wasm_free(allocation);
    bgc_wasm_free(NULL);
    return 0;
}

static int
scenario_lifecycle_success(void)
{
    uint8_t *arena;
    uint8_t snapshot[TEST_ARENA_SIZE];
    bgc_wasm_error_v1 *error;
    int32_t status;

    CHECK(test_allocation_contract() == 0);
    arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    CHECK(arena != NULL);
    CHECK(bytes_are_zero(arena, TEST_ARENA_SIZE));

    /* A structural rejection must not consume the one allowed init attempt. */
    prepare_init(arena, 1);
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(fake_create_calls == 0u);

    CHECK(initialize_successfully(arena) == BGC_WASM_STATUS_OK);
    CHECK(fake_create_calls == 1u);
    error = (bgc_wasm_error_v1 *) (void *) (arena + INIT_ERROR_OFFSET);
    CHECK(bytes_are_zero(error, sizeof(*error)));

    /*
     * Even after initialization is consumed, a duplicate-init call must
     * validate the complete arena layout before reporting lifecycle state.
     */
    prepare_init(arena, 0);
    memcpy(snapshot, arena, sizeof(snapshot));
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_REQUEST_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(memcmp(arena, snapshot, sizeof(snapshot)) == 0);
    CHECK(fake_create_calls == 1u);

    prepare_init(arena, 0);
    memcpy(snapshot, arena, sizeof(snapshot));
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_WEIGHTS_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(memcmp(arena, snapshot, sizeof(snapshot)) == 0);
    CHECK(fake_create_calls == 1u);

    prepare_choose(arena);
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_OK);
    CHECK(fake_choose_calls == 1u);
    CHECK(check_choose_success(arena) == 0);

    memset(arena + CHOOSE_ERROR_OFFSET, 0xa5, sizeof(*error));
    status = bgc_wasm_reset(arena, TEST_ARENA_SIZE, CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_OK);
    CHECK(fake_reset_calls == 1u);
    error = (bgc_wasm_error_v1 *) (void *)
        (arena + CHOOSE_ERROR_OFFSET);
    CHECK(bytes_are_zero(error, sizeof(*error)));

    prepare_cube(arena);
    status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_RESULT_OFFSET,
                                  CUBE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_OK);
    CHECK(fake_cube_calls == 1u);
    CHECK(check_cube_success(arena) == 0);

    prepare_init(arena, 0);
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INITIALIZATION_FAILED);
    CHECK(fake_create_calls == 1u);

    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 1u);
    memset(arena + CHOOSE_ERROR_OFFSET, 0xa5, sizeof(*error));
    status = bgc_wasm_reset(arena, TEST_ARENA_SIZE, CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_NOT_READY);
    CHECK(fake_reset_calls == 1u);
    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 1u);

    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_free(arena);
    return 0;
}

static int
scenario_init_failure_is_terminal(void)
{
    uint8_t *arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    const bgc_wasm_error_v1 *error;
    int32_t status;

    CHECK(arena != NULL);
    fake_mode = FAKE_ADAPTER_INIT_FAILS;
    prepare_init(arena, 0);
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INITIALIZATION_FAILED);
    CHECK(fake_create_calls == 1u);
    error = (const bgc_wasm_error_v1 *)
        (const void *) (arena + INIT_ERROR_OFFSET);
    CHECK(error_has_zero_tail(error, "fake init failed"));

    fake_mode = FAKE_ADAPTER_SUCCEEDS;
    prepare_init(arena, 0);
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INITIALIZATION_FAILED);
    CHECK(fake_create_calls == 1u);
    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 0u);
    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_free(arena);
    return 0;
}

static int
scenario_decision_failures_are_transactional(void)
{
    uint8_t *arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    int32_t status;

    CHECK(arena != NULL);
    CHECK(initialize_successfully(arena) == BGC_WASM_STATUS_OK);

    fake_mode = FAKE_ADAPTER_CHOOSE_FAILS;
    prepare_choose(arena);
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_EVALUATION_FAILED);
    CHECK(fake_choose_calls == 1u);
    CHECK(check_choose_failure_is_transactional(
              arena, "fake choose failed") == 0);

    fake_mode = FAKE_ADAPTER_CUBE_FAILS;
    prepare_cube(arena);
    status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_RESULT_OFFSET,
                                  CUBE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_EVALUATION_FAILED);
    CHECK(fake_cube_calls == 1u);
    CHECK(check_cube_failure_is_transactional(
              arena, "fake cube failed") == 0);

    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 1u);
    bgc_wasm_free(arena);
    return 0;
}

static int
scenario_malformed_init_output_is_rejected(void)
{
    uint8_t *arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    const bgc_wasm_error_v1 *error;
    int32_t status;

    CHECK(arena != NULL);
    fake_mode = FAKE_ADAPTER_INIT_RETURNS_NULL;
    prepare_init(arena, 0);
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INITIALIZATION_FAILED);
    CHECK(fake_create_calls == 1u);
    CHECK(fake_dispose_calls == 0u);
    error = (const bgc_wasm_error_v1 *)
        (const void *) (arena + INIT_ERROR_OFFSET);
    CHECK(error_has_zero_tail(
              error, "native engine returned no instance"));

    /* Reaching the adapter consumes initialization even on malformed output. */
    fake_mode = FAKE_ADAPTER_SUCCEEDS;
    prepare_init(arena, 0);
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INITIALIZATION_FAILED);
    CHECK(fake_create_calls == 1u);

    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 0u);
    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_free(arena);
    return 0;
}

static int
scenario_malformed_choose_outputs_are_rejected(void)
{
    uint8_t *arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    int32_t status;

    CHECK(arena != NULL);
    CHECK(initialize_successfully(arena) == BGC_WASM_STATUS_OK);

    fake_mode = FAKE_ADAPTER_CHOOSE_BAD_INDEX;
    prepare_choose(arena);
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_EVALUATION_FAILED);
    CHECK(fake_choose_calls == 1u);
    CHECK(check_choose_failure_is_transactional(
              arena,
              "native engine selected an invalid candidate") == 0);

    fake_mode = FAKE_ADAPTER_CHOOSE_NAN_SCORE;
    prepare_choose(arena);
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_EVALUATION_FAILED);
    CHECK(fake_choose_calls == 2u);
    CHECK(check_choose_failure_is_transactional(
              arena,
              "native engine returned a non-finite checker score") == 0);

    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 1u);
    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_free(arena);
    return 0;
}

static int
scenario_malformed_cube_outputs_are_rejected(void)
{
    uint8_t *arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    int32_t status;

    CHECK(arena != NULL);
    CHECK(initialize_successfully(arena) == BGC_WASM_STATUS_OK);

    fake_mode = FAKE_ADAPTER_CUBE_BAD_INDEX;
    prepare_cube(arena);
    status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_RESULT_OFFSET,
                                  CUBE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_EVALUATION_FAILED);
    CHECK(fake_cube_calls == 1u);
    CHECK(check_cube_failure_is_transactional(
              arena,
              "native engine returned an invalid cube selection") == 0);

    fake_mode = FAKE_ADAPTER_CUBE_ACTION_MISMATCH;
    prepare_cube(arena);
    status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_RESULT_OFFSET,
                                  CUBE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_EVALUATION_FAILED);
    CHECK(fake_cube_calls == 2u);
    CHECK(check_cube_failure_is_transactional(
              arena,
              "native engine returned an invalid cube selection") == 0);

    fake_mode = FAKE_ADAPTER_CUBE_NAN_EQUITY;
    prepare_cube(arena);
    status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_RESULT_OFFSET,
                                  CUBE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_EVALUATION_FAILED);
    CHECK(fake_cube_calls == 3u);
    CHECK(check_cube_failure_is_transactional(
              arena,
              "native engine returned a non-finite cube equity") == 0);

    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 1u);
    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_free(arena);
    return 0;
}

static int
scenario_all_strength_values_are_converted(void)
{
    uint8_t *arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    bgc_wasm_choose_request_v1 *choose_request;
    bgc_wasm_cube_request_v1 *cube_request;
    uint32_t strength;
    int32_t status;

    CHECK(arena != NULL);
    CHECK(initialize_successfully(arena) == BGC_WASM_STATUS_OK);

    for (strength = BGC_WASM_STRENGTH_BEGINNER;
         strength <= BGC_WASM_STRENGTH_MAXIMUM; strength++) {
        prepare_choose(arena);
        choose_request = (bgc_wasm_choose_request_v1 *)
            (void *) (arena + CHOOSE_REQUEST_OFFSET);
        choose_request->settings.strength = strength;
        fake_expected_choose_strength = (bgc_strength) strength;
        status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                      CHOOSE_REQUEST_OFFSET,
                                      CHOOSE_RESULT_OFFSET,
                                      CHOOSE_ERROR_OFFSET);
        CHECK(status == BGC_WASM_STATUS_OK);
        CHECK(fake_choose_calls == strength + 1u);
        CHECK(check_choose_success(arena) == 0);
    }

    for (strength = BGC_WASM_STRENGTH_BEGINNER;
         strength <= BGC_WASM_STRENGTH_MAXIMUM; strength++) {
        prepare_cube(arena);
        cube_request = (bgc_wasm_cube_request_v1 *)
            (void *) (arena + CUBE_REQUEST_OFFSET);
        cube_request->settings.strength = strength;
        fake_expected_cube_strength = (bgc_strength) strength;
        status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                      CUBE_REQUEST_OFFSET,
                                      CUBE_RESULT_OFFSET,
                                      CUBE_ERROR_OFFSET);
        CHECK(status == BGC_WASM_STATUS_OK);
        CHECK(fake_cube_calls == strength + 1u);
        CHECK(check_cube_success(arena) == 0);
    }

    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 1u);
    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_free(arena);
    return 0;
}

static int
scenario_wire_validation_rejects_before_adapter(void)
{
    uint8_t *arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    uint8_t snapshot[TEST_ARENA_SIZE];
    bgc_wasm_init_request_v1 *init_request;
    bgc_wasm_choose_request_v1 *choose_request;
    bgc_wasm_candidate_v1 *candidates;
    bgc_wasm_cube_request_v1 *cube_request;
    const bgc_wasm_error_v1 *error;
    int32_t status;

    CHECK(arena != NULL);

    prepare_init(arena, 0);
    init_request = (bgc_wasm_init_request_v1 *)
        (void *) (arena + INIT_REQUEST_OFFSET);
    init_request->header.abi_version = BGC_WASM_ABI_VERSION + 1u;
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_UNSUPPORTED);
    CHECK(fake_create_calls == 0u);
    error = (const bgc_wasm_error_v1 *)
        (const void *) (arena + INIT_ERROR_OFFSET);
    CHECK(error_has_zero_tail(error, "unsupported init request header"));

    prepare_init(arena, 0);
    init_request = (bgc_wasm_init_request_v1 *)
        (void *) (arena + INIT_REQUEST_OFFSET);
    init_request->header.byte_size--;
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(fake_create_calls == 0u);
    error = (const bgc_wasm_error_v1 *)
        (const void *) (arena + INIT_ERROR_OFFSET);
    CHECK(error_has_zero_tail(error, "unsupported init request header"));

    prepare_init(arena, 0);
    memcpy(snapshot, arena, sizeof(snapshot));
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET + 1u, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(memcmp(arena, snapshot, sizeof(snapshot)) == 0);
    CHECK(fake_create_calls == 0u);

    prepare_init(arena, 0);
    memcpy(snapshot, arena, sizeof(snapshot));
    status = bgc_wasm_init(
        arena, TEST_ARENA_SIZE,
        TEST_ARENA_SIZE -
            (uint32_t) sizeof(bgc_wasm_init_request_v1) + 4u,
        INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(memcmp(arena, snapshot, sizeof(snapshot)) == 0);
    CHECK(fake_create_calls == 0u);

    prepare_init(arena, 0);
    memcpy(snapshot, arena, sizeof(snapshot));
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_REQUEST_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(memcmp(arena, snapshot, sizeof(snapshot)) == 0);
    CHECK(fake_create_calls == 0u);

    prepare_init(arena, 0);
    init_request = (bgc_wasm_init_request_v1 *)
        (void *) (arena + INIT_REQUEST_OFFSET);
    init_request->weights_path_offset = INIT_REQUEST_OFFSET;
    memcpy(snapshot, arena, sizeof(snapshot));
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(memcmp(arena, snapshot, sizeof(snapshot)) == 0);
    CHECK(fake_create_calls == 0u);

    prepare_init(arena, 0);
    init_request = (bgc_wasm_init_request_v1 *)
        (void *) (arena + INIT_REQUEST_OFFSET);
    init_request->weights_path_offset = TEST_ARENA_SIZE - 4u;
    init_request->weights_path_length = 8u;
    memcpy(snapshot, arena, sizeof(snapshot));
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(memcmp(arena, snapshot, sizeof(snapshot)) == 0);
    CHECK(fake_create_calls == 0u);

    prepare_init(arena, 0);
    arena[INIT_WEIGHTS_OFFSET] = 0xc0u;
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(fake_create_calls == 0u);
    error = (const bgc_wasm_error_v1 *)
        (const void *) (arena + INIT_ERROR_OFFSET);
    CHECK(error_has_zero_tail(
              error, "engine asset paths must be valid UTF-8"));

    CHECK(initialize_successfully(arena) == BGC_WASM_STATUS_OK);
    CHECK(fake_create_calls == 1u);

    prepare_choose(arena);
    choose_request = (bgc_wasm_choose_request_v1 *)
        (void *) (arena + CHOOSE_REQUEST_OFFSET);
    choose_request->header.abi_version = BGC_WASM_ABI_VERSION + 1u;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_UNSUPPORTED);
    CHECK(check_choose_bad_header_outputs(
              arena, "unsupported choose request header") == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_choose(arena);
    choose_request = (bgc_wasm_choose_request_v1 *)
        (void *) (arena + CHOOSE_REQUEST_OFFSET);
    choose_request->candidates_offset = CHOOSE_CANDIDATES_OFFSET + 1u;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(check_choose_outputs_are_untouched(arena) == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_choose(arena);
    choose_request = (bgc_wasm_choose_request_v1 *)
        (void *) (arena + CHOOSE_REQUEST_OFFSET);
    choose_request->scores_offset = TEST_ARENA_SIZE - 4u;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(check_choose_outputs_are_untouched(arena) == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_choose(arena);
    choose_request = (bgc_wasm_choose_request_v1 *)
        (void *) (arena + CHOOSE_REQUEST_OFFSET);
    choose_request->scores_offset = CHOOSE_RESULT_OFFSET;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(check_choose_outputs_are_untouched(arena) == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_choose(arena);
    choose_request = (bgc_wasm_choose_request_v1 *)
        (void *) (arena + CHOOSE_REQUEST_OFFSET);
    choose_request->candidate_count = 0u;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(check_choose_outputs_are_untouched(arena) == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_choose(arena);
    candidates = (bgc_wasm_candidate_v1 *)
        (void *) (arena + CHOOSE_CANDIDATES_OFFSET);
    candidates[0].steps[0].from.kind =
        BGC_WASM_LOCATION_BORNE_OFF + 1u;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_ILLEGAL_TURN);
    CHECK(check_choose_failure_is_transactional(
              arena, "candidate encoding is invalid") == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_choose(arena);
    candidates = (bgc_wasm_candidate_v1 *)
        (void *) (arena + CHOOSE_CANDIDATES_OFFSET);
    candidates[0].steps[0].die = 0u;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_ILLEGAL_TURN);
    CHECK(check_choose_failure_is_transactional(
              arena, "candidate encoding is invalid") == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_choose(arena);
    candidates = (bgc_wasm_candidate_v1 *)
        (void *) (arena + CHOOSE_CANDIDATES_OFFSET);
    candidates[0].steps[0].hit = 2u;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_ILLEGAL_TURN);
    CHECK(check_choose_failure_is_transactional(
              arena, "candidate encoding is invalid") == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_choose(arena);
    choose_request = (bgc_wasm_choose_request_v1 *)
        (void *) (arena + CHOOSE_REQUEST_OFFSET);
    choose_request->settings.strength =
        BGC_WASM_STRENGTH_MAXIMUM + 1u;
    status = bgc_wasm_choose_turn(arena, TEST_ARENA_SIZE,
                                  CHOOSE_REQUEST_OFFSET,
                                  CHOOSE_RESULT_OFFSET,
                                  CHOOSE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(check_choose_failure_is_transactional(
              arena, "choose settings are invalid") == 0);
    CHECK(fake_choose_calls == 0u);

    prepare_cube(arena);
    status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(check_cube_outputs_are_untouched(arena) == 0);
    CHECK(fake_cube_calls == 0u);

    prepare_cube(arena);
    cube_request = (bgc_wasm_cube_request_v1 *)
        (void *) (arena + CUBE_REQUEST_OFFSET);
    cube_request->legal_actions[1] = cube_request->legal_actions[0];
    status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_RESULT_OFFSET,
                                  CUBE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(check_cube_failure_is_transactional(
              arena,
              "legal cube actions must be valid and unique") == 0);
    CHECK(fake_cube_calls == 0u);

    prepare_cube(arena);
    cube_request = (bgc_wasm_cube_request_v1 *)
        (void *) (arena + CUBE_REQUEST_OFFSET);
    cube_request->legal_actions[0] =
        BGC_WASM_CUBE_ACTION_BEAVER + 1u;
    status = bgc_wasm_decide_cube(arena, TEST_ARENA_SIZE,
                                  CUBE_REQUEST_OFFSET,
                                  CUBE_RESULT_OFFSET,
                                  CUBE_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(check_cube_failure_is_transactional(
              arena,
              "legal cube actions must be valid and unique") == 0);
    CHECK(fake_cube_calls == 0u);

    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 1u);
    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_free(arena);
    return 0;
}

static int
scenario_dispose_before_init_is_terminal(void)
{
    uint8_t *arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    int32_t status;

    CHECK(arena != NULL);
    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 0u);
    prepare_init(arena, 0);
    status = bgc_wasm_init(arena, TEST_ARENA_SIZE,
                           INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    CHECK(status == BGC_WASM_STATUS_INITIALIZATION_FAILED);
    CHECK(fake_create_calls == 0u);
    bgc_wasm_dispose();
    CHECK(fake_dispose_calls == 0u);
    CHECK(fake_assertion_failures == 0u);
    bgc_wasm_free(arena);
    return 0;
}

int
main(const int argc, char **argv)
{
    if (argc != 2) {
        fprintf(stderr,
                "usage: %s lifecycle-success|init-failure|"
                "decision-failures|malformed-init-output|"
                "malformed-choose-output|malformed-cube-output|"
                "strength-conversion|wire-validation|dispose-before-init\n",
                argv[0]);
        return 2;
    }
    if (strcmp(argv[1], "lifecycle-success") == 0)
        return scenario_lifecycle_success();
    if (strcmp(argv[1], "init-failure") == 0)
        return scenario_init_failure_is_terminal();
    if (strcmp(argv[1], "decision-failures") == 0)
        return scenario_decision_failures_are_transactional();
    if (strcmp(argv[1], "malformed-init-output") == 0)
        return scenario_malformed_init_output_is_rejected();
    if (strcmp(argv[1], "malformed-choose-output") == 0)
        return scenario_malformed_choose_outputs_are_rejected();
    if (strcmp(argv[1], "malformed-cube-output") == 0)
        return scenario_malformed_cube_outputs_are_rejected();
    if (strcmp(argv[1], "strength-conversion") == 0)
        return scenario_all_strength_values_are_converted();
    if (strcmp(argv[1], "wire-validation") == 0)
        return scenario_wire_validation_rejects_before_adapter();
    if (strcmp(argv[1], "dispose-before-init") == 0)
        return scenario_dispose_before_init_is_terminal();

    fprintf(stderr, "unknown scenario: %s\n", argv[1]);
    return 2;
}
