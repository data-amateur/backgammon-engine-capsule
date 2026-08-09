/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef BGC_GNUBG_WASM_GPRINTF_H
#define BGC_GNUBG_WASM_GPRINTF_H

#include "../glib.h"

#define g_printf(...) printf(__VA_ARGS__)
#define g_fprintf(stream, ...) fprintf((stream), __VA_ARGS__)
#define g_sprintf(buffer, ...) sprintf((buffer), __VA_ARGS__)
#define g_snprintf(buffer, size, ...) snprintf((buffer), (size), __VA_ARGS__)

#endif
