/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_wasm_marshal.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define CHECK(condition)                                                       \
    do {                                                                       \
        if (!(condition)) {                                                    \
            fprintf(stderr, "check failed at %s:%d: %s\n", __FILE__, __LINE__, \
                    #condition);                                               \
            return 1;                                                          \
        }                                                                      \
    } while (0)

#define BYTE_COUNT(bytes) ((uint32_t) sizeof(bytes))

typedef union {
    uint32_t alignment;
    uint8_t bytes[128];
} aligned_storage;

static int
test_arena_view(void) {
    aligned_storage storage;
    bgc_wasm_arena_view view;

    memset(&view, 0, sizeof(view));
    CHECK(bgc_wasm_arena_view_init(&view, storage.bytes,
                                   (uint32_t) sizeof(storage.bytes)) == 1);
    CHECK(view.base == storage.bytes);
    CHECK(view.size == sizeof(storage.bytes));

    CHECK(bgc_wasm_arena_view_init(NULL, storage.bytes, 4u) == 0);
    CHECK(bgc_wasm_arena_view_init(&view, NULL, 4u) == 0);
    CHECK(bgc_wasm_arena_view_init(&view, storage.bytes, 0u) == 0);
    CHECK(bgc_wasm_arena_view_init(&view, storage.bytes + 1u, 4u) == 0);
    CHECK(bgc_wasm_arena_view_init(&view, storage.bytes,
                                   BGC_WASM_MAX_ARENA_BYTES + 1u) == 0);
    CHECK(bgc_wasm_arena_view_init(&view, storage.bytes,
                                   BGC_WASM_MAX_ARENA_BYTES) == 1);

    return 0;
}

static int
test_byte_ranges(void) {
    aligned_storage storage;
    bgc_wasm_arena_view arena;
    bgc_wasm_range range = {99u, 99u, 99u};

    CHECK(bgc_wasm_arena_view_init(&arena, storage.bytes, 64u) == 1);
    CHECK(bgc_wasm_make_byte_range(&arena, 4u, 12u, 4u, 0,
                                   &range) == 1);
    CHECK(range.offset == 4u);
    CHECK(range.length == 12u);
    CHECK(range.end == 16u);

    CHECK(bgc_wasm_make_byte_range(&arena, 0u, 1u, 1u, 0,
                                   &range) == 1);
    CHECK(range.offset == 0u && range.length == 1u && range.end == 1u);
    CHECK(bgc_wasm_make_byte_range(&arena, 60u, 4u, 4u, 0,
                                   &range) == 1);
    CHECK(range.end == 64u);

    CHECK(bgc_wasm_make_byte_range(NULL, 0u, 1u, 1u, 0, &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 0u, 1u, 1u, 0, NULL) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 0u, 1u, 0u, 0, &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 0u, 1u, 3u, 0, &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 2u, 4u, 4u, 0, &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 64u, 1u, 1u, 0, &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 65u, 1u, 1u, 0, &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 4u, 61u, 1u, 0, &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 4u, UINT32_MAX, 1u, 0,
                                   &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, UINT32_MAX - 3u, 8u, 4u, 0,
                                   &range) == 0);

    CHECK(bgc_wasm_make_byte_range(&arena, 0u, 0u, 4u, 1,
                                   &range) == 1);
    CHECK(range.offset == 0u && range.length == 0u && range.end == 0u);
    CHECK(bgc_wasm_make_byte_range(&arena, 0u, 0u, 4u, 0,
                                   &range) == 0);
    CHECK(bgc_wasm_make_byte_range(&arena, 4u, 0u, 4u, 1,
                                   &range) == 0);

    return 0;
}

static int
test_array_ranges(void) {
    aligned_storage storage;
    bgc_wasm_arena_view arena;
    bgc_wasm_range range;

    CHECK(bgc_wasm_arena_view_init(&arena, storage.bytes, 64u) == 1);
    CHECK(bgc_wasm_make_array_range(&arena, 4u, 3u, 4u, 3u, 4u, 0,
                                    &range) == 1);
    CHECK(range.offset == 4u && range.length == 12u && range.end == 16u);
    CHECK(bgc_wasm_make_array_range(&arena, 0u, 16u, 4u, 16u, 4u, 0,
                                    &range) == 1);
    CHECK(range.end == 64u);

    CHECK(bgc_wasm_make_array_range(&arena, 0u, 4u, 0u, 4u, 4u, 0,
                                    &range) == 0);
    CHECK(bgc_wasm_make_array_range(&arena, 0u, 5u, 4u, 4u, 4u, 0,
                                    &range) == 0);
    CHECK(bgc_wasm_make_array_range(&arena, 0u, 2u, UINT32_MAX, 2u, 4u, 0,
                                    &range) == 0);
    CHECK(bgc_wasm_make_array_range(&arena, 4u, 16u, 4u, 16u, 4u, 0,
                                    &range) == 0);
    CHECK(bgc_wasm_make_array_range(&arena, 2u, 1u, 4u, 1u, 4u, 0,
                                    &range) == 0);
    CHECK(bgc_wasm_make_array_range(&arena, 0u, 1u, 4u, 1u, 3u, 0,
                                    &range) == 0);

    CHECK(bgc_wasm_make_array_range(&arena, 0u, 0u, 4u, 0u, 4u, 1,
                                    &range) == 1);
    CHECK(range.offset == 0u && range.length == 0u && range.end == 0u);
    CHECK(bgc_wasm_make_array_range(&arena, 0u, 0u, 4u, 0u, 4u, 0,
                                    &range) == 0);
    CHECK(bgc_wasm_make_array_range(&arena, 4u, 0u, 4u, 0u, 4u, 1,
                                    &range) == 0);

    return 0;
}

static int
test_disjoint_ranges(void) {
    const bgc_wasm_range adjacent[] = {
        {0u, 4u, 4u},
        {4u, 8u, 12u},
        {12u, 1u, 13u},
    };
    const bgc_wasm_range reversed_adjacent[] = {
        {8u, 4u, 12u},
        {0u, 8u, 8u},
    };
    const bgc_wasm_range overlap[] = {
        {0u, 5u, 5u},
        {4u, 4u, 8u},
    };
    const bgc_wasm_range identical[] = {
        {4u, 4u, 8u},
        {4u, 4u, 8u},
    };
    const bgc_wasm_range contained[] = {
        {0u, 12u, 12u},
        {4u, 4u, 8u},
    };
    const bgc_wasm_range empty_ignored[] = {
        {0u, 4u, 4u},
        {2u, 0u, 2u},
        {4u, 4u, 8u},
    };

    CHECK(bgc_wasm_ranges_are_disjoint(NULL, 0u) == 1);
    CHECK(bgc_wasm_ranges_are_disjoint(NULL, 1u) == 0);
    CHECK(bgc_wasm_ranges_are_disjoint(adjacent, 1u) == 1);
    CHECK(bgc_wasm_ranges_are_disjoint(adjacent,
                                       sizeof(adjacent) / sizeof(adjacent[0])) ==
          1);
    CHECK(bgc_wasm_ranges_are_disjoint(
              reversed_adjacent,
              sizeof(reversed_adjacent) / sizeof(reversed_adjacent[0])) == 1);
    CHECK(bgc_wasm_ranges_are_disjoint(overlap,
                                       sizeof(overlap) / sizeof(overlap[0])) ==
          0);
    CHECK(bgc_wasm_ranges_are_disjoint(
              identical, sizeof(identical) / sizeof(identical[0])) == 0);
    CHECK(bgc_wasm_ranges_are_disjoint(
              contained, sizeof(contained) / sizeof(contained[0])) == 0);
    CHECK(bgc_wasm_ranges_are_disjoint(
              empty_ignored,
              sizeof(empty_ignored) / sizeof(empty_ignored[0])) == 1);

    return 0;
}

static int
test_zero_bytes(void) {
    uint8_t bytes[8] = {0u};

    CHECK(bgc_wasm_bytes_are_zero(NULL, 0u) == 1);
    CHECK(bgc_wasm_bytes_are_zero(NULL, 1u) == 0);
    CHECK(bgc_wasm_bytes_are_zero(bytes, sizeof(bytes)) == 1);

    bytes[0] = 1u;
    CHECK(bgc_wasm_bytes_are_zero(bytes, sizeof(bytes)) == 0);
    bytes[0] = 0u;
    bytes[3] = 1u;
    CHECK(bgc_wasm_bytes_are_zero(bytes, sizeof(bytes)) == 0);
    bytes[3] = 0u;
    bytes[7] = 1u;
    CHECK(bgc_wasm_bytes_are_zero(bytes, sizeof(bytes)) == 0);
    CHECK(bgc_wasm_bytes_are_zero(bytes, 7u) == 1);

    return 0;
}

static int
test_valid_utf8_paths(void) {
    const uint8_t ascii[] = {'/', 'm', 'o', 'd', 'e', 'l', '.', 'b', 'd'};
    const uint8_t two_byte_boundaries[] = {0xc2u, 0x80u, 0xdfu, 0xbfu};
    const uint8_t three_byte_boundaries[] = {
        0xe0u, 0xa0u, 0x80u,
        0xedu, 0x9fu, 0xbfu,
        0xeeu, 0x80u, 0x80u,
        0xefu, 0xbfu, 0xbfu,
    };
    const uint8_t four_byte_boundaries[] = {
        0xf0u, 0x90u, 0x80u, 0x80u,
        0xf4u, 0x8fu, 0xbfu, 0xbfu,
    };
    const uint8_t mixed[] = {
        '/', 'a', '/', 0xc2u, 0xa2u, '/', 0xe2u, 0x82u, 0xacu,
        '/', 0xf0u, 0x9fu, 0x98u, 0x80u,
    };
    const uint8_t ascii_delete[] = {0x7fu};
    uint8_t maximum_length[BGC_WASM_MAX_PATH_BYTES + 1u];

    memset(maximum_length, 'a', sizeof(maximum_length));

    CHECK(bgc_wasm_utf8_is_valid_path(ascii, BYTE_COUNT(ascii)) == 1);
    CHECK(bgc_wasm_utf8_is_valid_path(two_byte_boundaries,
                                      BYTE_COUNT(two_byte_boundaries)) == 1);
    CHECK(bgc_wasm_utf8_is_valid_path(
              three_byte_boundaries, BYTE_COUNT(three_byte_boundaries)) == 1);
    CHECK(bgc_wasm_utf8_is_valid_path(
              four_byte_boundaries, BYTE_COUNT(four_byte_boundaries)) == 1);
    CHECK(bgc_wasm_utf8_is_valid_path(mixed, BYTE_COUNT(mixed)) == 1);
    CHECK(bgc_wasm_utf8_is_valid_path(ascii_delete,
                                      BYTE_COUNT(ascii_delete)) == 1);
    CHECK(bgc_wasm_utf8_is_valid_path(maximum_length,
                                      BGC_WASM_MAX_PATH_BYTES) == 1);
    CHECK(bgc_wasm_utf8_is_valid_path(maximum_length,
                                      BGC_WASM_MAX_PATH_BYTES + 1u) == 0);

    return 0;
}

static int
test_invalid_utf8_paths(void) {
    const uint8_t nul_only[] = {0u};
    const uint8_t embedded_nul[] = {'a', 0u, 'b'};
    const uint8_t lone_continuation[] = {0x80u};
    const uint8_t overlong_two[] = {0xc0u, 0x80u};
    const uint8_t overlong_two_high[] = {0xc1u, 0xbfu};
    const uint8_t overlong_three[] = {0xe0u, 0x80u, 0x80u};
    const uint8_t overlong_three_high[] = {0xe0u, 0x9fu, 0xbfu};
    const uint8_t surrogate_low[] = {0xedu, 0xa0u, 0x80u};
    const uint8_t surrogate_high[] = {0xedu, 0xbfu, 0xbfu};
    const uint8_t overlong_four[] = {0xf0u, 0x80u, 0x80u, 0x80u};
    const uint8_t overlong_four_high[] = {0xf0u, 0x8fu, 0xbfu, 0xbfu};
    const uint8_t above_unicode_limit[] = {0xf4u, 0x90u, 0x80u, 0x80u};
    const uint8_t invalid_four_lead[] = {0xf5u, 0x80u, 0x80u, 0x80u};
    const uint8_t legacy_five_byte[] = {
        0xf8u, 0x88u, 0x80u, 0x80u, 0x80u,
    };
    const uint8_t invalid_ff[] = {0xffu};
    const uint8_t truncated_two[] = {0xc2u};
    const uint8_t truncated_three[] = {0xe2u, 0x82u};
    const uint8_t truncated_four[] = {0xf0u, 0x90u, 0x80u};
    const uint8_t bad_two_continuation[] = {0xc2u, 'a'};
    const uint8_t bad_three_continuation[] = {0xe1u, 0x80u, 'a'};
    const uint8_t bad_four_continuation[] = {0xf1u, 0x80u, 0x80u, 'a'};

    CHECK(bgc_wasm_utf8_is_valid_path(NULL, 1u) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(nul_only, 0u) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(nul_only, BYTE_COUNT(nul_only)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(embedded_nul,
                                      BYTE_COUNT(embedded_nul)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              lone_continuation, BYTE_COUNT(lone_continuation)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(overlong_two,
                                      BYTE_COUNT(overlong_two)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              overlong_two_high, BYTE_COUNT(overlong_two_high)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(overlong_three,
                                      BYTE_COUNT(overlong_three)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              overlong_three_high, BYTE_COUNT(overlong_three_high)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(surrogate_low,
                                      BYTE_COUNT(surrogate_low)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(surrogate_high,
                                      BYTE_COUNT(surrogate_high)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(overlong_four,
                                      BYTE_COUNT(overlong_four)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              overlong_four_high, BYTE_COUNT(overlong_four_high)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              above_unicode_limit, BYTE_COUNT(above_unicode_limit)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              invalid_four_lead, BYTE_COUNT(invalid_four_lead)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              legacy_five_byte, BYTE_COUNT(legacy_five_byte)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(invalid_ff,
                                      BYTE_COUNT(invalid_ff)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(truncated_two,
                                      BYTE_COUNT(truncated_two)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(truncated_three,
                                      BYTE_COUNT(truncated_three)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(truncated_four,
                                      BYTE_COUNT(truncated_four)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              bad_two_continuation, BYTE_COUNT(bad_two_continuation)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              bad_three_continuation, BYTE_COUNT(bad_three_continuation)) == 0);
    CHECK(bgc_wasm_utf8_is_valid_path(
              bad_four_continuation, BYTE_COUNT(bad_four_continuation)) == 0);

    return 0;
}

static int
test_arena_copy_and_clear(void) {
    aligned_storage storage;
    bgc_wasm_arena_view arena;
    bgc_wasm_range range;
    const uint8_t input[] = {0x11u, 0x22u, 0x33u, 0x44u};
    uint8_t output[sizeof(input)] = {0u};
    const bgc_wasm_range empty = {0u, 0u, 0u};

    memset(storage.bytes, 0xa5, sizeof(storage.bytes));
    CHECK(bgc_wasm_arena_view_init(&arena, storage.bytes,
                                   (uint32_t) sizeof(storage.bytes)) == 1);
    CHECK(bgc_wasm_make_byte_range(&arena, 8u, (uint32_t) sizeof(input), 4u,
                                   0, &range) == 1);

    bgc_wasm_arena_store(&arena, &range, input, sizeof(input));
    CHECK(storage.bytes[7] == 0xa5u);
    CHECK(memcmp(storage.bytes + range.offset, input, sizeof(input)) == 0);
    CHECK(storage.bytes[range.end] == 0xa5u);

    bgc_wasm_arena_load(&arena, &range, output, sizeof(output));
    CHECK(memcmp(output, input, sizeof(input)) == 0);

    bgc_wasm_arena_clear(&arena, &range);
    CHECK(bgc_wasm_bytes_are_zero(storage.bytes + range.offset,
                                  range.length) == 1);
    CHECK(storage.bytes[7] == 0xa5u);
    CHECK(storage.bytes[range.end] == 0xa5u);

    bgc_wasm_arena_load(&arena, &empty, NULL, 0u);
    bgc_wasm_arena_store(&arena, &empty, NULL, 0u);
    bgc_wasm_arena_clear(&arena, &empty);

    return 0;
}

int
main(void) {
    if (test_arena_view() != 0 ||
        test_byte_ranges() != 0 ||
        test_array_ranges() != 0 ||
        test_disjoint_ranges() != 0 ||
        test_zero_bytes() != 0 ||
        test_valid_utf8_paths() != 0 ||
        test_invalid_utf8_paths() != 0 ||
        test_arena_copy_and_clear() != 0)
        return 1;

    puts("GNUbg wasm32 arena marshalling checks passed");
    return 0;
}
