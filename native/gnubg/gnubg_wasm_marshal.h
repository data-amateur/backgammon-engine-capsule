/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef GNUBG_CAPSULE_WASM_MARSHAL_H
#define GNUBG_CAPSULE_WASM_MARSHAL_H

#include <stddef.h>
#include <stdint.h>

#include "gnubg_wasm_abi.h"

typedef struct {
    uint8_t *base;
    uint32_t size;
} bgc_wasm_arena_view;

typedef struct {
    uint32_t offset;
    uint32_t length;
    uint32_t end;
} bgc_wasm_range;

int bgc_wasm_arena_view_init(
    bgc_wasm_arena_view *view,
    void *base,
    uint32_t size
);

int bgc_wasm_make_byte_range(
    const bgc_wasm_arena_view *arena,
    uint32_t offset,
    uint32_t length,
    uint32_t alignment,
    int allow_empty,
    bgc_wasm_range *range_out
);

int bgc_wasm_make_array_range(
    const bgc_wasm_arena_view *arena,
    uint32_t offset,
    uint32_t count,
    uint32_t element_size,
    uint32_t maximum_count,
    uint32_t alignment,
    int allow_empty,
    bgc_wasm_range *range_out
);

int bgc_wasm_ranges_are_disjoint(
    const bgc_wasm_range *ranges,
    size_t range_count
);

int bgc_wasm_bytes_are_zero(const void *bytes, size_t byte_count);

int bgc_wasm_utf8_is_valid_path(const uint8_t *bytes, uint32_t byte_count);

void bgc_wasm_arena_load(
    const bgc_wasm_arena_view *arena,
    const bgc_wasm_range *range,
    void *output,
    size_t output_size
);

void bgc_wasm_arena_store(
    const bgc_wasm_arena_view *arena,
    const bgc_wasm_range *range,
    const void *input,
    size_t input_size
);

void bgc_wasm_arena_clear(
    const bgc_wasm_arena_view *arena,
    const bgc_wasm_range *range
);

#endif
