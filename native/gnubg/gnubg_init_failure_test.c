/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "gnubg_adapter.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    const char *name;
    const char *expected_error;
} failure_scenario;

static const failure_scenario scenarios[] = {
    {
        "wrong-version",
        "GNUbg evaluator initialization failed: "
        "weights data is invalid or incomplete"
    },
    {
        "truncated-first-network",
        "GNUbg evaluator initialization failed: "
        "weights data is invalid or incomplete"
    },
    {
        "truncated-second-network",
        "GNUbg evaluator initialization failed: "
        "weights data is invalid or incomplete"
    },
    {
        "nonfinite-second-network",
        "GNUbg evaluator initialization failed: "
        "weights data is invalid or incomplete"
    },
    {
        "wrong-hidden-shape",
        "GNUbg evaluator initialization failed: "
        "weights network dimensions do not match GNUbg 1.08.003"
    }
};

static const failure_scenario *
find_scenario(const char *name)
{
    size_t index;

    for (index = 0; index < sizeof(scenarios) / sizeof(scenarios[0]); index++)
        if (strcmp(name, scenarios[index].name) == 0)
            return &scenarios[index];
    return NULL;
}

static int
expect_initialization_failure(const char *label,
                              const bgc_status status,
                              const bgc_engine *engine,
                              const bgc_error *error,
                              const char *expected_error)
{
    if (status != BGC_STATUS_INITIALIZATION_FAILED) {
        fprintf(stderr, "%s returned status %d instead of %d\n",
                label, status, BGC_STATUS_INITIALIZATION_FAILED);
        return 0;
    }
    if (engine != NULL) {
        fprintf(stderr, "%s published an engine after failure\n", label);
        return 0;
    }
    if (strcmp(error->message, expected_error) != 0) {
        fprintf(stderr,
                "%s returned error:\n  %s\ninstead of:\n  %s\n",
                label, error->message, expected_error);
        return 0;
    }
    return 1;
}

int
main(int argc, char **argv)
{
    static const char retry_error[] =
        "GNUbg may be initialized only once per process";
    const failure_scenario *scenario;
    const char *invalid_weights_path;
    const char *valid_weights_path;
    const char *match_equity_path;
    bgc_engine *engine = NULL;
    bgc_error error = {{0}};
    bgc_status status;

    if (argc != 5) {
        fprintf(stderr,
                "Usage: %s <failure-scenario> "
                "<invalid-weights> <valid-weights> <match-equity>\n",
                argv[0]);
        return EXIT_FAILURE;
    }

    scenario = find_scenario(argv[1]);
    if (!scenario) {
        fprintf(stderr, "Unknown failure scenario: %s\n", argv[1]);
        return EXIT_FAILURE;
    }
    invalid_weights_path = argv[2];
    valid_weights_path = argv[3];
    match_equity_path = argv[4];

    status = bgc_engine_create(invalid_weights_path, match_equity_path,
                               &engine, &error);
    if (!expect_initialization_failure(
            scenario->name, status, engine, &error,
            scenario->expected_error))
        return EXIT_FAILURE;

    status = bgc_engine_create(valid_weights_path, match_equity_path,
                               &engine, &error);
    if (!expect_initialization_failure(
            "same-process retry", status, engine, &error, retry_error))
        return EXIT_FAILURE;

    bgc_engine_dispose(engine);
    printf("GNUbg %s initialization failure is recoverable only in a fresh "
           "process\n", scenario->name);
    return EXIT_SUCCESS;
}
