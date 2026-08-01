/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef GNUBG_CAPSULE_WASM_ABI_H
#define GNUBG_CAPSULE_WASM_ABI_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* This version is independent of both BEP and the GNUbg release version. */
#define BGC_WASM_ABI_MAJOR 1u
#define BGC_WASM_ABI_MINOR 0u
#define BGC_WASM_ABI_VERSION \
    ((BGC_WASM_ABI_MAJOR << 16u) | BGC_WASM_ABI_MINOR)
#define BGC_WASM_ABI_ENDIANNESS_MARKER UINT32_C(0x01020304)

#define BGC_WASM_POINT_COUNT 24u
#define BGC_WASM_MAX_TURN_STEPS 4u
#define BGC_WASM_MAX_CANDIDATES 4096u
#define BGC_WASM_MAX_CUBE_ACTIONS 6u
#define BGC_WASM_MAX_PATH_BYTES 1024u
#define BGC_WASM_ERROR_MESSAGE_LENGTH 256u
#define BGC_WASM_MAX_ARENA_BYTES UINT32_C(524288)

/* Explicit wire values. Never expose a C enum's implementation-defined size. */
#define BGC_WASM_STATUS_OK INT32_C(0)
#define BGC_WASM_STATUS_INVALID_ARGUMENT INT32_C(1)
#define BGC_WASM_STATUS_INVALID_POSITION INT32_C(2)
#define BGC_WASM_STATUS_ILLEGAL_TURN INT32_C(3)
#define BGC_WASM_STATUS_NOT_READY INT32_C(4)
#define BGC_WASM_STATUS_INITIALIZATION_FAILED INT32_C(5)
#define BGC_WASM_STATUS_EVALUATION_FAILED INT32_C(6)
#define BGC_WASM_STATUS_UNSUPPORTED INT32_C(7)

#define BGC_WASM_PLAYER_NONE INT32_C(-1)
#define BGC_WASM_PLAYER_WHITE UINT32_C(0)
#define BGC_WASM_PLAYER_BLACK UINT32_C(1)

#define BGC_WASM_LOCATION_POINT UINT32_C(0)
#define BGC_WASM_LOCATION_BAR UINT32_C(1)
#define BGC_WASM_LOCATION_BORNE_OFF UINT32_C(2)

#define BGC_WASM_MATCH_MODE_MONEY UINT32_C(0)
#define BGC_WASM_MATCH_MODE_MATCH UINT32_C(1)

#define BGC_WASM_CUBE_STATE_AVAILABLE UINT32_C(0)
#define BGC_WASM_CUBE_STATE_OFFERED UINT32_C(1)
#define BGC_WASM_CUBE_STATE_ACCEPTED UINT32_C(2)
#define BGC_WASM_CUBE_STATE_DECLINED UINT32_C(3)

#define BGC_WASM_CRAWFORD_NONE UINT32_C(0)
#define BGC_WASM_CRAWFORD_GAME UINT32_C(1)
#define BGC_WASM_CRAWFORD_POST UINT32_C(2)

#define BGC_WASM_VARIATION_STANDARD UINT32_C(0)

#define BGC_WASM_STRENGTH_BEGINNER UINT32_C(0)
#define BGC_WASM_STRENGTH_CASUAL UINT32_C(1)
#define BGC_WASM_STRENGTH_INTERMEDIATE UINT32_C(2)
#define BGC_WASM_STRENGTH_EXPERT UINT32_C(3)
#define BGC_WASM_STRENGTH_MAXIMUM UINT32_C(4)

#define BGC_WASM_CUBE_PHASE_CONSIDER_OFFER UINT32_C(0)
#define BGC_WASM_CUBE_PHASE_RESPOND_TO_OFFER UINT32_C(1)

#define BGC_WASM_CUBE_ACTION_DOUBLE UINT32_C(0)
#define BGC_WASM_CUBE_ACTION_NO_DOUBLE UINT32_C(1)
#define BGC_WASM_CUBE_ACTION_TOO_GOOD UINT32_C(2)
#define BGC_WASM_CUBE_ACTION_TAKE UINT32_C(3)
#define BGC_WASM_CUBE_ACTION_PASS UINT32_C(4)
#define BGC_WASM_CUBE_ACTION_BEAVER UINT32_C(5)

typedef struct {
    uint32_t abi_version;
    uint32_t byte_size;
} bgc_wasm_header_v1;

typedef struct {
    uint8_t white;
    uint8_t black;
} bgc_wasm_checker_counts_v1;

typedef struct {
    bgc_wasm_checker_counts_v1 points[BGC_WASM_POINT_COUNT];
    bgc_wasm_checker_counts_v1 bar;
    bgc_wasm_checker_counts_v1 borne_off;
} bgc_wasm_board_v1;

typedef struct {
    int32_t value;
    int32_t owner;
    uint32_t state;
    int32_t offered_by;
} bgc_wasm_cube_v1;

typedef struct {
    uint32_t mode;
    int32_t length;
    uint32_t score_white;
    uint32_t score_black;
    uint32_t crawford;
} bgc_wasm_match_v1;

typedef struct {
    uint32_t variation;
    uint32_t jacoby;
    uint32_t beavers;
    uint32_t raccoons;
    uint32_t automatic_doubles;
} bgc_wasm_rules_v1;

typedef struct {
    bgc_wasm_board_v1 board;
    uint32_t player_on_roll;
    uint32_t dice[2];
    bgc_wasm_cube_v1 cube;
    bgc_wasm_match_v1 match;
    bgc_wasm_rules_v1 rules;
} bgc_wasm_position_v1;

typedef struct {
    uint32_t kind;
    int32_t point;
} bgc_wasm_location_v1;

typedef struct {
    bgc_wasm_location_v1 from;
    bgc_wasm_location_v1 to;
    uint32_t die;
    uint32_t hit;
} bgc_wasm_turn_step_v1;

/* Four inline steps avoid native pointer graphs at the JavaScript boundary. */
typedef struct {
    uint32_t step_count;
    uint32_t reserved;
    bgc_wasm_turn_step_v1 steps[BGC_WASM_MAX_TURN_STEPS];
} bgc_wasm_candidate_v1;

typedef struct {
    uint32_t strength;
    uint32_t reserved[3];
} bgc_wasm_settings_v1;

typedef struct {
    float score;
    float cubeless_score;
} bgc_wasm_candidate_score_v1;

/* UTF-8, NUL-terminated when nonempty. This output buffer is not a request. */
typedef struct {
    uint8_t message[BGC_WASM_ERROR_MESSAGE_LENGTH];
} bgc_wasm_error_v1;

/*
 * Arena contract for all future call exports:
 * - Every offset is a byte offset relative to one caller-owned arena. Offset
 *   zero is valid for a nonempty range; it is not a null sentinel.
 * - The arena base and request/result/typed struct/array offsets are 4-byte
 *   aligned. UTF-8 path byte ranges require only byte alignment.
 * - Arena size is 1..BGC_WASM_MAX_ARENA_BYTES.
 * - Every offset-plus-size and count-times-element-size calculation is checked
 *   for overflow and must remain wholly inside the arena.
 * - All nonempty ranges referenced by one call are pairwise disjoint. Empty
 *   ranges use both offset zero and length/count zero.
 * - Both init paths are required, contain 1..BGC_WASM_MAX_PATH_BYTES valid
 *   UTF-8 bytes, exclude a terminating NUL, and contain no embedded NUL. The
 *   wrapper copies each range and appends the C terminator itself.
 * - Unused inline turn steps and unused cube-action slots are ignored.
 * - Calls are serial and non-reentrant in one non-pthread Worker. The wrapper
 *   never retains an arena pointer after a call.
 */
typedef struct {
    bgc_wasm_header_v1 header;
    uint32_t weights_path_offset;
    uint32_t weights_path_length;
    uint32_t match_equity_path_offset;
    uint32_t match_equity_path_length;
    uint32_t reserved[2];
} bgc_wasm_init_request_v1;

typedef struct {
    bgc_wasm_header_v1 header;
    bgc_wasm_position_v1 position;
    uint32_t candidates_offset;
    uint32_t candidate_count;
    uint32_t scores_offset;
    uint32_t scores_capacity;
    bgc_wasm_settings_v1 settings;
    uint32_t reserved[4];
} bgc_wasm_choose_request_v1;

typedef struct {
    bgc_wasm_header_v1 header;
    uint32_t selected_index;
    uint32_t score_count;
    uint32_t reserved[4];
} bgc_wasm_choose_result_v1;

typedef struct {
    bgc_wasm_header_v1 header;
    bgc_wasm_position_v1 position;
    uint32_t phase;
    uint32_t engine_player;
    uint32_t legal_action_count;
    uint32_t legal_actions[BGC_WASM_MAX_CUBE_ACTIONS];
    bgc_wasm_settings_v1 settings;
    uint32_t reserved[3];
} bgc_wasm_cube_request_v1;

typedef struct {
    bgc_wasm_header_v1 header;
    uint32_t decision;
    uint32_t selected_index;
    uint32_t evaluated;
    uint32_t reserved0;
    float selected_action_equity;
    float preoffer_optimal_equity;
    float no_double_equity;
    float double_take_equity;
    float double_pass_equity;
    uint32_t reserved[5];
} bgc_wasm_cube_result_v1;

/* Read once at startup. The host must refuse layouts it does not recognize. */
typedef struct {
    bgc_wasm_header_v1 header;
    uint32_t endianness_marker;
    uint32_t pointer_width;
    uint32_t header_size;
    uint32_t checker_counts_size;
    uint32_t board_size;
    uint32_t cube_size;
    uint32_t match_size;
    uint32_t rules_size;
    uint32_t position_size;
    uint32_t location_size;
    uint32_t turn_step_size;
    uint32_t candidate_size;
    uint32_t settings_size;
    uint32_t candidate_score_size;
    uint32_t error_size;
    uint32_t init_request_size;
    uint32_t choose_request_size;
    uint32_t choose_result_size;
    uint32_t cube_request_size;
    uint32_t cube_result_size;
    uint32_t reserved[10];
} bgc_wasm_abi_descriptor_v1;

uint32_t bgc_wasm_abi_version(void);
uint32_t bgc_wasm_abi_descriptor_size(void);
int32_t bgc_wasm_get_abi_descriptor(void *output, uint32_t output_size);

/*
 * The wrapper owns its engine. Initialization may reach the native evaluator
 * only once; dispose is terminal and a fresh Worker is required to re-init.
 */
uint8_t *bgc_wasm_alloc(uint32_t byte_size);
void bgc_wasm_free(uint8_t *memory);

int32_t bgc_wasm_init(
    uint8_t *arena,
    uint32_t arena_size,
    uint32_t request_offset,
    uint32_t error_offset
);

int32_t bgc_wasm_choose_turn(
    uint8_t *arena,
    uint32_t arena_size,
    uint32_t request_offset,
    uint32_t result_offset,
    uint32_t error_offset
);

int32_t bgc_wasm_decide_cube(
    uint8_t *arena,
    uint32_t arena_size,
    uint32_t request_offset,
    uint32_t result_offset,
    uint32_t error_offset
);

int32_t bgc_wasm_reset(
    uint8_t *arena,
    uint32_t arena_size,
    uint32_t error_offset
);

void bgc_wasm_dispose(void);

#ifdef __cplusplus
}
#endif

#endif
