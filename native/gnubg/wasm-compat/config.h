/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef BGC_GNUBG_WASM_CONFIG_H
#define BGC_GNUBG_WASM_CONFIG_H

#define AC_PKGDATADIR "/gnubg"
#define PACKAGE "gnubg"
#define PACKAGE_BUGREPORT "bug-gnubg@gnu.org"
#define PACKAGE_NAME "GNU Backgammon"
#define PACKAGE_STRING "GNU Backgammon 1.08.003"
#define PACKAGE_TARNAME "gnubg"
#define PACKAGE_URL "https://www.gnu.org/software/gnubg/"
#define PACKAGE_VERSION "1.08.003"
#define VERSION "1.08.003"

#define HAVE___ATTRIBUTE__ 1
#define HAVE___BUILTIN_CLZ 1
#define HAVE___BUILTIN_EXPECT 1
#define HAVE_FUNC_ATTRIBUTE_FORMAT 1
#define HAVE_FUNC_ATTRIBUTE_PURE 1
#define HAVE_FUNC_ATTRIBUTE_UNUSED 1

#define HAVE_INTTYPES_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDIO_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_STRINGS_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_UNISTD_H 1

#define HAVE_SIGACTION 0
#define HAVE_SIGVEC 0

/*
 * Intentionally absent: ENABLE_NLS, USE_MULTITHREAD, USE_SIMD_INSTRUCTIONS,
 * HAVE_SSE, HAVE_SSE2, HAVE_NEON, and every desktop/UI integration.
 */

#endif
