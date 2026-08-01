/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_wasm_marshal.h"

#include <stdint.h>
#include <string.h>

static int
is_power_of_two(const uint32_t value) {
    return value != 0u && (value & (value - 1u)) == 0u;
}

int
bgc_wasm_arena_view_init(bgc_wasm_arena_view *view,
                         void *base,
                         const uint32_t size) {
    if (view == NULL || base == NULL || size == 0u ||
        size > BGC_WASM_MAX_ARENA_BYTES ||
        ((uintptr_t) base & (uintptr_t) 3u) != 0u)
        return 0;

    view->base = base;
    view->size = size;
    return 1;
}

int
bgc_wasm_make_byte_range(const bgc_wasm_arena_view *arena,
                         const uint32_t offset,
                         const uint32_t length,
                         const uint32_t alignment,
                         const int allow_empty,
                         bgc_wasm_range *range_out) {
    if (arena == NULL || range_out == NULL ||
        !is_power_of_two(alignment))
        return 0;

    if (length == 0u) {
        if (!allow_empty || offset != 0u)
            return 0;
        range_out->offset = 0u;
        range_out->length = 0u;
        range_out->end = 0u;
        return 1;
    }

    if ((offset & (alignment - 1u)) != 0u ||
        offset > arena->size || length > arena->size - offset)
        return 0;

    range_out->offset = offset;
    range_out->length = length;
    range_out->end = offset + length;
    return 1;
}

int
bgc_wasm_make_array_range(const bgc_wasm_arena_view *arena,
                          const uint32_t offset,
                          const uint32_t count,
                          const uint32_t element_size,
                          const uint32_t maximum_count,
                          const uint32_t alignment,
                          const int allow_empty,
                          bgc_wasm_range *range_out) {
    uint32_t byte_count;

    if (element_size == 0u || count > maximum_count ||
        (count != 0u && element_size > UINT32_MAX / count))
        return 0;
    byte_count = count * element_size;
    return bgc_wasm_make_byte_range(
        arena, offset, byte_count, alignment, allow_empty, range_out);
}

int
bgc_wasm_ranges_are_disjoint(const bgc_wasm_range *ranges,
                             const size_t range_count) {
    size_t left;
    size_t right;

    if (ranges == NULL && range_count != 0u)
        return 0;
    for (left = 0u; left < range_count; left++) {
        if (ranges[left].length == 0u)
            continue;
        for (right = left + 1u; right < range_count; right++) {
            if (ranges[right].length == 0u)
                continue;
            if (ranges[left].offset < ranges[right].end &&
                ranges[right].offset < ranges[left].end)
                return 0;
        }
    }
    return 1;
}

int
bgc_wasm_bytes_are_zero(const void *bytes, const size_t byte_count) {
    const uint8_t *cursor = bytes;
    size_t index;

    if (bytes == NULL && byte_count != 0u)
        return 0;
    for (index = 0u; index < byte_count; index++) {
        if (cursor[index] != 0u)
            return 0;
    }
    return 1;
}

static int
is_continuation(const uint8_t byte) {
    return byte >= 0x80u && byte <= 0xbfu;
}

int
bgc_wasm_utf8_is_valid_path(const uint8_t *bytes,
                            const uint32_t byte_count) {
    uint32_t index = 0u;

    if (bytes == NULL || byte_count == 0u ||
        byte_count > BGC_WASM_MAX_PATH_BYTES)
        return 0;

    while (index < byte_count) {
        const uint8_t lead = bytes[index];

        if (lead == 0u)
            return 0;
        if (lead <= 0x7fu) {
            index++;
            continue;
        }
        if (lead >= 0xc2u && lead <= 0xdfu) {
            if (index + 1u >= byte_count ||
                !is_continuation(bytes[index + 1u]))
                return 0;
            index += 2u;
            continue;
        }
        if (lead >= 0xe0u && lead <= 0xefu) {
            const uint8_t second = index + 1u < byte_count
                ? bytes[index + 1u] : 0u;
            if (index + 2u >= byte_count ||
                !is_continuation(bytes[index + 2u]) ||
                (lead == 0xe0u && (second < 0xa0u || second > 0xbfu)) ||
                (lead == 0xedu && (second < 0x80u || second > 0x9fu)) ||
                (lead != 0xe0u && lead != 0xedu &&
                 !is_continuation(second)))
                return 0;
            index += 3u;
            continue;
        }
        if (lead >= 0xf0u && lead <= 0xf4u) {
            const uint8_t second = index + 1u < byte_count
                ? bytes[index + 1u] : 0u;
            if (index + 3u >= byte_count ||
                !is_continuation(bytes[index + 2u]) ||
                !is_continuation(bytes[index + 3u]) ||
                (lead == 0xf0u && (second < 0x90u || second > 0xbfu)) ||
                (lead == 0xf4u && (second < 0x80u || second > 0x8fu)) ||
                (lead != 0xf0u && lead != 0xf4u &&
                 !is_continuation(second)))
                return 0;
            index += 4u;
            continue;
        }
        return 0;
    }
    return 1;
}

void
bgc_wasm_arena_load(const bgc_wasm_arena_view *arena,
                    const bgc_wasm_range *range,
                    void *output,
                    const size_t output_size) {
    if (output_size != 0u)
        memcpy(output, arena->base + range->offset, output_size);
}

void
bgc_wasm_arena_store(const bgc_wasm_arena_view *arena,
                     const bgc_wasm_range *range,
                     const void *input,
                     const size_t input_size) {
    if (input_size != 0u)
        memcpy(arena->base + range->offset, input, input_size);
}

void
bgc_wasm_arena_clear(const bgc_wasm_arena_view *arena,
                     const bgc_wasm_range *range) {
    if (range->length != 0u)
        memset(arena->base + range->offset, 0, range->length);
}
