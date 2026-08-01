/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_wasm_test_support.h"

#include "gnubg_wasm_abi.h"
#include "gnubg_wasm_bridge_internal.h"

#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BGC_TEST_CANARY_SIZE 16u
#define BGC_TEST_OUTPUT_SENTINEL 0xa5u
#define BGC_TEST_CANARY_BYTE 0xccu

static int
parity_failure(const char *test, const char *format, ...)
{
    va_list arguments;

    fprintf(stderr, "FAIL %s WASM arena parity: ", test);
    va_start(arguments, format);
    vfprintf(stderr, format, arguments);
    va_end(arguments);
    fputc('\n', stderr);
    return 0;
}

static int
map_player(const bgc_player value, uint32_t *output)
{
    switch (value) {
    case BGC_PLAYER_WHITE:
        *output = BGC_WASM_PLAYER_WHITE;
        return 1;
    case BGC_PLAYER_BLACK:
        *output = BGC_WASM_PLAYER_BLACK;
        return 1;
    default:
        return 0;
    }
}

static int
map_optional_player(const int value, int32_t *output)
{
    if (value == -1) {
        *output = BGC_WASM_PLAYER_NONE;
        return 1;
    }
    if (value == BGC_PLAYER_WHITE) {
        *output = (int32_t) BGC_WASM_PLAYER_WHITE;
        return 1;
    }
    if (value == BGC_PLAYER_BLACK) {
        *output = (int32_t) BGC_WASM_PLAYER_BLACK;
        return 1;
    }
    return 0;
}

static int
map_cube_state(const bgc_cube_state value, uint32_t *output)
{
    switch (value) {
    case BGC_CUBE_STATE_AVAILABLE:
        *output = BGC_WASM_CUBE_STATE_AVAILABLE;
        return 1;
    case BGC_CUBE_STATE_OFFERED:
        *output = BGC_WASM_CUBE_STATE_OFFERED;
        return 1;
    case BGC_CUBE_STATE_ACCEPTED:
        *output = BGC_WASM_CUBE_STATE_ACCEPTED;
        return 1;
    case BGC_CUBE_STATE_DECLINED:
        *output = BGC_WASM_CUBE_STATE_DECLINED;
        return 1;
    default:
        return 0;
    }
}

static int
map_match_mode(const bgc_match_mode value, uint32_t *output)
{
    switch (value) {
    case BGC_MATCH_MODE_MONEY:
        *output = BGC_WASM_MATCH_MODE_MONEY;
        return 1;
    case BGC_MATCH_MODE_MATCH:
        *output = BGC_WASM_MATCH_MODE_MATCH;
        return 1;
    default:
        return 0;
    }
}

static int
map_crawford(const bgc_crawford_state value, uint32_t *output)
{
    switch (value) {
    case BGC_CRAWFORD_NONE:
        *output = BGC_WASM_CRAWFORD_NONE;
        return 1;
    case BGC_CRAWFORD_GAME:
        *output = BGC_WASM_CRAWFORD_GAME;
        return 1;
    case BGC_CRAWFORD_POST:
        *output = BGC_WASM_CRAWFORD_POST;
        return 1;
    default:
        return 0;
    }
}

static int
map_variation(const bgc_variation value, uint32_t *output)
{
    switch (value) {
    case BGC_VARIATION_STANDARD:
        *output = BGC_WASM_VARIATION_STANDARD;
        return 1;
    default:
        return 0;
    }
}

static int
map_strength(const bgc_strength value, uint32_t *output)
{
    switch (value) {
    case BGC_STRENGTH_BEGINNER:
        *output = BGC_WASM_STRENGTH_BEGINNER;
        return 1;
    case BGC_STRENGTH_CASUAL:
        *output = BGC_WASM_STRENGTH_CASUAL;
        return 1;
    case BGC_STRENGTH_INTERMEDIATE:
        *output = BGC_WASM_STRENGTH_INTERMEDIATE;
        return 1;
    case BGC_STRENGTH_EXPERT:
        *output = BGC_WASM_STRENGTH_EXPERT;
        return 1;
    case BGC_STRENGTH_MAXIMUM:
        *output = BGC_WASM_STRENGTH_MAXIMUM;
        return 1;
    default:
        return 0;
    }
}

static int
map_location_kind(const bgc_location_kind value, uint32_t *output)
{
    switch (value) {
    case BGC_LOCATION_POINT:
        *output = BGC_WASM_LOCATION_POINT;
        return 1;
    case BGC_LOCATION_BAR:
        *output = BGC_WASM_LOCATION_BAR;
        return 1;
    case BGC_LOCATION_BORNE_OFF:
        *output = BGC_WASM_LOCATION_BORNE_OFF;
        return 1;
    default:
        return 0;
    }
}

static int
map_cube_phase(const bgc_cube_decision_phase value, uint32_t *output)
{
    switch (value) {
    case BGC_CUBE_PHASE_CONSIDER_OFFER:
        *output = BGC_WASM_CUBE_PHASE_CONSIDER_OFFER;
        return 1;
    case BGC_CUBE_PHASE_RESPOND_TO_OFFER:
        *output = BGC_WASM_CUBE_PHASE_RESPOND_TO_OFFER;
        return 1;
    default:
        return 0;
    }
}

static int
map_cube_action(const bgc_cube_action value, uint32_t *output)
{
    switch (value) {
    case BGC_CUBE_ACTION_DOUBLE:
        *output = BGC_WASM_CUBE_ACTION_DOUBLE;
        return 1;
    case BGC_CUBE_ACTION_NO_DOUBLE:
        *output = BGC_WASM_CUBE_ACTION_NO_DOUBLE;
        return 1;
    case BGC_CUBE_ACTION_TOO_GOOD:
        *output = BGC_WASM_CUBE_ACTION_TOO_GOOD;
        return 1;
    case BGC_CUBE_ACTION_TAKE:
        *output = BGC_WASM_CUBE_ACTION_TAKE;
        return 1;
    case BGC_CUBE_ACTION_PASS:
        *output = BGC_WASM_CUBE_ACTION_PASS;
        return 1;
    case BGC_CUBE_ACTION_BEAVER:
        *output = BGC_WASM_CUBE_ACTION_BEAVER;
        return 1;
    default:
        return 0;
    }
}

static int
encode_position(const bgc_position *source, bgc_wasm_position_v1 *target)
{
    size_t point;

    memset(target, 0, sizeof(*target));
    for (point = 0u; point < BGC_POINT_COUNT; point++) {
        target->board.points[point].white = source->board.points[point].white;
        target->board.points[point].black = source->board.points[point].black;
    }
    target->board.bar.white = source->board.bar.white;
    target->board.bar.black = source->board.bar.black;
    target->board.borne_off.white = source->board.borne_off.white;
    target->board.borne_off.black = source->board.borne_off.black;
    if (!map_player(source->player_on_roll, &target->player_on_roll))
        return 0;
    target->dice[0] = source->dice[0];
    target->dice[1] = source->dice[1];
    target->cube.value = source->cube.value;
    if (!map_optional_player(source->cube.owner, &target->cube.owner) ||
        !map_cube_state(source->cube.state, &target->cube.state) ||
        !map_optional_player(source->cube.offered_by,
                             &target->cube.offered_by) ||
        !map_match_mode(source->match.mode, &target->match.mode) ||
        !map_crawford(source->match.crawford, &target->match.crawford) ||
        !map_variation(source->rules.variation,
                       &target->rules.variation))
        return 0;
    target->match.length = source->match.length;
    target->match.score_white = source->match.score.white;
    target->match.score_black = source->match.score.black;
    target->rules.jacoby = (uint32_t) source->rules.jacoby;
    target->rules.beavers = (uint32_t) source->rules.beavers;
    target->rules.raccoons = (uint32_t) source->rules.raccoons;
    target->rules.automatic_doubles = source->rules.automatic_doubles;
    return 1;
}

static int
encode_location(const bgc_location *source, bgc_wasm_location_v1 *target)
{
    if (!map_location_kind(source->kind, &target->kind))
        return 0;
    target->point = source->point;
    return 1;
}

static int
encode_candidates(const bgc_candidate *source,
                  const size_t count,
                  bgc_wasm_candidate_v1 *target)
{
    size_t candidate_index;

    for (candidate_index = 0u; candidate_index < count; candidate_index++) {
        size_t step_index;
        const bgc_candidate *candidate = &source[candidate_index];

        if (candidate->step_count > BGC_MAX_TURN_STEPS ||
            (candidate->step_count != 0u && candidate->steps == NULL))
            return 0;
        target[candidate_index].step_count =
            (uint32_t) candidate->step_count;
        for (step_index = 0u; step_index < candidate->step_count;
             step_index++) {
            const bgc_turn_step *step = &candidate->steps[step_index];
            bgc_wasm_turn_step_v1 *wire =
                &target[candidate_index].steps[step_index];

            if (!encode_location(&step->from, &wire->from) ||
                !encode_location(&step->to, &wire->to))
                return 0;
            wire->die = step->die;
            wire->hit = (uint32_t) step->hit;
        }
    }
    return 1;
}

static int
float_bits_equal(const float left, const float right)
{
    return memcmp(&left, &right, sizeof(left)) == 0;
}

static int
bytes_are_zero(const void *bytes, const size_t count)
{
    const uint8_t *cursor = bytes;
    size_t index;

    for (index = 0u; index < count; index++) {
        if (cursor[index] != 0u)
            return 0;
    }
    return 1;
}

static int
canary_is_intact(const uint8_t *arena, const size_t arena_size)
{
    size_t index;

    for (index = 0u; index < BGC_TEST_CANARY_SIZE; index++) {
        if (arena[arena_size + index] != BGC_TEST_CANARY_BYTE)
            return 0;
    }
    return 1;
}

static const char *
error_detail(const uint8_t *arena, const uint32_t error_offset,
             char output[BGC_WASM_ERROR_MESSAGE_LENGTH + 1u])
{
    memcpy(output, arena + error_offset, BGC_WASM_ERROR_MESSAGE_LENGTH);
    output[BGC_WASM_ERROR_MESSAGE_LENGTH] = '\0';
    return output[0] == '\0' ? "no detail" : output;
}

int
bgc_wasm_test_expect_choose_parity(
    const char *test,
    bgc_engine *engine,
    const bgc_position *position,
    const bgc_candidate *candidates,
    const size_t candidate_count,
    const bgc_settings *settings,
    const bgc_candidate_score *direct_scores,
    const size_t direct_score_count,
    const size_t direct_best_index)
{
    bgc_wasm_choose_request_v1 request;
    bgc_wasm_choose_result_v1 result;
    bgc_wasm_candidate_v1 *wire_candidates = NULL;
    bgc_wasm_candidate_score_v1 wire_score;
    bgc_error reset_error;
    uint8_t *arena = NULL;
    size_t candidate_bytes;
    size_t score_bytes;
    size_t arena_size_value;
    uint32_t candidates_offset;
    uint32_t scores_offset;
    uint32_t result_offset;
    uint32_t error_offset;
    uint32_t arena_size;
    int32_t status;
    size_t index;
    int outcome = 0;
    char detail[BGC_WASM_ERROR_MESSAGE_LENGTH + 1u];

    if (test == NULL || engine == NULL || position == NULL ||
        candidates == NULL || settings == NULL || direct_scores == NULL ||
        candidate_count == 0u || candidate_count > BGC_WASM_MAX_CANDIDATES ||
        direct_score_count != candidate_count ||
        direct_best_index >= candidate_count)
        return parity_failure(test ? test : "unnamed choose test",
                              "invalid parity fixture");

    candidate_bytes = candidate_count * sizeof(*wire_candidates);
    score_bytes = direct_score_count * sizeof(wire_score);
    arena_size_value = sizeof(request) + candidate_bytes + score_bytes +
        sizeof(result) + sizeof(bgc_wasm_error_v1);
    if (arena_size_value > BGC_WASM_MAX_ARENA_BYTES ||
        arena_size_value > UINT32_MAX - BGC_TEST_CANARY_SIZE)
        return parity_failure(test, "fixture exceeds the arena limit");

    candidates_offset = (uint32_t) sizeof(request);
    scores_offset = candidates_offset + (uint32_t) candidate_bytes;
    result_offset = scores_offset + (uint32_t) score_bytes;
    error_offset = result_offset + (uint32_t) sizeof(result);
    arena_size = (uint32_t) arena_size_value;

    wire_candidates = calloc(candidate_count, sizeof(*wire_candidates));
    arena = calloc(1u, arena_size_value + BGC_TEST_CANARY_SIZE);
    if (wire_candidates == NULL || arena == NULL) {
        parity_failure(test, "could not allocate the parity arena");
        goto cleanup;
    }
    memset(&request, 0, sizeof(request));
    request.header.abi_version = BGC_WASM_ABI_VERSION;
    request.header.byte_size = (uint32_t) sizeof(request);
    if (!encode_position(position, &request.position) ||
        !encode_candidates(candidates, candidate_count, wire_candidates) ||
        !map_strength(settings->strength, &request.settings.strength)) {
        parity_failure(test, "fixture contains an unmappable native value");
        goto cleanup;
    }
    request.candidates_offset = candidates_offset;
    request.candidate_count = (uint32_t) candidate_count;
    request.scores_offset = scores_offset;
    request.scores_capacity = (uint32_t) direct_score_count;

    memcpy(arena, &request, sizeof(request));
    memcpy(arena + candidates_offset, wire_candidates, candidate_bytes);
    memset(arena + scores_offset, BGC_TEST_OUTPUT_SENTINEL, score_bytes);
    memset(arena + result_offset, BGC_TEST_OUTPUT_SENTINEL, sizeof(result));
    memset(arena + error_offset, BGC_TEST_OUTPUT_SENTINEL,
           sizeof(bgc_wasm_error_v1));
    memset(arena + arena_size, BGC_TEST_CANARY_BYTE, BGC_TEST_CANARY_SIZE);

    if (bgc_engine_reset(engine, &reset_error) != BGC_STATUS_OK) {
        parity_failure(test, "engine reset failed (%s)",
                       reset_error.message[0] ? reset_error.message
                                              : "no detail");
        goto cleanup;
    }
    status = bgc_wasm_choose_turn_with_engine(
        engine, arena, arena_size, 0u, result_offset, error_offset);
    if (status != BGC_WASM_STATUS_OK) {
        parity_failure(test, "bridge returned status %d (%s)", status,
                       error_detail(arena, error_offset, detail));
        goto cleanup;
    }
    if (!canary_is_intact(arena, arena_size)) {
        parity_failure(test, "bridge overwrote the end-of-arena canary");
        goto cleanup;
    }
    if (memcmp(arena, &request, sizeof(request)) != 0 ||
        memcmp(arena + candidates_offset, wire_candidates,
               candidate_bytes) != 0) {
        parity_failure(test, "bridge mutated request input bytes");
        goto cleanup;
    }
    memcpy(&result, arena + result_offset, sizeof(result));
    if (result.header.abi_version != BGC_WASM_ABI_VERSION ||
        result.header.byte_size != sizeof(result) ||
        result.selected_index != direct_best_index ||
        result.score_count != direct_score_count ||
        !bytes_are_zero(result.reserved, sizeof(result.reserved))) {
        parity_failure(test,
                       "result metadata differs (index=%u/%zu, count=%u/%zu)",
                       result.selected_index, direct_best_index,
                       result.score_count, direct_score_count);
        goto cleanup;
    }
    if (!bytes_are_zero(arena + error_offset,
                        sizeof(bgc_wasm_error_v1))) {
        parity_failure(test, "success left nonzero error bytes");
        goto cleanup;
    }

    for (index = 0u; index < direct_score_count; index++) {
        memcpy(&wire_score,
               arena + scores_offset + index * sizeof(wire_score),
               sizeof(wire_score));
        if (!float_bits_equal(wire_score.score,
                              direct_scores[index].score) ||
            !float_bits_equal(wire_score.cubeless_score,
                              direct_scores[index].cubeless_score)) {
            parity_failure(
                test,
                "score %zu differs (score=%a/%a, cubeless=%a/%a)",
                index, (double) wire_score.score,
                (double) direct_scores[index].score,
                (double) wire_score.cubeless_score,
                (double) direct_scores[index].cubeless_score);
            goto cleanup;
        }
    }
    outcome = 1;

cleanup:
    free(arena);
    free(wire_candidates);
    return outcome;
}

int
bgc_wasm_test_expect_cube_parity(
    const char *test,
    bgc_engine *engine,
    const bgc_position *position,
    const bgc_cube_decision_phase phase,
    const bgc_player engine_player,
    const bgc_cube_action *legal_actions,
    const size_t legal_action_count,
    const bgc_settings *settings,
    const bgc_cube_analysis *direct_analysis)
{
    bgc_wasm_cube_request_v1 request;
    bgc_wasm_cube_result_v1 result;
    bgc_error reset_error;
    const uint32_t result_offset = (uint32_t) sizeof(request);
    const uint32_t error_offset =
        result_offset + (uint32_t) sizeof(result);
    const uint32_t arena_size =
        error_offset + (uint32_t) sizeof(bgc_wasm_error_v1);
    uint8_t *arena;
    uint32_t direct_decision;
    int32_t status;
    size_t index;
    char detail[BGC_WASM_ERROR_MESSAGE_LENGTH + 1u];

    if (test == NULL || engine == NULL || position == NULL ||
        legal_actions == NULL || settings == NULL || direct_analysis == NULL ||
        legal_action_count == 0u ||
        legal_action_count > BGC_WASM_MAX_CUBE_ACTIONS ||
        direct_analysis->selected_index >= legal_action_count)
        return parity_failure(test ? test : "unnamed cube test",
                              "invalid parity fixture");

    memset(&request, 0, sizeof(request));
    request.header.abi_version = BGC_WASM_ABI_VERSION;
    request.header.byte_size = (uint32_t) sizeof(request);
    if (!encode_position(position, &request.position) ||
        !map_cube_phase(phase, &request.phase) ||
        !map_player(engine_player, &request.engine_player) ||
        !map_strength(settings->strength, &request.settings.strength) ||
        !map_cube_action(direct_analysis->decision, &direct_decision))
        return parity_failure(test,
                              "fixture contains an unmappable native value");
    request.legal_action_count = (uint32_t) legal_action_count;
    for (index = 0u; index < legal_action_count; index++) {
        if (!map_cube_action(legal_actions[index],
                             &request.legal_actions[index]))
            return parity_failure(test,
                                  "fixture contains an unmappable action");
    }

    arena = calloc(1u, (size_t) arena_size + BGC_TEST_CANARY_SIZE);
    if (arena == NULL)
        return parity_failure(test, "could not allocate the parity arena");
    memcpy(arena, &request, sizeof(request));
    memset(arena + result_offset, BGC_TEST_OUTPUT_SENTINEL, sizeof(result));
    memset(arena + error_offset, BGC_TEST_OUTPUT_SENTINEL,
           sizeof(bgc_wasm_error_v1));
    memset(arena + arena_size, BGC_TEST_CANARY_BYTE, BGC_TEST_CANARY_SIZE);

    if (bgc_engine_reset(engine, &reset_error) != BGC_STATUS_OK) {
        parity_failure(test, "engine reset failed (%s)",
                       reset_error.message[0] ? reset_error.message
                                              : "no detail");
        free(arena);
        return 0;
    }
    status = bgc_wasm_decide_cube_with_engine(
        engine, arena, arena_size, 0u, result_offset, error_offset);
    if (status != BGC_WASM_STATUS_OK) {
        parity_failure(test, "bridge returned status %d (%s)", status,
                       error_detail(arena, error_offset, detail));
        free(arena);
        return 0;
    }
    if (!canary_is_intact(arena, arena_size)) {
        parity_failure(test, "bridge overwrote the end-of-arena canary");
        free(arena);
        return 0;
    }
    if (memcmp(arena, &request, sizeof(request)) != 0) {
        parity_failure(test, "bridge mutated request input bytes");
        free(arena);
        return 0;
    }
    memcpy(&result, arena + result_offset, sizeof(result));
    if (result.header.abi_version != BGC_WASM_ABI_VERSION ||
        result.header.byte_size != sizeof(result) ||
        result.decision != direct_decision ||
        result.selected_index != direct_analysis->selected_index ||
        result.evaluated != (uint32_t) direct_analysis->evaluated ||
        result.reserved0 != 0u ||
        !bytes_are_zero(result.reserved, sizeof(result.reserved))) {
        parity_failure(
            test,
            "result metadata differs (action=%u/%u, index=%u/%u, "
            "evaluated=%u/%d)",
            result.decision, direct_decision, result.selected_index,
            direct_analysis->selected_index, result.evaluated,
            direct_analysis->evaluated);
        free(arena);
        return 0;
    }
    if (!float_bits_equal(result.selected_action_equity,
                          direct_analysis->selected_action_equity) ||
        !float_bits_equal(result.preoffer_optimal_equity,
                          direct_analysis->preoffer_optimal_equity) ||
        !float_bits_equal(result.no_double_equity,
                          direct_analysis->no_double_equity) ||
        !float_bits_equal(result.double_take_equity,
                          direct_analysis->double_take_equity) ||
        !float_bits_equal(result.double_pass_equity,
                          direct_analysis->double_pass_equity)) {
        parity_failure(test, "cube equity float bits differ");
        free(arena);
        return 0;
    }
    if (!bytes_are_zero(arena + error_offset,
                        sizeof(bgc_wasm_error_v1))) {
        parity_failure(test, "success left nonzero error bytes");
        free(arena);
        return 0;
    }

    free(arena);
    return 1;
}


static int
map_status_for_failure(const bgc_status status, int32_t *wire_status)
{
    switch (status) {
    case BGC_STATUS_OK:
        *wire_status = BGC_WASM_STATUS_OK;
        return 1;
    case BGC_STATUS_INVALID_ARGUMENT:
        *wire_status = BGC_WASM_STATUS_INVALID_ARGUMENT;
        return 1;
    case BGC_STATUS_INVALID_POSITION:
        *wire_status = BGC_WASM_STATUS_INVALID_POSITION;
        return 1;
    case BGC_STATUS_ILLEGAL_TURN:
        *wire_status = BGC_WASM_STATUS_ILLEGAL_TURN;
        return 1;
    case BGC_STATUS_NOT_READY:
        *wire_status = BGC_WASM_STATUS_NOT_READY;
        return 1;
    case BGC_STATUS_INITIALIZATION_FAILED:
        *wire_status = BGC_WASM_STATUS_INITIALIZATION_FAILED;
        return 1;
    case BGC_STATUS_EVALUATION_FAILED:
        *wire_status = BGC_WASM_STATUS_EVALUATION_FAILED;
        return 1;
    case BGC_STATUS_UNSUPPORTED:
        *wire_status = BGC_WASM_STATUS_UNSUPPORTED;
        return 1;
    default:
        return 0;
    }
}

static int
error_is_bounded_nonempty(const uint8_t *arena, const uint32_t error_offset)
{
    const uint8_t *message = arena + error_offset;
    const uint8_t *terminator = memchr(
        message, 0, BGC_WASM_ERROR_MESSAGE_LENGTH);

    return message[0] != 0u && terminator != NULL &&
        bytes_are_zero(
            terminator,
            BGC_WASM_ERROR_MESSAGE_LENGTH -
                (size_t) (terminator - message));
}

int
bgc_wasm_test_expect_choose_failure(
    const char *test,
    bgc_engine *engine,
    const bgc_position *position,
    const bgc_candidate *candidates,
    const size_t candidate_count,
    const bgc_settings *settings,
    const bgc_status expected_status)
{
    bgc_wasm_choose_request_v1 request;
    bgc_wasm_choose_result_v1 result;
    bgc_wasm_candidate_v1 *wire_candidates = NULL;
    bgc_error reset_error;
    uint8_t *arena = NULL;
    size_t candidate_bytes;
    size_t score_bytes;
    size_t arena_size_value;
    uint32_t candidates_offset;
    uint32_t scores_offset;
    uint32_t result_offset;
    uint32_t error_offset;
    uint32_t arena_size;
    int32_t expected_wire_status;
    int32_t status;
    int outcome = 0;
    char detail[BGC_WASM_ERROR_MESSAGE_LENGTH + 1u];

    if (test == NULL || engine == NULL || position == NULL ||
        candidates == NULL || settings == NULL || candidate_count == 0u ||
        candidate_count > BGC_WASM_MAX_CANDIDATES ||
        !map_status_for_failure(expected_status, &expected_wire_status) ||
        expected_wire_status == BGC_WASM_STATUS_OK)
        return parity_failure(test ? test : "unnamed choose failure",
                              "invalid failure fixture");

    candidate_bytes = candidate_count * sizeof(*wire_candidates);
    score_bytes = candidate_count * sizeof(bgc_wasm_candidate_score_v1);
    arena_size_value = sizeof(request) + candidate_bytes + score_bytes +
        sizeof(result) + sizeof(bgc_wasm_error_v1);
    if (arena_size_value > BGC_WASM_MAX_ARENA_BYTES ||
        arena_size_value > UINT32_MAX - BGC_TEST_CANARY_SIZE)
        return parity_failure(test, "fixture exceeds the arena limit");

    candidates_offset = (uint32_t) sizeof(request);
    scores_offset = candidates_offset + (uint32_t) candidate_bytes;
    result_offset = scores_offset + (uint32_t) score_bytes;
    error_offset = result_offset + (uint32_t) sizeof(result);
    arena_size = (uint32_t) arena_size_value;

    wire_candidates = calloc(candidate_count, sizeof(*wire_candidates));
    arena = calloc(1u, arena_size_value + BGC_TEST_CANARY_SIZE);
    if (wire_candidates == NULL || arena == NULL) {
        parity_failure(test, "could not allocate the failure arena");
        goto cleanup;
    }
    memset(&request, 0, sizeof(request));
    request.header.abi_version = BGC_WASM_ABI_VERSION;
    request.header.byte_size = (uint32_t) sizeof(request);
    if (!encode_position(position, &request.position) ||
        !encode_candidates(candidates, candidate_count, wire_candidates) ||
        !map_strength(settings->strength, &request.settings.strength)) {
        parity_failure(test, "fixture contains an unmappable native value");
        goto cleanup;
    }
    request.candidates_offset = candidates_offset;
    request.candidate_count = (uint32_t) candidate_count;
    request.scores_offset = scores_offset;
    request.scores_capacity = (uint32_t) candidate_count;

    memcpy(arena, &request, sizeof(request));
    memcpy(arena + candidates_offset, wire_candidates, candidate_bytes);
    memset(arena + scores_offset, BGC_TEST_OUTPUT_SENTINEL, score_bytes);
    memset(arena + result_offset, BGC_TEST_OUTPUT_SENTINEL, sizeof(result));
    memset(arena + error_offset, BGC_TEST_OUTPUT_SENTINEL,
           sizeof(bgc_wasm_error_v1));
    memset(arena + arena_size, BGC_TEST_CANARY_BYTE, BGC_TEST_CANARY_SIZE);

    if (bgc_engine_reset(engine, &reset_error) != BGC_STATUS_OK) {
        parity_failure(test, "engine reset failed (%s)",
                       reset_error.message[0] ? reset_error.message
                                              : "no detail");
        goto cleanup;
    }
    status = bgc_wasm_choose_turn_with_engine(
        engine, arena, arena_size, 0u, result_offset, error_offset);
    if (status != expected_wire_status) {
        parity_failure(test, "bridge returned status %d, expected %d (%s)",
                       status, expected_wire_status,
                       error_detail(arena, error_offset, detail));
        goto cleanup;
    }
    if (!canary_is_intact(arena, arena_size)) {
        parity_failure(test, "bridge overwrote the end-of-arena canary");
        goto cleanup;
    }
    if (memcmp(arena, &request, sizeof(request)) != 0 ||
        memcmp(arena + candidates_offset, wire_candidates,
               candidate_bytes) != 0) {
        parity_failure(test, "bridge mutated request input bytes");
        goto cleanup;
    }
    memcpy(&result, arena + result_offset, sizeof(result));
    if (result.header.abi_version != BGC_WASM_ABI_VERSION ||
        result.header.byte_size != sizeof(result) ||
        !bytes_are_zero(
            (const uint8_t *) &result + sizeof(result.header),
            sizeof(result) - sizeof(result.header))) {
        parity_failure(test, "failure exposed a partial checker result");
        goto cleanup;
    }
    if (!bytes_are_zero(arena + scores_offset, score_bytes)) {
        parity_failure(test, "failure exposed partial checker scores");
        goto cleanup;
    }
    if (!error_is_bounded_nonempty(arena, error_offset)) {
        parity_failure(test, "failure did not return a bounded error message");
        goto cleanup;
    }
    outcome = 1;

cleanup:
    free(arena);
    free(wire_candidates);
    return outcome;
}

int
bgc_wasm_test_expect_cube_failure(
    const char *test,
    bgc_engine *engine,
    const bgc_position *position,
    const bgc_cube_decision_phase phase,
    const bgc_player engine_player,
    const bgc_cube_action *legal_actions,
    const size_t legal_action_count,
    const bgc_settings *settings,
    const bgc_status expected_status)
{
    bgc_wasm_cube_request_v1 request;
    bgc_wasm_cube_result_v1 result;
    bgc_error reset_error;
    const uint32_t result_offset = (uint32_t) sizeof(request);
    const uint32_t error_offset =
        result_offset + (uint32_t) sizeof(result);
    const uint32_t arena_size =
        error_offset + (uint32_t) sizeof(bgc_wasm_error_v1);
    uint8_t *arena;
    int32_t expected_wire_status;
    int32_t status;
    size_t index;
    char detail[BGC_WASM_ERROR_MESSAGE_LENGTH + 1u];

    if (test == NULL || engine == NULL || position == NULL ||
        legal_actions == NULL || settings == NULL ||
        legal_action_count == 0u ||
        legal_action_count > BGC_WASM_MAX_CUBE_ACTIONS ||
        !map_status_for_failure(expected_status, &expected_wire_status) ||
        expected_wire_status == BGC_WASM_STATUS_OK)
        return parity_failure(test ? test : "unnamed cube failure",
                              "invalid failure fixture");

    memset(&request, 0, sizeof(request));
    request.header.abi_version = BGC_WASM_ABI_VERSION;
    request.header.byte_size = (uint32_t) sizeof(request);
    if (!encode_position(position, &request.position) ||
        !map_cube_phase(phase, &request.phase) ||
        !map_player(engine_player, &request.engine_player) ||
        !map_strength(settings->strength, &request.settings.strength))
        return parity_failure(test,
                              "fixture contains an unmappable native value");
    request.legal_action_count = (uint32_t) legal_action_count;
    for (index = 0u; index < legal_action_count; index++) {
        if (!map_cube_action(legal_actions[index],
                             &request.legal_actions[index]))
            return parity_failure(test,
                                  "fixture contains an unmappable action");
    }

    arena = calloc(1u, (size_t) arena_size + BGC_TEST_CANARY_SIZE);
    if (arena == NULL)
        return parity_failure(test, "could not allocate the failure arena");
    memcpy(arena, &request, sizeof(request));
    memset(arena + result_offset, BGC_TEST_OUTPUT_SENTINEL, sizeof(result));
    memset(arena + error_offset, BGC_TEST_OUTPUT_SENTINEL,
           sizeof(bgc_wasm_error_v1));
    memset(arena + arena_size, BGC_TEST_CANARY_BYTE, BGC_TEST_CANARY_SIZE);

    if (bgc_engine_reset(engine, &reset_error) != BGC_STATUS_OK) {
        parity_failure(test, "engine reset failed (%s)",
                       reset_error.message[0] ? reset_error.message
                                              : "no detail");
        free(arena);
        return 0;
    }
    status = bgc_wasm_decide_cube_with_engine(
        engine, arena, arena_size, 0u, result_offset, error_offset);
    if (status != expected_wire_status) {
        parity_failure(test, "bridge returned status %d, expected %d (%s)",
                       status, expected_wire_status,
                       error_detail(arena, error_offset, detail));
        free(arena);
        return 0;
    }
    if (!canary_is_intact(arena, arena_size)) {
        parity_failure(test, "bridge overwrote the end-of-arena canary");
        free(arena);
        return 0;
    }
    if (memcmp(arena, &request, sizeof(request)) != 0) {
        parity_failure(test, "bridge mutated request input bytes");
        free(arena);
        return 0;
    }
    memcpy(&result, arena + result_offset, sizeof(result));
    if (result.header.abi_version != BGC_WASM_ABI_VERSION ||
        result.header.byte_size != sizeof(result) ||
        !bytes_are_zero(
            (const uint8_t *) &result + sizeof(result.header),
            sizeof(result) - sizeof(result.header))) {
        parity_failure(test, "failure exposed a partial cube result");
        free(arena);
        return 0;
    }
    if (!error_is_bounded_nonempty(arena, error_offset)) {
        parity_failure(test, "failure did not return a bounded error message");
        free(arena);
        return 0;
    }

    free(arena);
    return 1;
}
