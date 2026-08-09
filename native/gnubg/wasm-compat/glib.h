/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef BGC_GNUBG_WASM_GLIB_H
#define BGC_GNUBG_WASM_GLIB_H

#include <alloca.h>
#include <inttypes.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef int gboolean;
typedef char gchar;
typedef signed char gint8;
typedef unsigned char guchar;
typedef unsigned char guint8;
typedef int gint;
typedef unsigned int guint;
typedef int32_t gint32;
typedef uint32_t guint32;
typedef int64_t gint64;
typedef uint64_t guint64;
typedef guint32 GQuark;
typedef float gfloat;
typedef double gdouble;
typedef size_t gsize;
typedef ptrdiff_t gssize;
typedef void *gpointer;
typedef const void *gconstpointer;

typedef struct _GError {
    GQuark domain;
    gint code;
    gchar *message;
} GError;

typedef struct _GMappedFile {
    gchar *contents;
    gsize length;
} GMappedFile;

typedef struct _GList {
    gpointer data;
    struct _GList *next;
    struct _GList *prev;
} GList;

typedef struct _GString {
    gchar *str;
    gsize len;
    gsize allocated_len;
} GString;

typedef struct {
    int unused;
} GCond;

typedef struct {
    int unused;
} GMutex;

typedef struct {
    int unused;
} GPrivate;

typedef enum {
    G_FILE_TEST_IS_REGULAR = 1 << 0
} GFileTest;

#define TRUE 1
#define FALSE 0
#define G_PI 3.141592653589793238462643383279502884
#define G_PI_2 1.570796326794896619231321691639751442
#define G_GINT64_FORMAT PRId64
#define GLIB_CHECK_VERSION(major, minor, micro) 1
#define G_PRIVATE_INIT(destroy) { 0 }
#define MIN(left, right) ((left) < (right) ? (left) : (right))
#define MAX(left, right) ((left) > (right) ? (left) : (right))

#define g_malloc(byte_count) bgc_glib_malloc(byte_count)
#define g_malloc0(byte_count) bgc_glib_malloc0(byte_count)
#define g_try_malloc0(byte_count) bgc_glib_try_malloc0(byte_count)
#define g_free(memory) free(memory)
#define g_alloca(byte_count) alloca(byte_count)
#define g_new0(type, count) \
    ((type *) bgc_glib_new0((count), sizeof(type)))
#define g_try_new0(type, count) \
    ((type *) bgc_glib_try_new0((count), sizeof(type)))
#define g_fopen(path, mode) fopen((path), (mode))
#define g_strerror(error_number) strerror(error_number)
#define g_print(...) printf(__VA_ARGS__)
#define g_printerr(...) fprintf(stderr, __VA_ARGS__)
#define g_warning(...) bgc_glib_warning(__VA_ARGS__)

#define g_assert(condition) \
    do { \
        if (!(condition)) \
            bgc_glib_assertion_failed(#condition, __FILE__, __LINE__); \
    } while (0)
#define g_assert_not_reached() \
    bgc_glib_assertion_failed("unreachable GNUbg code", __FILE__, __LINE__)

#define g_return_val_if_fail(condition, value) \
    do { \
        if (!(condition)) \
            return (value); \
    } while (0)

void *bgc_glib_malloc(gsize byte_count);
void *bgc_glib_malloc0(gsize byte_count);
void *bgc_glib_try_malloc0(gsize byte_count);
void *bgc_glib_new0(gsize count, gsize element_size);
void *bgc_glib_try_new0(gsize count, gsize element_size);
gint bgc_glib_ascii_strcasecmp(
    const gchar *left,
    const gchar *right
);
gint bgc_glib_ascii_strncasecmp(
    const gchar *left,
    const gchar *right,
    gsize byte_count
);
_Noreturn void bgc_glib_assertion_failed(
    const gchar *condition,
    const gchar *file,
    gint line
);
void *bgc_glib_memdup2(gconstpointer memory, gsize byte_count);
gchar *bgc_glib_strdup(const gchar *source);
gchar *bgc_glib_build_filename(const gchar *first_element, ...);
gboolean bgc_glib_file_test(const gchar *path, GFileTest test);
void bgc_glib_warning(const gchar *format, ...);

GMappedFile *bgc_glib_mapped_file_new(
    const gchar *filename,
    gboolean writable,
    GError **error
);
gchar *bgc_glib_mapped_file_get_contents(GMappedFile *mapped_file);
void bgc_glib_mapped_file_unref(GMappedFile *mapped_file);
void bgc_glib_error_free(GError *error);

#define g_memdup2(memory, byte_count) \
    bgc_glib_memdup2((memory), (byte_count))
#define g_memdup(memory, byte_count) \
    bgc_glib_memdup2((memory), (byte_count))
#define g_ascii_strcasecmp(left, right) \
    bgc_glib_ascii_strcasecmp((left), (right))
#define g_ascii_strncasecmp(left, right, byte_count) \
    bgc_glib_ascii_strncasecmp((left), (right), (byte_count))
#define g_strdup(source) bgc_glib_strdup(source)
#define g_build_filename(...) bgc_glib_build_filename(__VA_ARGS__)
#define g_file_test(path, test) bgc_glib_file_test((path), (test))
#define g_mapped_file_new(filename, writable, error) \
    bgc_glib_mapped_file_new((filename), (writable), (error))
#define g_mapped_file_get_contents(mapped_file) \
    bgc_glib_mapped_file_get_contents(mapped_file)
#define g_mapped_file_unref(mapped_file) \
    bgc_glib_mapped_file_unref(mapped_file)
#define g_error_free(error) bgc_glib_error_free(error)

#endif
