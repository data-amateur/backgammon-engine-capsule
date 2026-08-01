/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_wasm_abi.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define TEST_ARENA_SIZE UINT32_C(4096)

#define INIT_REQUEST_OFFSET UINT32_C(0)
#define INIT_ERROR_OFFSET UINT32_C(64)
#define INIT_WEIGHTS_OFFSET UINT32_C(512)
#define INIT_MATCH_EQUITY_OFFSET UINT32_C(1536)

#define CHOOSE_REQUEST_OFFSET UINT32_C(0)
#define CHOOSE_CANDIDATE_OFFSET UINT32_C(256)
#define CHOOSE_SCORES_OFFSET UINT32_C(512)
#define CHOOSE_RESULT_OFFSET UINT32_C(768)
#define CHOOSE_ERROR_OFFSET UINT32_C(1024)
#define CHOOSE_SCORE_CAPACITY UINT32_C(2)

_Static_assert(INIT_ERROR_OFFSET >= sizeof(bgc_wasm_init_request_v1),
               "init request and error output must not overlap");
_Static_assert(INIT_WEIGHTS_OFFSET >=
                   INIT_ERROR_OFFSET + sizeof(bgc_wasm_error_v1),
               "init error output and weights path must not overlap");
_Static_assert(INIT_MATCH_EQUITY_OFFSET >=
                   INIT_WEIGHTS_OFFSET + BGC_WASM_MAX_PATH_BYTES,
               "the maximum-length init paths must not overlap");
_Static_assert(TEST_ARENA_SIZE >=
                   INIT_MATCH_EQUITY_OFFSET + BGC_WASM_MAX_PATH_BYTES,
               "the init layout must fit the test arena");
_Static_assert(CHOOSE_CANDIDATE_OFFSET >=
                   sizeof(bgc_wasm_choose_request_v1),
               "choose request and candidate must not overlap");
_Static_assert(CHOOSE_SCORES_OFFSET >=
                   CHOOSE_CANDIDATE_OFFSET +
                       sizeof(bgc_wasm_candidate_v1),
               "candidate and score output must not overlap");
_Static_assert(CHOOSE_RESULT_OFFSET >=
                   CHOOSE_SCORES_OFFSET +
                       CHOOSE_SCORE_CAPACITY *
                           sizeof(bgc_wasm_candidate_score_v1),
               "score and result outputs must not overlap");
_Static_assert(CHOOSE_ERROR_OFFSET >=
                   CHOOSE_RESULT_OFFSET + sizeof(bgc_wasm_choose_result_v1),
               "choose result and error outputs must not overlap");
_Static_assert(TEST_ARENA_SIZE >=
                   CHOOSE_ERROR_OFFSET + sizeof(bgc_wasm_error_v1),
               "the choose layout must fit the test arena");

static int
check(const int condition, const char *description)
{
    if (condition)
        return 1;
    fprintf(stderr, "FAIL public wrapper smoke: %s\n", description);
    return 0;
}

static int
bytes_are_zero(const void *memory, const size_t byte_count)
{
    const uint8_t *bytes = memory;
    size_t index;

    for (index = 0u; index < byte_count; index++) {
        if (bytes[index] != 0u)
            return 0;
    }
    return 1;
}

static int
error_is_clear(const uint8_t *arena, const uint32_t offset)
{
    bgc_wasm_error_v1 error;

    memcpy(&error, arena + offset, sizeof(error));
    return bytes_are_zero(&error, sizeof(error));
}

static int
error_is_well_formed_message(const uint8_t *arena, const uint32_t offset)
{
    bgc_wasm_error_v1 error;
    size_t terminator;
    size_t index;

    memcpy(&error, arena + offset, sizeof(error));
    for (terminator = 0u;
         terminator < BGC_WASM_ERROR_MESSAGE_LENGTH;
         terminator++) {
        if (error.message[terminator] == 0u)
            break;
    }
    if (terminator == 0u || terminator == BGC_WASM_ERROR_MESSAGE_LENGTH)
        return 0;
    for (index = terminator + 1u;
         index < BGC_WASM_ERROR_MESSAGE_LENGTH;
         index++) {
        if (error.message[index] != 0u)
            return 0;
    }
    return 1;
}

static int
header_is_current(const bgc_wasm_header_v1 *header,
                  const uint32_t expected_size)
{
    return header->abi_version == BGC_WASM_ABI_VERSION &&
        header->byte_size == expected_size;
}

static int
make_asset_path(char output[BGC_WASM_MAX_PATH_BYTES + 1u],
                const char *source_root,
                const char *suffix)
{
    const int written = snprintf(
        output, BGC_WASM_MAX_PATH_BYTES + 1u, "%s/%s",
        source_root, suffix);

    return written > 0 && written <= (int) BGC_WASM_MAX_PATH_BYTES;
}

static int
prepare_init_arena(uint8_t *arena,
                   const char *weights_path,
                   const char *match_equity_path)
{
    bgc_wasm_init_request_v1 request = {0};
    const size_t weights_length = strlen(weights_path);
    const size_t match_equity_length = strlen(match_equity_path);

    if (weights_length == 0u ||
        weights_length > BGC_WASM_MAX_PATH_BYTES ||
        match_equity_length == 0u ||
        match_equity_length > BGC_WASM_MAX_PATH_BYTES)
        return 0;

    memset(arena, 0xa5, TEST_ARENA_SIZE);
    request.header.abi_version = BGC_WASM_ABI_VERSION;
    request.header.byte_size = (uint32_t) sizeof(request);
    request.weights_path_offset = INIT_WEIGHTS_OFFSET;
    request.weights_path_length = (uint32_t) weights_length;
    request.match_equity_path_offset = INIT_MATCH_EQUITY_OFFSET;
    request.match_equity_path_length = (uint32_t) match_equity_length;
    memcpy(arena + INIT_REQUEST_OFFSET, &request, sizeof(request));
    memcpy(arena + INIT_WEIGHTS_OFFSET, weights_path, weights_length);
    memcpy(arena + INIT_MATCH_EQUITY_OFFSET,
           match_equity_path, match_equity_length);
    return 1;
}

static void
prepare_choose_arena(uint8_t *arena)
{
    bgc_wasm_choose_request_v1 request = {0};
    bgc_wasm_candidate_v1 candidate = {0};

    memset(arena, 0xa5, TEST_ARENA_SIZE);

    request.header.abi_version = BGC_WASM_ABI_VERSION;
    request.header.byte_size = (uint32_t) sizeof(request);
    request.position.board.bar.white = 1u;
    request.position.board.borne_off.white = 14u;
    request.position.board.points[21].black = 1u;
    request.position.board.points[18].black = 2u;
    request.position.board.points[15].black = 2u;
    request.position.board.borne_off.black = 10u;
    request.position.player_on_roll = BGC_WASM_PLAYER_WHITE;
    request.position.dice[0] = 3u;
    request.position.dice[1] = 6u;
    request.position.cube.value = 1;
    request.position.cube.owner = BGC_WASM_PLAYER_NONE;
    request.position.cube.state = BGC_WASM_CUBE_STATE_AVAILABLE;
    request.position.cube.offered_by = BGC_WASM_PLAYER_NONE;
    request.position.match.mode = BGC_WASM_MATCH_MODE_MONEY;
    request.position.match.length = 0;
    request.position.match.crawford = BGC_WASM_CRAWFORD_NONE;
    request.position.rules.variation = BGC_WASM_VARIATION_STANDARD;
    request.candidates_offset = CHOOSE_CANDIDATE_OFFSET;
    request.candidate_count = 1u;
    request.scores_offset = CHOOSE_SCORES_OFFSET;
    request.scores_capacity = CHOOSE_SCORE_CAPACITY;
    request.settings.strength = BGC_WASM_STRENGTH_EXPERT;

    candidate.step_count = 1u;
    candidate.steps[0].from.kind = BGC_WASM_LOCATION_BAR;
    candidate.steps[0].from.point = 0;
    candidate.steps[0].to.kind = BGC_WASM_LOCATION_POINT;
    candidate.steps[0].to.point = 21;
    candidate.steps[0].die = 3u;
    candidate.steps[0].hit = 1u;

    memcpy(arena + CHOOSE_REQUEST_OFFSET, &request, sizeof(request));
    memcpy(arena + CHOOSE_CANDIDATE_OFFSET,
           &candidate, sizeof(candidate));
}

static int
expect_successful_choose(const uint8_t *arena)
{
    bgc_wasm_choose_result_v1 result;
    bgc_wasm_candidate_score_v1 scores[CHOOSE_SCORE_CAPACITY];

    memcpy(&result, arena + CHOOSE_RESULT_OFFSET, sizeof(result));
    memcpy(scores, arena + CHOOSE_SCORES_OFFSET, sizeof(scores));
    return check(
               header_is_current(&result.header,
                                 (uint32_t) sizeof(result)),
               "successful choose result has the current header") &&
        check(result.selected_index == 0u && result.score_count == 1u,
              "successful choose selects the sole legal candidate") &&
        check(bytes_are_zero(result.reserved, sizeof(result.reserved)),
              "successful choose leaves result reserved fields zero") &&
        check(isfinite(scores[0].score) &&
                  isfinite(scores[0].cubeless_score),
              "successful choose returns finite checker scores") &&
        check(bytes_are_zero(&scores[1], sizeof(scores[1])),
              "successful choose clears unused score capacity") &&
        check(error_is_clear(arena, CHOOSE_ERROR_OFFSET),
              "successful choose clears the complete error output");
}

static int
expect_not_ready_choose_outputs(const uint8_t *arena)
{
    bgc_wasm_choose_result_v1 result;
    bgc_wasm_candidate_score_v1 scores[CHOOSE_SCORE_CAPACITY];

    memcpy(&result, arena + CHOOSE_RESULT_OFFSET, sizeof(result));
    memcpy(scores, arena + CHOOSE_SCORES_OFFSET, sizeof(scores));
    return check(
               header_is_current(&result.header,
                                 (uint32_t) sizeof(result)),
               "failed choose retains the current result header") &&
        check(result.selected_index == 0u && result.score_count == 0u &&
                  bytes_are_zero(result.reserved, sizeof(result.reserved)),
              "failed choose does not publish a partial selection") &&
        check(bytes_are_zero(scores, sizeof(scores)),
              "failed choose clears the full score capacity") &&
        check(error_is_well_formed_message(arena, CHOOSE_ERROR_OFFSET),
              "failed choose publishes one bounded, zero-tailed error");
}

int
main(int argc, char **argv)
{
    char weights_path[BGC_WASM_MAX_PATH_BYTES + 1u];
    char match_equity_path[BGC_WASM_MAX_PATH_BYTES + 1u];
    uint8_t *arena = NULL;
    int exit_status = EXIT_FAILURE;
    int32_t status;

    if (argc != 2) {
        fprintf(stderr,
                "Usage: %s <authenticated-gnubg-source-directory>\n",
                argv[0]);
        return EXIT_FAILURE;
    }
    if (!make_asset_path(weights_path, argv[1], "gnubg.weights") ||
        !make_asset_path(match_equity_path, argv[1],
                         "met/Kazaross-XG2.xml")) {
        fprintf(stderr, "GNUbg source path exceeds the WASM ABI limit\n");
        return EXIT_FAILURE;
    }

    if (!check(bgc_wasm_alloc(0u) == NULL,
               "zero-byte arena allocation is rejected") ||
        !check(bgc_wasm_alloc(BGC_WASM_MAX_ARENA_BYTES + 1u) == NULL,
               "oversize arena allocation is rejected"))
        return EXIT_FAILURE;
    bgc_wasm_free(NULL);

    arena = bgc_wasm_alloc(TEST_ARENA_SIZE);
    if (!check(arena != NULL, "test arena allocation succeeds"))
        return EXIT_FAILURE;

    if (!check(prepare_init_arena(
                   arena, weights_path, match_equity_path),
               "authenticated asset paths fit the init arena"))
        goto cleanup;
    status = bgc_wasm_init(
        arena, TEST_ARENA_SIZE, INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    if (!check(status == BGC_WASM_STATUS_OK,
               "public initialization succeeds with authenticated assets") ||
        !check(error_is_clear(arena, INIT_ERROR_OFFSET),
               "successful initialization clears the complete error output"))
        goto cleanup;

    if (!check(prepare_init_arena(
                   arena, weights_path, match_equity_path),
               "duplicate-init paths fit the arena"))
        goto cleanup;
    status = bgc_wasm_init(
        arena, TEST_ARENA_SIZE, INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    if (!check(status == BGC_WASM_STATUS_INITIALIZATION_FAILED,
               "duplicate initialization is rejected") ||
        !check(error_is_well_formed_message(arena, INIT_ERROR_OFFSET),
               "duplicate initialization publishes a bounded error"))
        goto cleanup;

    prepare_choose_arena(arena);
    status = bgc_wasm_choose_turn(
        arena, TEST_ARENA_SIZE, CHOOSE_REQUEST_OFFSET,
        CHOOSE_RESULT_OFFSET, CHOOSE_ERROR_OFFSET);
    if (!check(status == BGC_WASM_STATUS_OK,
               "duplicate initialization does not disturb the active engine") ||
        !expect_successful_choose(arena))
        goto cleanup;

    memset(arena + CHOOSE_ERROR_OFFSET, 0xa5,
           sizeof(bgc_wasm_error_v1));
    status = bgc_wasm_reset(
        arena, TEST_ARENA_SIZE, CHOOSE_ERROR_OFFSET);
    if (!check(status == BGC_WASM_STATUS_OK,
               "public reset succeeds while the engine is active") ||
        !check(error_is_clear(arena, CHOOSE_ERROR_OFFSET),
               "successful reset clears the complete error output"))
        goto cleanup;

    bgc_wasm_dispose();
    bgc_wasm_dispose();

    prepare_choose_arena(arena);
    status = bgc_wasm_choose_turn(
        arena, TEST_ARENA_SIZE, CHOOSE_REQUEST_OFFSET,
        CHOOSE_RESULT_OFFSET, CHOOSE_ERROR_OFFSET);
    if (!check(status == BGC_WASM_STATUS_NOT_READY,
               "checker decisions are not ready after disposal") ||
        !expect_not_ready_choose_outputs(arena))
        goto cleanup;

    memset(arena + CHOOSE_ERROR_OFFSET, 0xa5,
           sizeof(bgc_wasm_error_v1));
    status = bgc_wasm_reset(
        arena, TEST_ARENA_SIZE, CHOOSE_ERROR_OFFSET);
    if (!check(status == BGC_WASM_STATUS_NOT_READY,
               "reset is not ready after disposal") ||
        !check(error_is_well_formed_message(arena, CHOOSE_ERROR_OFFSET),
               "post-dispose reset publishes a bounded error"))
        goto cleanup;

    if (!check(prepare_init_arena(
                   arena, weights_path, match_equity_path),
               "terminal-init paths fit the arena"))
        goto cleanup;
    status = bgc_wasm_init(
        arena, TEST_ARENA_SIZE, INIT_REQUEST_OFFSET, INIT_ERROR_OFFSET);
    if (!check(status == BGC_WASM_STATUS_INITIALIZATION_FAILED,
               "disposal makes public initialization terminal") ||
        !check(error_is_well_formed_message(arena, INIT_ERROR_OFFSET),
               "terminal initialization publishes a bounded error"))
        goto cleanup;

    printf("GNUbg real public-wrapper smoke test passed\n");
    exit_status = EXIT_SUCCESS;

cleanup:
    bgc_wasm_dispose();
    bgc_wasm_free(arena);
    return exit_status;
}
