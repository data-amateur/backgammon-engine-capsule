/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_wasm_abi.h"

#include <float.h>
#include <limits.h>
#include <stddef.h>
#include <string.h>

#define BGC_ASSERT_SIZE(type, expected) \
    _Static_assert(sizeof(type) == (expected), #type " has an unexpected size")
#define BGC_ASSERT_OFFSET(type, field, expected) \
    _Static_assert(offsetof(type, field) == (expected), \
                   #type "." #field " has an unexpected offset")

_Static_assert(CHAR_BIT == 8, "The ABI requires 8-bit bytes");
_Static_assert(sizeof(uint8_t) == 1, "The ABI requires an 8-bit uint8_t");
_Static_assert(sizeof(uint32_t) == 4, "The ABI requires a 32-bit uint32_t");
_Static_assert(sizeof(int32_t) == 4, "The ABI requires a 32-bit int32_t");
_Static_assert(sizeof(float) == 4, "The ABI requires a 32-bit float");
_Static_assert(FLT_RADIX == 2 && FLT_MANT_DIG == 24 && FLT_MAX_EXP == 128,
               "The ABI requires IEEE-754 binary32 floats");

BGC_ASSERT_SIZE(bgc_wasm_header_v1, 8);
BGC_ASSERT_OFFSET(bgc_wasm_header_v1, abi_version, 0);
BGC_ASSERT_OFFSET(bgc_wasm_header_v1, byte_size, 4);

BGC_ASSERT_SIZE(bgc_wasm_checker_counts_v1, 2);
BGC_ASSERT_OFFSET(bgc_wasm_checker_counts_v1, white, 0);
BGC_ASSERT_OFFSET(bgc_wasm_checker_counts_v1, black, 1);

BGC_ASSERT_SIZE(bgc_wasm_board_v1, 52);
BGC_ASSERT_OFFSET(bgc_wasm_board_v1, points, 0);
BGC_ASSERT_OFFSET(bgc_wasm_board_v1, bar, 48);
BGC_ASSERT_OFFSET(bgc_wasm_board_v1, borne_off, 50);

BGC_ASSERT_SIZE(bgc_wasm_cube_v1, 16);
BGC_ASSERT_OFFSET(bgc_wasm_cube_v1, value, 0);
BGC_ASSERT_OFFSET(bgc_wasm_cube_v1, owner, 4);
BGC_ASSERT_OFFSET(bgc_wasm_cube_v1, state, 8);
BGC_ASSERT_OFFSET(bgc_wasm_cube_v1, offered_by, 12);

BGC_ASSERT_SIZE(bgc_wasm_match_v1, 20);
BGC_ASSERT_OFFSET(bgc_wasm_match_v1, mode, 0);
BGC_ASSERT_OFFSET(bgc_wasm_match_v1, length, 4);
BGC_ASSERT_OFFSET(bgc_wasm_match_v1, score_white, 8);
BGC_ASSERT_OFFSET(bgc_wasm_match_v1, score_black, 12);
BGC_ASSERT_OFFSET(bgc_wasm_match_v1, crawford, 16);

BGC_ASSERT_SIZE(bgc_wasm_rules_v1, 20);
BGC_ASSERT_OFFSET(bgc_wasm_rules_v1, variation, 0);
BGC_ASSERT_OFFSET(bgc_wasm_rules_v1, jacoby, 4);
BGC_ASSERT_OFFSET(bgc_wasm_rules_v1, beavers, 8);
BGC_ASSERT_OFFSET(bgc_wasm_rules_v1, raccoons, 12);
BGC_ASSERT_OFFSET(bgc_wasm_rules_v1, automatic_doubles, 16);

BGC_ASSERT_SIZE(bgc_wasm_position_v1, 120);
BGC_ASSERT_OFFSET(bgc_wasm_position_v1, board, 0);
BGC_ASSERT_OFFSET(bgc_wasm_position_v1, player_on_roll, 52);
BGC_ASSERT_OFFSET(bgc_wasm_position_v1, dice, 56);
BGC_ASSERT_OFFSET(bgc_wasm_position_v1, cube, 64);
BGC_ASSERT_OFFSET(bgc_wasm_position_v1, match, 80);
BGC_ASSERT_OFFSET(bgc_wasm_position_v1, rules, 100);

BGC_ASSERT_SIZE(bgc_wasm_location_v1, 8);
BGC_ASSERT_OFFSET(bgc_wasm_location_v1, kind, 0);
BGC_ASSERT_OFFSET(bgc_wasm_location_v1, point, 4);

BGC_ASSERT_SIZE(bgc_wasm_turn_step_v1, 24);
BGC_ASSERT_OFFSET(bgc_wasm_turn_step_v1, from, 0);
BGC_ASSERT_OFFSET(bgc_wasm_turn_step_v1, to, 8);
BGC_ASSERT_OFFSET(bgc_wasm_turn_step_v1, die, 16);
BGC_ASSERT_OFFSET(bgc_wasm_turn_step_v1, hit, 20);

BGC_ASSERT_SIZE(bgc_wasm_candidate_v1, 104);
BGC_ASSERT_OFFSET(bgc_wasm_candidate_v1, step_count, 0);
BGC_ASSERT_OFFSET(bgc_wasm_candidate_v1, reserved, 4);
BGC_ASSERT_OFFSET(bgc_wasm_candidate_v1, steps, 8);

BGC_ASSERT_SIZE(bgc_wasm_settings_v1, 16);
BGC_ASSERT_OFFSET(bgc_wasm_settings_v1, strength, 0);
BGC_ASSERT_OFFSET(bgc_wasm_settings_v1, reserved, 4);

BGC_ASSERT_SIZE(bgc_wasm_candidate_score_v1, 8);
BGC_ASSERT_OFFSET(bgc_wasm_candidate_score_v1, score, 0);
BGC_ASSERT_OFFSET(bgc_wasm_candidate_score_v1, cubeless_score, 4);

BGC_ASSERT_SIZE(bgc_wasm_error_v1, 256);
BGC_ASSERT_OFFSET(bgc_wasm_error_v1, message, 0);

BGC_ASSERT_SIZE(bgc_wasm_init_request_v1, 32);
BGC_ASSERT_OFFSET(bgc_wasm_init_request_v1, header, 0);
BGC_ASSERT_OFFSET(bgc_wasm_init_request_v1, weights_path_offset, 8);
BGC_ASSERT_OFFSET(bgc_wasm_init_request_v1, weights_path_length, 12);
BGC_ASSERT_OFFSET(bgc_wasm_init_request_v1, match_equity_path_offset, 16);
BGC_ASSERT_OFFSET(bgc_wasm_init_request_v1, match_equity_path_length, 20);
BGC_ASSERT_OFFSET(bgc_wasm_init_request_v1, reserved, 24);

BGC_ASSERT_SIZE(bgc_wasm_choose_request_v1, 176);
BGC_ASSERT_OFFSET(bgc_wasm_choose_request_v1, header, 0);
BGC_ASSERT_OFFSET(bgc_wasm_choose_request_v1, position, 8);
BGC_ASSERT_OFFSET(bgc_wasm_choose_request_v1, candidates_offset, 128);
BGC_ASSERT_OFFSET(bgc_wasm_choose_request_v1, candidate_count, 132);
BGC_ASSERT_OFFSET(bgc_wasm_choose_request_v1, scores_offset, 136);
BGC_ASSERT_OFFSET(bgc_wasm_choose_request_v1, scores_capacity, 140);
BGC_ASSERT_OFFSET(bgc_wasm_choose_request_v1, settings, 144);
BGC_ASSERT_OFFSET(bgc_wasm_choose_request_v1, reserved, 160);

BGC_ASSERT_SIZE(bgc_wasm_choose_result_v1, 32);
BGC_ASSERT_OFFSET(bgc_wasm_choose_result_v1, header, 0);
BGC_ASSERT_OFFSET(bgc_wasm_choose_result_v1, selected_index, 8);
BGC_ASSERT_OFFSET(bgc_wasm_choose_result_v1, score_count, 12);
BGC_ASSERT_OFFSET(bgc_wasm_choose_result_v1, reserved, 16);

BGC_ASSERT_SIZE(bgc_wasm_cube_request_v1, 192);
BGC_ASSERT_OFFSET(bgc_wasm_cube_request_v1, header, 0);
BGC_ASSERT_OFFSET(bgc_wasm_cube_request_v1, position, 8);
BGC_ASSERT_OFFSET(bgc_wasm_cube_request_v1, phase, 128);
BGC_ASSERT_OFFSET(bgc_wasm_cube_request_v1, engine_player, 132);
BGC_ASSERT_OFFSET(bgc_wasm_cube_request_v1, legal_action_count, 136);
BGC_ASSERT_OFFSET(bgc_wasm_cube_request_v1, legal_actions, 140);
BGC_ASSERT_OFFSET(bgc_wasm_cube_request_v1, settings, 164);
BGC_ASSERT_OFFSET(bgc_wasm_cube_request_v1, reserved, 180);

BGC_ASSERT_SIZE(bgc_wasm_cube_result_v1, 64);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, header, 0);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, decision, 8);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, selected_index, 12);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, evaluated, 16);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, reserved0, 20);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, selected_action_equity, 24);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, preoffer_optimal_equity, 28);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, no_double_equity, 32);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, double_take_equity, 36);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, double_pass_equity, 40);
BGC_ASSERT_OFFSET(bgc_wasm_cube_result_v1, reserved, 44);

BGC_ASSERT_SIZE(bgc_wasm_abi_descriptor_v1, 128);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, header, 0);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, endianness_marker, 8);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, pointer_width, 12);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, header_size, 16);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, checker_counts_size, 20);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, board_size, 24);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, cube_size, 28);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, match_size, 32);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, rules_size, 36);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, position_size, 40);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, location_size, 44);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, turn_step_size, 48);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, candidate_size, 52);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, settings_size, 56);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, candidate_score_size, 60);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, error_size, 64);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, init_request_size, 68);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, choose_request_size, 72);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, choose_result_size, 76);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, cube_request_size, 80);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, cube_result_size, 84);
BGC_ASSERT_OFFSET(bgc_wasm_abi_descriptor_v1, reserved, 88);

uint32_t
bgc_wasm_abi_version(void) {
    return BGC_WASM_ABI_VERSION;
}

uint32_t
bgc_wasm_abi_descriptor_size(void) {
    return (uint32_t) sizeof(bgc_wasm_abi_descriptor_v1);
}

int32_t
bgc_wasm_get_abi_descriptor(void *output, uint32_t output_size) {
    bgc_wasm_abi_descriptor_v1 descriptor = {0};

    if (output == NULL || output_size < sizeof(descriptor)) {
        return BGC_WASM_STATUS_INVALID_ARGUMENT;
    }

    descriptor.header.abi_version = BGC_WASM_ABI_VERSION;
    descriptor.header.byte_size = (uint32_t) sizeof(descriptor);
    descriptor.endianness_marker = BGC_WASM_ABI_ENDIANNESS_MARKER;
    descriptor.pointer_width = (uint32_t) sizeof(void *);
    descriptor.header_size = (uint32_t) sizeof(bgc_wasm_header_v1);
    descriptor.checker_counts_size =
        (uint32_t) sizeof(bgc_wasm_checker_counts_v1);
    descriptor.board_size = (uint32_t) sizeof(bgc_wasm_board_v1);
    descriptor.cube_size = (uint32_t) sizeof(bgc_wasm_cube_v1);
    descriptor.match_size = (uint32_t) sizeof(bgc_wasm_match_v1);
    descriptor.rules_size = (uint32_t) sizeof(bgc_wasm_rules_v1);
    descriptor.position_size = (uint32_t) sizeof(bgc_wasm_position_v1);
    descriptor.location_size = (uint32_t) sizeof(bgc_wasm_location_v1);
    descriptor.turn_step_size = (uint32_t) sizeof(bgc_wasm_turn_step_v1);
    descriptor.candidate_size = (uint32_t) sizeof(bgc_wasm_candidate_v1);
    descriptor.settings_size = (uint32_t) sizeof(bgc_wasm_settings_v1);
    descriptor.candidate_score_size =
        (uint32_t) sizeof(bgc_wasm_candidate_score_v1);
    descriptor.error_size = (uint32_t) sizeof(bgc_wasm_error_v1);
    descriptor.init_request_size =
        (uint32_t) sizeof(bgc_wasm_init_request_v1);
    descriptor.choose_request_size =
        (uint32_t) sizeof(bgc_wasm_choose_request_v1);
    descriptor.choose_result_size =
        (uint32_t) sizeof(bgc_wasm_choose_result_v1);
    descriptor.cube_request_size =
        (uint32_t) sizeof(bgc_wasm_cube_request_v1);
    descriptor.cube_result_size =
        (uint32_t) sizeof(bgc_wasm_cube_result_v1);

    memcpy(output, &descriptor, sizeof(descriptor));
    return BGC_WASM_STATUS_OK;
}
