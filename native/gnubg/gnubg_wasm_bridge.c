/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_wasm_bridge_internal.h"

#include <limits.h>
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "gnubg_wasm_abi.h"
#include "gnubg_wasm_marshal.h"

_Static_assert(CHAR_BIT == 8, "the bridge requires 8-bit bytes");
_Static_assert(sizeof(int) == 4, "the bridge requires a 32-bit int");
_Static_assert(sizeof(unsigned int) == 4,
               "the bridge requires a 32-bit unsigned int");
_Static_assert(BGC_MAX_CANDIDATES == BGC_WASM_MAX_CANDIDATES,
               "native and wire candidate limits must match");
_Static_assert(BGC_MAX_TURN_STEPS == BGC_WASM_MAX_TURN_STEPS,
               "native and wire turn-step limits must match");
_Static_assert(BGC_MAX_CUBE_ACTIONS == BGC_WASM_MAX_CUBE_ACTIONS,
               "native and wire cube-action limits must match");

typedef enum {
    BGC_WRAPPER_UNUSED = 0,
    BGC_WRAPPER_ACTIVE,
    BGC_WRAPPER_FINISHED
} bgc_wrapper_state;

static bgc_engine *wrapper_engine;
static bgc_wrapper_state wrapper_state;

/* One Worker calls the bridge serially, so fixed scratch storage is bounded. */
static bgc_candidate scratch_candidates[BGC_WASM_MAX_CANDIDATES];
static bgc_turn_step
    scratch_steps[BGC_WASM_MAX_CANDIDATES][BGC_WASM_MAX_TURN_STEPS];
static bgc_candidate_score scratch_scores[BGC_WASM_MAX_CANDIDATES];

static int32_t
wire_status(const bgc_status status) {
    switch (status) {
    case BGC_STATUS_OK:
        return BGC_WASM_STATUS_OK;
    case BGC_STATUS_INVALID_ARGUMENT:
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    case BGC_STATUS_INVALID_POSITION:
        return BGC_WASM_STATUS_INVALID_POSITION;
    case BGC_STATUS_ILLEGAL_TURN:
        return BGC_WASM_STATUS_ILLEGAL_TURN;
    case BGC_STATUS_NOT_READY:
        return BGC_WASM_STATUS_NOT_READY;
    case BGC_STATUS_INITIALIZATION_FAILED:
        return BGC_WASM_STATUS_INITIALIZATION_FAILED;
    case BGC_STATUS_EVALUATION_FAILED:
        return BGC_WASM_STATUS_EVALUATION_FAILED;
    case BGC_STATUS_UNSUPPORTED:
        return BGC_WASM_STATUS_UNSUPPORTED;
    default:
        return BGC_WASM_STATUS_EVALUATION_FAILED;
    }
}

static int32_t
header_status(const bgc_wasm_header_v1 *header, const uint32_t byte_size) {
    if (header->abi_version != BGC_WASM_ABI_VERSION)
        return BGC_WASM_STATUS_UNSUPPORTED;
    if (header->byte_size != byte_size)
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    return BGC_WASM_STATUS_OK;
}

static void
copy_message(uint8_t output[BGC_WASM_ERROR_MESSAGE_LENGTH],
             const char *message) {
    size_t index = 0u;

    if (message != NULL) {
        while (index + 1u < BGC_WASM_ERROR_MESSAGE_LENGTH &&
               message[index] != '\0') {
            output[index] = (uint8_t) message[index];
            index++;
        }
    }
    output[index] = 0u;
}

static void
store_error(const bgc_wasm_arena_view *arena,
            const bgc_wasm_range *error_range,
            const char *message) {
    bgc_wasm_error_v1 error = {{0}};

    copy_message(error.message, message);
    bgc_wasm_arena_store(arena, error_range, &error, sizeof(error));
}

static int32_t
fail_with_message(const int32_t status,
                  const bgc_wasm_arena_view *arena,
                  const bgc_wasm_range *error_range,
                  const char *message) {
    store_error(arena, error_range, message);
    return status;
}

static int32_t
fail_with_adapter_error(const bgc_status status,
                        const bgc_wasm_arena_view *arena,
                        const bgc_wasm_range *error_range,
                        const bgc_error *error) {
    const int32_t result = wire_status(status);
    const char *message = error != NULL && error->message[0] != '\0'
        ? error->message : "native engine call failed";

    return fail_with_message(result, arena, error_range, message);
}

static int
make_struct_range(const bgc_wasm_arena_view *arena,
                  const uint32_t offset,
                  const uint32_t byte_size,
                  bgc_wasm_range *range) {
    return bgc_wasm_make_byte_range(
        arena, offset, byte_size, 4u, 0, range);
}

static int
reserved_is_zero(const uint32_t *reserved, const size_t count) {
    return bgc_wasm_bytes_are_zero(reserved, count * sizeof(*reserved));
}

static int32_t
convert_position(const bgc_wasm_position_v1 *wire,
                 bgc_position *native) {
    size_t point;

    memset(native, 0, sizeof(*native));
    for (point = 0u; point < BGC_WASM_POINT_COUNT; point++) {
        native->board.points[point].white = wire->board.points[point].white;
        native->board.points[point].black = wire->board.points[point].black;
    }
    native->board.bar.white = wire->board.bar.white;
    native->board.bar.black = wire->board.bar.black;
    native->board.borne_off.white = wire->board.borne_off.white;
    native->board.borne_off.black = wire->board.borne_off.black;

    if (wire->player_on_roll > BGC_WASM_PLAYER_BLACK)
        return BGC_WASM_STATUS_INVALID_POSITION;
    native->player_on_roll = wire->player_on_roll == BGC_WASM_PLAYER_WHITE
        ? BGC_PLAYER_WHITE : BGC_PLAYER_BLACK;
    native->dice[0] = wire->dice[0];
    native->dice[1] = wire->dice[1];

    if (wire->cube.owner < BGC_WASM_PLAYER_NONE ||
        wire->cube.owner > (int32_t) BGC_WASM_PLAYER_BLACK ||
        wire->cube.offered_by < BGC_WASM_PLAYER_NONE ||
        wire->cube.offered_by > (int32_t) BGC_WASM_PLAYER_BLACK ||
        wire->cube.state > BGC_WASM_CUBE_STATE_DECLINED)
        return BGC_WASM_STATUS_INVALID_POSITION;
    native->cube.value = wire->cube.value;
    native->cube.owner = wire->cube.owner;
    native->cube.state = (bgc_cube_state) wire->cube.state;
    native->cube.offered_by = wire->cube.offered_by;

    if (wire->match.mode > BGC_WASM_MATCH_MODE_MATCH ||
        wire->match.crawford > BGC_WASM_CRAWFORD_POST)
        return BGC_WASM_STATUS_INVALID_POSITION;
    native->match.mode = (bgc_match_mode) wire->match.mode;
    native->match.length = wire->match.length;
    native->match.score.white = wire->match.score_white;
    native->match.score.black = wire->match.score_black;
    native->match.crawford = (bgc_crawford_state) wire->match.crawford;

    if (wire->rules.variation != BGC_WASM_VARIATION_STANDARD)
        return BGC_WASM_STATUS_UNSUPPORTED;
    if (wire->rules.jacoby > 1u || wire->rules.beavers > 1u ||
        wire->rules.raccoons > 1u || wire->rules.automatic_doubles > 16u)
        return BGC_WASM_STATUS_INVALID_POSITION;
    native->rules.variation = BGC_VARIATION_STANDARD;
    native->rules.jacoby = (int) wire->rules.jacoby;
    native->rules.beavers = (int) wire->rules.beavers;
    native->rules.raccoons = (int) wire->rules.raccoons;
    native->rules.automatic_doubles = wire->rules.automatic_doubles;
    return BGC_WASM_STATUS_OK;
}

static int32_t
convert_location(const bgc_wasm_location_v1 *wire,
                 bgc_location *native,
                 const int is_source) {
    if (wire->kind > BGC_WASM_LOCATION_BORNE_OFF)
        return BGC_WASM_STATUS_ILLEGAL_TURN;
    if (is_source && wire->kind == BGC_WASM_LOCATION_BORNE_OFF)
        return BGC_WASM_STATUS_ILLEGAL_TURN;
    if (!is_source && wire->kind == BGC_WASM_LOCATION_BAR)
        return BGC_WASM_STATUS_ILLEGAL_TURN;
    if (wire->kind == BGC_WASM_LOCATION_POINT &&
        (wire->point < 0 || wire->point >= (int32_t) BGC_WASM_POINT_COUNT))
        return BGC_WASM_STATUS_ILLEGAL_TURN;

    native->kind = (bgc_location_kind) wire->kind;
    native->point = wire->kind == BGC_WASM_LOCATION_POINT
        ? wire->point : 0;
    return BGC_WASM_STATUS_OK;
}

static int32_t
convert_candidate(const bgc_wasm_candidate_v1 *wire,
                  bgc_candidate *native,
                  bgc_turn_step steps[BGC_WASM_MAX_TURN_STEPS]) {
    uint32_t index;

    if (wire->reserved != 0u || wire->step_count < 1u ||
        wire->step_count > BGC_WASM_MAX_TURN_STEPS)
        return wire->reserved != 0u
            ? BGC_WASM_STATUS_INVALID_ARGUMENT
            : BGC_WASM_STATUS_ILLEGAL_TURN;

    memset(steps, 0,
           sizeof(*steps) * (size_t) BGC_WASM_MAX_TURN_STEPS);
    for (index = 0u; index < wire->step_count; index++) {
        int32_t status = convert_location(
            &wire->steps[index].from, &steps[index].from, 1);
        if (status != BGC_WASM_STATUS_OK)
            return status;
        status = convert_location(
            &wire->steps[index].to, &steps[index].to, 0);
        if (status != BGC_WASM_STATUS_OK)
            return status;
        if (wire->steps[index].die < 1u ||
            wire->steps[index].die > 6u || wire->steps[index].hit > 1u)
            return BGC_WASM_STATUS_ILLEGAL_TURN;
        steps[index].die = wire->steps[index].die;
        steps[index].hit = (int) wire->steps[index].hit;
    }
    native->steps = steps;
    native->step_count = wire->step_count;
    return BGC_WASM_STATUS_OK;
}

static int32_t
convert_settings(const bgc_wasm_settings_v1 *wire,
                 bgc_settings *native) {
    if (!reserved_is_zero(wire->reserved, 3u) ||
        wire->strength > BGC_WASM_STRENGTH_MAXIMUM)
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    native->strength = (bgc_strength) wire->strength;
    return BGC_WASM_STATUS_OK;
}

static void
prepare_choose_result(const bgc_wasm_arena_view *arena,
                      const bgc_wasm_range *result_range,
                      const bgc_wasm_range *scores_range) {
    bgc_wasm_choose_result_v1 result = {0};

    bgc_wasm_arena_clear(arena, result_range);
    bgc_wasm_arena_clear(arena, scores_range);
    result.header.abi_version = BGC_WASM_ABI_VERSION;
    result.header.byte_size = (uint32_t) sizeof(result);
    bgc_wasm_arena_store(arena, result_range, &result, sizeof(result));
}

static void
prepare_cube_result(const bgc_wasm_arena_view *arena,
                    const bgc_wasm_range *result_range) {
    bgc_wasm_cube_result_v1 result = {0};

    bgc_wasm_arena_clear(arena, result_range);
    result.header.abi_version = BGC_WASM_ABI_VERSION;
    result.header.byte_size = (uint32_t) sizeof(result);
    bgc_wasm_arena_store(arena, result_range, &result, sizeof(result));
}

uint8_t *
bgc_wasm_alloc(const uint32_t byte_size) {
    if (byte_size == 0u || byte_size > BGC_WASM_MAX_ARENA_BYTES)
        return NULL;
    return calloc(1u, byte_size);
}

void
bgc_wasm_free(uint8_t *memory) {
    free(memory);
}

int32_t
bgc_wasm_init_with_engine(uint8_t *arena_memory,
                          const uint32_t arena_size,
                          const uint32_t request_offset,
                          const uint32_t error_offset,
                          bgc_engine **engine_out,
                          int *adapter_called) {
    bgc_wasm_arena_view arena;
    bgc_wasm_range request_range;
    bgc_wasm_range error_range;
    bgc_wasm_range weights_range;
    bgc_wasm_range equity_range;
    bgc_wasm_range top_ranges[2];
    bgc_wasm_range all_ranges[4];
    bgc_wasm_init_request_v1 request;
    char weights_path[BGC_WASM_MAX_PATH_BYTES + 1u];
    char equity_path[BGC_WASM_MAX_PATH_BYTES + 1u];
    bgc_error native_error = {{0}};
    bgc_status native_status;
    int32_t status;

    if (engine_out == NULL || adapter_called == NULL)
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    *engine_out = NULL;
    *adapter_called = 0;
    if (!bgc_wasm_arena_view_init(&arena, arena_memory, arena_size) ||
        !make_struct_range(&arena, request_offset, sizeof(request),
                           &request_range) ||
        !make_struct_range(&arena, error_offset, sizeof(bgc_wasm_error_v1),
                           &error_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    top_ranges[0] = request_range;
    top_ranges[1] = error_range;
    if (!bgc_wasm_ranges_are_disjoint(top_ranges, 2u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;

    bgc_wasm_arena_load(&arena, &request_range, &request, sizeof(request));
    status = header_status(&request.header, sizeof(request));
    if (status != BGC_WASM_STATUS_OK) {
        bgc_wasm_arena_clear(&arena, &error_range);
        return fail_with_message(
            status, &arena, &error_range, "unsupported init request header");
    }
    if (!bgc_wasm_make_byte_range(
            &arena, request.weights_path_offset,
            request.weights_path_length, 1u, 0, &weights_range) ||
        !bgc_wasm_make_byte_range(
            &arena, request.match_equity_path_offset,
            request.match_equity_path_length, 1u, 0, &equity_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    all_ranges[0] = request_range;
    all_ranges[1] = error_range;
    all_ranges[2] = weights_range;
    all_ranges[3] = equity_range;
    if (!bgc_wasm_ranges_are_disjoint(all_ranges, 4u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    bgc_wasm_arena_clear(&arena, &error_range);

    if (!reserved_is_zero(request.reserved, 2u))
        return fail_with_message(
            BGC_WASM_STATUS_INVALID_ARGUMENT, &arena, &error_range,
            "init request reserved fields must be zero");
    if (!bgc_wasm_utf8_is_valid_path(
            arena.base + weights_range.offset, weights_range.length) ||
        !bgc_wasm_utf8_is_valid_path(
            arena.base + equity_range.offset, equity_range.length))
        return fail_with_message(
            BGC_WASM_STATUS_INVALID_ARGUMENT, &arena, &error_range,
            "engine asset paths must be valid UTF-8");

    memcpy(weights_path, arena.base + weights_range.offset,
           weights_range.length);
    weights_path[weights_range.length] = '\0';
    memcpy(equity_path, arena.base + equity_range.offset,
           equity_range.length);
    equity_path[equity_range.length] = '\0';
    *adapter_called = 1;
    native_status = bgc_engine_create(
        weights_path, equity_path, engine_out, &native_error);
    if (native_status != BGC_STATUS_OK)
        return fail_with_adapter_error(
            native_status, &arena, &error_range, &native_error);
    if (*engine_out == NULL)
        return fail_with_message(
            BGC_WASM_STATUS_INITIALIZATION_FAILED, &arena, &error_range,
            "native engine returned no instance");
    return BGC_WASM_STATUS_OK;
}

static int32_t
report_consumed_init(uint8_t *arena_memory,
                     const uint32_t arena_size,
                     const uint32_t request_offset,
                     const uint32_t error_offset) {
    bgc_wasm_arena_view arena;
    bgc_wasm_range request_range;
    bgc_wasm_range error_range;
    bgc_wasm_range weights_range;
    bgc_wasm_range equity_range;
    bgc_wasm_range top_ranges[2];
    bgc_wasm_range all_ranges[4];
    bgc_wasm_init_request_v1 request;
    int32_t status;

    if (!bgc_wasm_arena_view_init(&arena, arena_memory, arena_size) ||
        !make_struct_range(&arena, request_offset, sizeof(request),
                           &request_range) ||
        !make_struct_range(&arena, error_offset,
                           sizeof(bgc_wasm_error_v1), &error_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    top_ranges[0] = request_range;
    top_ranges[1] = error_range;
    if (!bgc_wasm_ranges_are_disjoint(top_ranges, 2u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;

    bgc_wasm_arena_load(&arena, &request_range, &request, sizeof(request));
    status = header_status(&request.header, sizeof(request));
    if (status != BGC_WASM_STATUS_OK) {
        bgc_wasm_arena_clear(&arena, &error_range);
        return fail_with_message(
            status, &arena, &error_range, "unsupported init request header");
    }
    if (!bgc_wasm_make_byte_range(
            &arena, request.weights_path_offset,
            request.weights_path_length, 1u, 0, &weights_range) ||
        !bgc_wasm_make_byte_range(
            &arena, request.match_equity_path_offset,
            request.match_equity_path_length, 1u, 0, &equity_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    all_ranges[0] = request_range;
    all_ranges[1] = error_range;
    all_ranges[2] = weights_range;
    all_ranges[3] = equity_range;
    if (!bgc_wasm_ranges_are_disjoint(all_ranges, 4u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    bgc_wasm_arena_clear(&arena, &error_range);
    if (!reserved_is_zero(request.reserved, 2u) ||
        !bgc_wasm_utf8_is_valid_path(
            arena.base + weights_range.offset, weights_range.length) ||
        !bgc_wasm_utf8_is_valid_path(
            arena.base + equity_range.offset, equity_range.length))
        return fail_with_message(
            BGC_WASM_STATUS_INVALID_ARGUMENT, &arena, &error_range,
            "init request is invalid");
    return fail_with_message(
        BGC_WASM_STATUS_INITIALIZATION_FAILED, &arena, &error_range,
        "engine initialization is already consumed");
}

int32_t
bgc_wasm_init(uint8_t *arena,
              const uint32_t arena_size,
              const uint32_t request_offset,
              const uint32_t error_offset) {
    bgc_engine *created = NULL;
    int adapter_called = 0;
    int32_t status;

    if (wrapper_state != BGC_WRAPPER_UNUSED)
        return report_consumed_init(
            arena, arena_size, request_offset, error_offset);

    status = bgc_wasm_init_with_engine(
        arena, arena_size, request_offset, error_offset,
        &created, &adapter_called);
    if (adapter_called) {
        if (status == BGC_WASM_STATUS_OK && created != NULL) {
            wrapper_engine = created;
            wrapper_state = BGC_WRAPPER_ACTIVE;
        } else {
            if (created != NULL)
                bgc_engine_dispose(created);
            wrapper_engine = NULL;
            wrapper_state = BGC_WRAPPER_FINISHED;
        }
    }
    return status;
}

int32_t
bgc_wasm_choose_turn_with_engine(bgc_engine *engine,
                                 uint8_t *arena_memory,
                                 const uint32_t arena_size,
                                 const uint32_t request_offset,
                                 const uint32_t result_offset,
                                 const uint32_t error_offset) {
    bgc_wasm_arena_view arena;
    bgc_wasm_range request_range;
    bgc_wasm_range result_range;
    bgc_wasm_range error_range;
    bgc_wasm_range candidate_range;
    bgc_wasm_range scores_range;
    bgc_wasm_range top_ranges[3];
    bgc_wasm_range all_ranges[5];
    bgc_wasm_choose_request_v1 request;
    bgc_wasm_choose_result_v1 result = {0};
    bgc_position position;
    bgc_settings settings;
    bgc_error native_error = {{0}};
    size_t best_index = 0u;
    uint32_t index;
    int32_t status;
    bgc_status native_status;

    if (!bgc_wasm_arena_view_init(&arena, arena_memory, arena_size) ||
        !make_struct_range(&arena, request_offset, sizeof(request),
                           &request_range) ||
        !make_struct_range(&arena, result_offset, sizeof(result),
                           &result_range) ||
        !make_struct_range(&arena, error_offset, sizeof(bgc_wasm_error_v1),
                           &error_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    top_ranges[0] = request_range;
    top_ranges[1] = result_range;
    top_ranges[2] = error_range;
    if (!bgc_wasm_ranges_are_disjoint(top_ranges, 3u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;

    bgc_wasm_arena_load(&arena, &request_range, &request, sizeof(request));
    status = header_status(&request.header, sizeof(request));
    if (status != BGC_WASM_STATUS_OK) {
        bgc_wasm_arena_clear(&arena, &error_range);
        prepare_choose_result(&arena, &result_range,
                              &(bgc_wasm_range){0u, 0u, 0u});
        return fail_with_message(
            status, &arena, &error_range, "unsupported choose request header");
    }
    if (request.candidate_count < 1u ||
        request.candidate_count > BGC_WASM_MAX_CANDIDATES ||
        request.scores_capacity < request.candidate_count ||
        request.scores_capacity > BGC_WASM_MAX_CANDIDATES ||
        !bgc_wasm_make_array_range(
            &arena, request.candidates_offset, request.candidate_count,
            sizeof(bgc_wasm_candidate_v1), BGC_WASM_MAX_CANDIDATES,
            4u, 0, &candidate_range) ||
        !bgc_wasm_make_array_range(
            &arena, request.scores_offset, request.scores_capacity,
            sizeof(bgc_wasm_candidate_score_v1), BGC_WASM_MAX_CANDIDATES,
            4u, 0, &scores_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    all_ranges[0] = request_range;
    all_ranges[1] = result_range;
    all_ranges[2] = error_range;
    all_ranges[3] = candidate_range;
    all_ranges[4] = scores_range;
    if (!bgc_wasm_ranges_are_disjoint(all_ranges, 5u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    bgc_wasm_arena_clear(&arena, &error_range);
    prepare_choose_result(&arena, &result_range, &scores_range);

    if (!reserved_is_zero(request.reserved, 4u))
        return fail_with_message(
            BGC_WASM_STATUS_INVALID_ARGUMENT, &arena, &error_range,
            "choose request reserved fields must be zero");
    status = convert_position(&request.position, &position);
    if (status != BGC_WASM_STATUS_OK)
        return fail_with_message(
            status, &arena, &error_range, "choose position is invalid");
    status = convert_settings(&request.settings, &settings);
    if (status != BGC_WASM_STATUS_OK)
        return fail_with_message(
            status, &arena, &error_range, "choose settings are invalid");

    for (index = 0u; index < request.candidate_count; index++) {
        bgc_wasm_candidate_v1 wire_candidate;
        bgc_wasm_range item_range = {
            candidate_range.offset +
                index * (uint32_t) sizeof(wire_candidate),
            (uint32_t) sizeof(wire_candidate),
            candidate_range.offset +
                (index + 1u) * (uint32_t) sizeof(wire_candidate)
        };
        bgc_wasm_arena_load(
            &arena, &item_range, &wire_candidate, sizeof(wire_candidate));
        status = convert_candidate(
            &wire_candidate, &scratch_candidates[index],
            scratch_steps[index]);
        if (status != BGC_WASM_STATUS_OK)
            return fail_with_message(
                status, &arena, &error_range,
                "candidate encoding is invalid");
    }
    if (engine == NULL)
        return fail_with_message(
            BGC_WASM_STATUS_NOT_READY, &arena, &error_range,
            "engine is not initialized");

    memset(scratch_scores, 0,
           sizeof(*scratch_scores) * request.candidate_count);
    native_status = bgc_engine_choose_turn(
        engine, &position, scratch_candidates, request.candidate_count,
        &settings, scratch_scores, request.candidate_count,
        &best_index, &native_error);
    if (native_status != BGC_STATUS_OK)
        return fail_with_adapter_error(
            native_status, &arena, &error_range, &native_error);
    if (best_index >= request.candidate_count)
        return fail_with_message(
            BGC_WASM_STATUS_EVALUATION_FAILED, &arena, &error_range,
            "native engine selected an invalid candidate");
    for (index = 0u; index < request.candidate_count; index++) {
        if (!isfinite(scratch_scores[index].score) ||
            !isfinite(scratch_scores[index].cubeless_score))
            return fail_with_message(
                BGC_WASM_STATUS_EVALUATION_FAILED, &arena, &error_range,
                "native engine returned a non-finite checker score");
    }
    for (index = 0u; index < request.candidate_count; index++) {
        bgc_wasm_candidate_score_v1 wire_score;
        bgc_wasm_range item_range = {
            scores_range.offset + index * (uint32_t) sizeof(wire_score),
            (uint32_t) sizeof(wire_score),
            scores_range.offset + (index + 1u) *
                (uint32_t) sizeof(wire_score)
        };
        wire_score.score = scratch_scores[index].score;
        wire_score.cubeless_score = scratch_scores[index].cubeless_score;
        bgc_wasm_arena_store(
            &arena, &item_range, &wire_score, sizeof(wire_score));
    }
    result.header.abi_version = BGC_WASM_ABI_VERSION;
    result.header.byte_size = (uint32_t) sizeof(result);
    result.selected_index = (uint32_t) best_index;
    result.score_count = request.candidate_count;
    bgc_wasm_arena_store(&arena, &result_range, &result, sizeof(result));
    return BGC_WASM_STATUS_OK;
}

int32_t
bgc_wasm_choose_turn(uint8_t *arena,
                     const uint32_t arena_size,
                     const uint32_t request_offset,
                     const uint32_t result_offset,
                     const uint32_t error_offset) {
    return bgc_wasm_choose_turn_with_engine(
        wrapper_state == BGC_WRAPPER_ACTIVE ? wrapper_engine : NULL,
        arena, arena_size, request_offset, result_offset, error_offset);
}

static int
analysis_board_valid(const bgc_board *board) {
    uint32_t white = board->bar.white + board->borne_off.white;
    uint32_t black = board->bar.black + board->borne_off.black;
    uint32_t point;
    for (point = 0; point < BGC_POINT_COUNT; point++) {
        if (board->points[point].white && board->points[point].black)
            return 0;
        white += board->points[point].white;
        black += board->points[point].black;
    }
    return white == BGC_CHECKERS_PER_PLAYER && black == BGC_CHECKERS_PER_PLAYER;
}

static int
analysis_output_valid(const bgc_checker_analysis *analysis,
                      const uint32_t capacity) {
    uint32_t index, previous;
    if (analysis->candidate_count < 1u || analysis->candidate_count > capacity ||
        analysis->played_index >= analysis->candidate_count ||
        analysis->legal_position_count < 1u ||
        analysis->legal_position_count > BGC_MAX_CANDIDATES ||
        analysis->evaluated_position_count != analysis->legal_position_count ||
        analysis->candidate_count > analysis->legal_position_count ||
        analysis->forced != (analysis->legal_position_count == 1u) ||
        (analysis->no_play != 0 && analysis->no_play != 1) ||
        (analysis->no_play && !analysis->forced) ||
        !isfinite(analysis->equity_loss) || analysis->equity_loss < 0.0f ||
        analysis->candidates[0].rank != 1u)
        return 0;
    for (index = 0; index < analysis->candidate_count; index++) {
        const bgc_analysis_candidate *candidate = &analysis->candidates[index];
        uint32_t segment_index;
        if (!analysis_board_valid(&candidate->board) ||
            !isfinite(candidate->equity) ||
            candidate->rank < 1u || candidate->rank > analysis->legal_position_count ||
            candidate->segment_count > BGC_MAX_TURN_STEPS ||
            (analysis->no_play ? candidate->segment_count != 0u : candidate->segment_count == 0u) ||
            candidate->tied_with_best !=
                (fabsf(analysis->candidates[0].equity - candidate->equity) <= 0.00001f) ||
            (index > 0u && (candidate->rank <= analysis->candidates[index - 1u].rank ||
                           candidate->equity > analysis->candidates[index - 1u].equity)))
            return 0;
        for (previous = 0; previous < index; previous++)
            if (memcmp(&candidate->board, &analysis->candidates[previous].board,
                       sizeof(candidate->board)) == 0)
                return 0;
        for (segment_index = 0; segment_index < candidate->segment_count; segment_index++) {
            const bgc_analysis_segment *segment = &candidate->segments[segment_index];
            if ((segment->from.kind != BGC_LOCATION_POINT && segment->from.kind != BGC_LOCATION_BAR) ||
                (segment->to.kind != BGC_LOCATION_POINT && segment->to.kind != BGC_LOCATION_BORNE_OFF) ||
                (segment->from.kind == BGC_LOCATION_POINT &&
                 (segment->from.point < 0 || segment->from.point >= BGC_POINT_COUNT)) ||
                (segment->to.kind == BGC_LOCATION_POINT &&
                 (segment->to.point < 0 || segment->to.point >= BGC_POINT_COUNT)) ||
                (segment->hit != 0 && segment->hit != 1))
                return 0;
        }
    }
    return fabsf(analysis->equity_loss -
        (analysis->candidates[0].equity -
         analysis->candidates[analysis->played_index].equity)) <= 0.00001f;
}

int32_t
bgc_wasm_analyze_checker_with_engine(bgc_engine *engine,
                                    uint8_t *arena_memory,
                                    const uint32_t arena_size,
                                    const uint32_t request_offset,
                                    const uint32_t result_offset,
                                    const uint32_t error_offset) {
    bgc_wasm_arena_view arena;
    bgc_wasm_range request_range, result_range, error_range, candidates_range;
    bgc_wasm_range ranges[4];
    bgc_wasm_analysis_request_v1 request;
    bgc_wasm_analysis_result_v1 result = {0};
    bgc_position position, expected_position;
    bgc_wasm_position_v1 expected_wire;
    bgc_candidate played;
    bgc_turn_step steps[BGC_MAX_TURN_STEPS];
    bgc_checker_analysis analysis;
    bgc_error native_error = {{0}};
    int32_t status;
    bgc_status native_status;
    uint32_t index;

    if (!bgc_wasm_arena_view_init(&arena, arena_memory, arena_size) ||
        !make_struct_range(&arena, request_offset, sizeof(request), &request_range) ||
        !make_struct_range(&arena, result_offset, sizeof(result), &result_range) ||
        !make_struct_range(&arena, error_offset, sizeof(bgc_wasm_error_v1), &error_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    ranges[0] = request_range;
    ranges[1] = result_range;
    ranges[2] = error_range;
    if (!bgc_wasm_ranges_are_disjoint(ranges, 3u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    bgc_wasm_arena_load(&arena, &request_range, &request, sizeof(request));
    status = request.header.abi_version != BGC_WASM_ANALYSIS_VERSION
        ? BGC_WASM_STATUS_UNSUPPORTED
        : request.header.byte_size != sizeof(request) ? BGC_WASM_STATUS_INVALID_ARGUMENT
        : BGC_WASM_STATUS_OK;
    if (status != BGC_WASM_STATUS_OK) {
        bgc_wasm_arena_clear(&arena, &error_range);
        return fail_with_message(status, &arena, &error_range, "unsupported analysis request header");
    }
    if (request.candidates_capacity < 1u ||
        request.candidates_capacity > BGC_WASM_ANALYSIS_MAX_RETURNED ||
        !bgc_wasm_make_array_range(&arena, request.candidates_offset,
                                  request.candidates_capacity,
                                  sizeof(bgc_wasm_analysis_candidate_v1),
                                  BGC_WASM_ANALYSIS_MAX_RETURNED, 4u, 0, &candidates_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    ranges[3] = candidates_range;
    if (!bgc_wasm_ranges_are_disjoint(ranges, 4u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    bgc_wasm_arena_clear(&arena, &error_range);
    bgc_wasm_arena_clear(&arena, &candidates_range);
    result.header.abi_version = BGC_WASM_ANALYSIS_VERSION;
    result.header.byte_size = sizeof(result);
    bgc_wasm_arena_store(&arena, &result_range, &result, sizeof(result));
    if (!reserved_is_zero(request.reserved, 3u) ||
        request.max_alternatives < 1u ||
        request.max_alternatives > BGC_WASM_ANALYSIS_MAX_ALTERNATIVES ||
        request.candidates_capacity < request.max_alternatives + 1u)
        return fail_with_message(BGC_WASM_STATUS_INVALID_ARGUMENT, &arena, &error_range,
                                 "analysis bounds or reserved fields are invalid");
    if (request.profile != BGC_WASM_ANALYSIS_QUICK_0PLY_V1)
        return fail_with_message(BGC_WASM_STATUS_UNSUPPORTED, &arena, &error_range,
                                 "analysis profile is unsupported");
    status = convert_position(&request.position, &position);
    if (status != BGC_WASM_STATUS_OK)
        return fail_with_message(status, &arena, &error_range, "analysis position is invalid");
    expected_wire = request.position;
    expected_wire.board = request.expected_board;
    status = convert_position(&expected_wire, &expected_position);
    if (status != BGC_WASM_STATUS_OK)
        return fail_with_message(status, &arena, &error_range, "expected board is invalid");
    if (request.played.step_count == 0u && request.played.reserved == 0u) {
        played.steps = NULL;
        played.step_count = 0u;
    } else {
        status = convert_candidate(&request.played, &played, steps);
        if (status != BGC_WASM_STATUS_OK)
            return fail_with_message(status, &arena, &error_range, "played turn encoding is invalid");
    }
    if (!engine)
        return fail_with_message(BGC_WASM_STATUS_NOT_READY, &arena, &error_range,
                                 "engine is not initialized");
    native_status = bgc_engine_analyze_checker(engine, &position, &played,
        &expected_position.board, request.profile, request.max_alternatives, &analysis, &native_error);
    if (native_status != BGC_STATUS_OK)
        return fail_with_adapter_error(native_status, &arena, &error_range, &native_error);
    if (!analysis_output_valid(&analysis, request.candidates_capacity))
        return fail_with_message(BGC_WASM_STATUS_EVALUATION_FAILED, &arena, &error_range,
                                 "native engine returned inconsistent analysis");
    for (index = 0; index < analysis.candidate_count; index++) {
        const bgc_analysis_candidate *native = &analysis.candidates[index];
        bgc_wasm_analysis_candidate_v1 wire = {0};
        bgc_wasm_range item = {
            candidates_range.offset + index * (uint32_t) sizeof(wire),
            sizeof(wire), candidates_range.offset + (index + 1u) * (uint32_t) sizeof(wire)
        };
        uint32_t point, segment_index;
        for (point = 0; point < BGC_POINT_COUNT; point++) {
            wire.board.points[point].white = native->board.points[point].white;
            wire.board.points[point].black = native->board.points[point].black;
        }
        wire.board.bar.white = native->board.bar.white;
        wire.board.bar.black = native->board.bar.black;
        wire.board.borne_off.white = native->board.borne_off.white;
        wire.board.borne_off.black = native->board.borne_off.black;
        wire.segment_count = native->segment_count;
        for (segment_index = 0; segment_index < native->segment_count; segment_index++) {
            const bgc_analysis_segment *segment = &native->segments[segment_index];
            wire.segments[segment_index].from.kind = (uint32_t) segment->from.kind;
            wire.segments[segment_index].from.point = segment->from.kind == BGC_LOCATION_POINT ? segment->from.point : 0;
            wire.segments[segment_index].to.kind = (uint32_t) segment->to.kind;
            wire.segments[segment_index].to.point = segment->to.kind == BGC_LOCATION_POINT ? segment->to.point : 0;
            wire.segments[segment_index].hit = (uint32_t) segment->hit;
        }
        wire.equity = native->equity;
        wire.rank = native->rank;
        wire.tied_with_best = (uint32_t) native->tied_with_best;
        bgc_wasm_arena_store(&arena, &item, &wire, sizeof(wire));
    }
    result.candidate_count = analysis.candidate_count;
    result.played_index = analysis.played_index;
    result.legal_position_count = analysis.legal_position_count;
    result.evaluated_position_count = analysis.evaluated_position_count;
    result.forced = (uint32_t) analysis.forced;
    result.no_play = (uint32_t) analysis.no_play;
    result.equity_loss = analysis.equity_loss;
    result.cubeful = 1u;
    result.deterministic = 1u;
    result.profile = request.profile;
    bgc_wasm_arena_store(&arena, &result_range, &result, sizeof(result));
    return BGC_WASM_STATUS_OK;
}

int32_t
bgc_wasm_analyze_checker(uint8_t *arena, const uint32_t arena_size,
                        const uint32_t request_offset, const uint32_t result_offset,
                        const uint32_t error_offset) {
    return bgc_wasm_analyze_checker_with_engine(
        wrapper_state == BGC_WRAPPER_ACTIVE ? wrapper_engine : NULL,
        arena, arena_size, request_offset, result_offset, error_offset);
}

int32_t
bgc_wasm_decide_cube_with_engine(bgc_engine *engine,
                                 uint8_t *arena_memory,
                                 const uint32_t arena_size,
                                 const uint32_t request_offset,
                                 const uint32_t result_offset,
                                 const uint32_t error_offset) {
    bgc_wasm_arena_view arena;
    bgc_wasm_range request_range;
    bgc_wasm_range result_range;
    bgc_wasm_range error_range;
    bgc_wasm_range ranges[3];
    bgc_wasm_cube_request_v1 request;
    bgc_wasm_cube_result_v1 result = {0};
    bgc_position position;
    bgc_settings settings;
    bgc_cube_action actions[BGC_WASM_MAX_CUBE_ACTIONS];
    bgc_cube_analysis analysis = {0};
    bgc_error native_error = {{0}};
    uint32_t index;
    int seen[BGC_WASM_MAX_CUBE_ACTIONS] = {0};
    int32_t status;
    bgc_status native_status;

    if (!bgc_wasm_arena_view_init(&arena, arena_memory, arena_size) ||
        !make_struct_range(&arena, request_offset, sizeof(request),
                           &request_range) ||
        !make_struct_range(&arena, result_offset, sizeof(result),
                           &result_range) ||
        !make_struct_range(&arena, error_offset, sizeof(bgc_wasm_error_v1),
                           &error_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    ranges[0] = request_range;
    ranges[1] = result_range;
    ranges[2] = error_range;
    if (!bgc_wasm_ranges_are_disjoint(ranges, 3u))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;

    bgc_wasm_arena_load(&arena, &request_range, &request, sizeof(request));
    bgc_wasm_arena_clear(&arena, &error_range);
    prepare_cube_result(&arena, &result_range);
    status = header_status(&request.header, sizeof(request));
    if (status != BGC_WASM_STATUS_OK)
        return fail_with_message(
            status, &arena, &error_range, "unsupported cube request header");
    if (!reserved_is_zero(request.reserved, 3u))
        return fail_with_message(
            BGC_WASM_STATUS_INVALID_ARGUMENT, &arena, &error_range,
            "cube request reserved fields must be zero");
    status = convert_position(&request.position, &position);
    if (status != BGC_WASM_STATUS_OK)
        return fail_with_message(
            status, &arena, &error_range, "cube position is invalid");
    status = convert_settings(&request.settings, &settings);
    if (status != BGC_WASM_STATUS_OK)
        return fail_with_message(
            status, &arena, &error_range, "cube settings are invalid");
    if (request.phase > BGC_WASM_CUBE_PHASE_RESPOND_TO_OFFER ||
        request.engine_player > BGC_WASM_PLAYER_BLACK ||
        request.legal_action_count < 1u ||
        request.legal_action_count > BGC_WASM_MAX_CUBE_ACTIONS)
        return fail_with_message(
            BGC_WASM_STATUS_INVALID_ARGUMENT, &arena, &error_range,
            "cube request values are invalid");
    for (index = 0u; index < request.legal_action_count; index++) {
        if (request.legal_actions[index] > BGC_WASM_CUBE_ACTION_BEAVER ||
            seen[request.legal_actions[index]])
            return fail_with_message(
                BGC_WASM_STATUS_INVALID_ARGUMENT, &arena, &error_range,
                "legal cube actions must be valid and unique");
        seen[request.legal_actions[index]] = 1;
        actions[index] = (bgc_cube_action) request.legal_actions[index];
    }
    if (engine == NULL)
        return fail_with_message(
            BGC_WASM_STATUS_NOT_READY, &arena, &error_range,
            "engine is not initialized");

    native_status = bgc_engine_decide_cube(
        engine, &position, (bgc_cube_decision_phase) request.phase,
        (bgc_player) request.engine_player, actions,
        request.legal_action_count, &settings, &analysis, &native_error);
    if (native_status != BGC_STATUS_OK)
        return fail_with_adapter_error(
            native_status, &arena, &error_range, &native_error);
    if (analysis.selected_index >= request.legal_action_count ||
        analysis.decision < BGC_CUBE_ACTION_DOUBLE ||
        analysis.decision > BGC_CUBE_ACTION_BEAVER ||
        analysis.decision != actions[analysis.selected_index])
        return fail_with_message(
            BGC_WASM_STATUS_EVALUATION_FAILED, &arena, &error_range,
            "native engine returned an invalid cube selection");
    if (analysis.evaluated &&
        (!isfinite(analysis.selected_action_equity) ||
         !isfinite(analysis.preoffer_optimal_equity) ||
         !isfinite(analysis.no_double_equity) ||
         !isfinite(analysis.double_take_equity) ||
         !isfinite(analysis.double_pass_equity)))
        return fail_with_message(
            BGC_WASM_STATUS_EVALUATION_FAILED, &arena, &error_range,
            "native engine returned a non-finite cube equity");

    result.header.abi_version = BGC_WASM_ABI_VERSION;
    result.header.byte_size = (uint32_t) sizeof(result);
    result.decision = (uint32_t) analysis.decision;
    result.selected_index = analysis.selected_index;
    result.evaluated = analysis.evaluated ? 1u : 0u;
    if (analysis.evaluated) {
        result.selected_action_equity = analysis.selected_action_equity;
        result.preoffer_optimal_equity = analysis.preoffer_optimal_equity;
        result.no_double_equity = analysis.no_double_equity;
        result.double_take_equity = analysis.double_take_equity;
        result.double_pass_equity = analysis.double_pass_equity;
    }
    bgc_wasm_arena_store(&arena, &result_range, &result, sizeof(result));
    return BGC_WASM_STATUS_OK;
}

int32_t
bgc_wasm_decide_cube(uint8_t *arena,
                     const uint32_t arena_size,
                     const uint32_t request_offset,
                     const uint32_t result_offset,
                     const uint32_t error_offset) {
    return bgc_wasm_decide_cube_with_engine(
        wrapper_state == BGC_WRAPPER_ACTIVE ? wrapper_engine : NULL,
        arena, arena_size, request_offset, result_offset, error_offset);
}

int32_t
bgc_wasm_reset_with_engine(bgc_engine *engine,
                           uint8_t *arena_memory,
                           const uint32_t arena_size,
                           const uint32_t error_offset) {
    bgc_wasm_arena_view arena;
    bgc_wasm_range error_range;
    bgc_error native_error = {{0}};
    bgc_status native_status;

    if (!bgc_wasm_arena_view_init(&arena, arena_memory, arena_size) ||
        !make_struct_range(&arena, error_offset,
                           sizeof(bgc_wasm_error_v1), &error_range))
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    bgc_wasm_arena_clear(&arena, &error_range);
    if (engine == NULL)
        return fail_with_message(
            BGC_WASM_STATUS_NOT_READY, &arena, &error_range,
            "engine is not initialized");
    native_status = bgc_engine_reset(engine, &native_error);
    if (native_status != BGC_STATUS_OK)
        return fail_with_adapter_error(
            native_status, &arena, &error_range, &native_error);
    return BGC_WASM_STATUS_OK;
}

int32_t
bgc_wasm_reset(uint8_t *arena,
               const uint32_t arena_size,
               const uint32_t error_offset) {
    return bgc_wasm_reset_with_engine(
        wrapper_state == BGC_WRAPPER_ACTIVE ? wrapper_engine : NULL,
        arena, arena_size, error_offset);
}

void
bgc_wasm_dispose(void) {
    if (wrapper_state == BGC_WRAPPER_ACTIVE && wrapper_engine != NULL)
        bgc_engine_dispose(wrapper_engine);
    wrapper_engine = NULL;
    wrapper_state = BGC_WRAPPER_FINISHED;
}
