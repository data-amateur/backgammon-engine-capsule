/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef GNUBG_CAPSULE_WASM_BRIDGE_INTERNAL_H
#define GNUBG_CAPSULE_WASM_BRIDGE_INTERNAL_H

#include <stdint.h>

#include "gnubg_adapter.h"

/*
 * Borrowed-engine entry points let native parity tests exercise the exact
 * arena bridge without trying to initialize GNUbg twice in one process.
 * They never retain or dispose the supplied engine.
 */
int32_t bgc_wasm_init_with_engine(
    uint8_t *arena,
    uint32_t arena_size,
    uint32_t request_offset,
    uint32_t error_offset,
    bgc_engine **engine_out,
    int *adapter_called
);

int32_t bgc_wasm_choose_turn_with_engine(
    bgc_engine *engine,
    uint8_t *arena,
    uint32_t arena_size,
    uint32_t request_offset,
    uint32_t result_offset,
    uint32_t error_offset
);

int32_t bgc_wasm_decide_cube_with_engine(
    bgc_engine *engine,
    uint8_t *arena,
    uint32_t arena_size,
    uint32_t request_offset,
    uint32_t result_offset,
    uint32_t error_offset
);

int32_t bgc_wasm_reset_with_engine(
    bgc_engine *engine,
    uint8_t *arena,
    uint32_t arena_size,
    uint32_t error_offset
);

#endif
