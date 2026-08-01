/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_wasm_abi.h"

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

int
main(void) {
    bgc_wasm_abi_descriptor_v1 descriptor;
    uint8_t unchanged[sizeof(descriptor)];

    CHECK(bgc_wasm_abi_version() == UINT32_C(0x00010000));
    CHECK(bgc_wasm_abi_descriptor_size() == 128u);
    CHECK(bgc_wasm_get_abi_descriptor(NULL, 128u) ==
          BGC_WASM_STATUS_INVALID_ARGUMENT);

    memset(&descriptor, 0xa5, sizeof(descriptor));
    memcpy(unchanged, &descriptor, sizeof(unchanged));
    CHECK(bgc_wasm_get_abi_descriptor(&descriptor, 127u) ==
          BGC_WASM_STATUS_INVALID_ARGUMENT);
    CHECK(memcmp(&descriptor, unchanged, sizeof(unchanged)) == 0);

    CHECK(bgc_wasm_get_abi_descriptor(&descriptor, sizeof(descriptor)) ==
          BGC_WASM_STATUS_OK);
    CHECK(descriptor.header.abi_version == BGC_WASM_ABI_VERSION);
    CHECK(descriptor.header.byte_size == 128u);
    CHECK(descriptor.endianness_marker == BGC_WASM_ABI_ENDIANNESS_MARKER);
    CHECK(descriptor.pointer_width == sizeof(void *));
    CHECK(descriptor.header_size == 8u);
    CHECK(descriptor.checker_counts_size == 2u);
    CHECK(descriptor.board_size == 52u);
    CHECK(descriptor.cube_size == 16u);
    CHECK(descriptor.match_size == 20u);
    CHECK(descriptor.rules_size == 20u);
    CHECK(descriptor.position_size == 120u);
    CHECK(descriptor.location_size == 8u);
    CHECK(descriptor.turn_step_size == 24u);
    CHECK(descriptor.candidate_size == 104u);
    CHECK(descriptor.settings_size == 16u);
    CHECK(descriptor.candidate_score_size == 8u);
    CHECK(descriptor.error_size == 256u);
    CHECK(descriptor.init_request_size == 32u);
    CHECK(descriptor.choose_request_size == 176u);
    CHECK(descriptor.choose_result_size == 32u);
    CHECK(descriptor.cube_request_size == 192u);
    CHECK(descriptor.cube_result_size == 64u);

    for (size_t index = 0; index < 10u; ++index) {
        CHECK(descriptor.reserved[index] == 0u);
    }

    puts("GNUbg wasm32 ABI layout checks passed");
    return 0;
}
