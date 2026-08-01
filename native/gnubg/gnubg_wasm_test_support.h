/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef GNUBG_CAPSULE_WASM_TEST_SUPPORT_H
#define GNUBG_CAPSULE_WASM_TEST_SUPPORT_H

#include <stddef.h>

#include "gnubg_adapter.h"

/*
 * Re-evaluate a successful direct adapter call through the arena bridge and
 * require bit-for-bit identical outputs. Each helper prints one diagnostic on
 * failure and returns nonzero on success so the native golden runner can fold
 * it into its own failure count.
 */
int bgc_wasm_test_expect_choose_parity(
    const char *test,
    bgc_engine *engine,
    const bgc_position *position,
    const bgc_candidate *candidates,
    size_t candidate_count,
    const bgc_settings *settings,
    const bgc_candidate_score *direct_scores,
    size_t direct_score_count,
    size_t direct_best_index
);

/*
 * Re-run an expected adapter failure through the arena bridge. In addition to
 * status parity, these helpers require transactional outputs: initialized but
 * otherwise zero result records, zero checker scores, and a bounded nonempty
 * error message.
 */
int bgc_wasm_test_expect_choose_failure(
    const char *test,
    bgc_engine *engine,
    const bgc_position *position,
    const bgc_candidate *candidates,
    size_t candidate_count,
    const bgc_settings *settings,
    bgc_status expected_status
);

int bgc_wasm_test_expect_cube_parity(
    const char *test,
    bgc_engine *engine,
    const bgc_position *position,
    bgc_cube_decision_phase phase,
    bgc_player engine_player,
    const bgc_cube_action *legal_actions,
    size_t legal_action_count,
    const bgc_settings *settings,
    const bgc_cube_analysis *direct_analysis
);

int bgc_wasm_test_expect_cube_failure(
    const char *test,
    bgc_engine *engine,
    const bgc_position *position,
    bgc_cube_decision_phase phase,
    bgc_player engine_player,
    const bgc_cube_action *legal_actions,
    size_t legal_action_count,
    const bgc_settings *settings,
    bgc_status expected_status
);

#endif
