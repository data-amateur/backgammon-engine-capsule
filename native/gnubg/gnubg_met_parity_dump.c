/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include <stdint.h>
#include <stdio.h>

#include "matchequity.h"

static int
write_bytes(FILE *output, const void *data, const size_t byte_count)
{
    return fwrite(data, 1u, byte_count, output) == byte_count;
}

int
main(const int argc, char **argv)
{
    FILE *output;
    int ok;

    if (argc != 3) {
        fprintf(stderr, "usage: %s <Kazaross-XG2.xml> <output.bin>\n", argv[0]);
        return 2;
    }

    InitMatchEquity(argv[1]);
    if (miCurrent.nLength != 25) {
        fprintf(stderr, "unexpected native MET length: %d\n", miCurrent.nLength);
        return 1;
    }

    output = fopen(argv[2], "wb");
    if (!output) {
        perror("could not open MET parity output");
        return 1;
    }

    ok = write_bytes(output, aafMET, sizeof(aafMET)) &&
         write_bytes(output, aafMETPostCrawford,
                     sizeof(aafMETPostCrawford)) &&
         write_bytes(output, aaaafGammonPrices,
                     sizeof(aaaafGammonPrices)) &&
         write_bytes(output, aaaafGammonPricesPostCrawford,
                     sizeof(aaaafGammonPricesPostCrawford));
    if (fclose(output) != 0)
        ok = 0;

    if (!ok) {
        fprintf(stderr, "could not write complete MET parity fixture\n");
        return 1;
    }

    return 0;
}
