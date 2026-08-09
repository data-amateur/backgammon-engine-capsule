/* SPDX-License-Identifier: GPL-3.0-or-later */

#include "config.h"

#include <glib.h>

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "output.h"
#include "util.h"

static char wasm_data_directory[] = "/gnubg";
static char wasm_documentation_directory[] = "/gnubg";

char *prefsdir;
char *datadir = wasm_data_directory;
char *pkg_datadir = wasm_data_directory;
char *docdir = wasm_documentation_directory;

int cOutputDisabled;
int cOutputPostponed;
int foutput_on = TRUE;

static int
checked_add_size(const size_t left, const size_t right, size_t *result)
{
    if (right > SIZE_MAX - left)
        return 0;
    *result = left + right;
    return 1;
}

static unsigned char
ascii_lower(const unsigned char character)
{
    return character >= (unsigned char) 'A' &&
        character <= (unsigned char) 'Z' ?
        (unsigned char) (character + ('a' - 'A')) : character;
}

gint
bgc_glib_ascii_strcasecmp(const gchar *left, const gchar *right)
{
    g_assert(left);
    g_assert(right);

    for (;;) {
        const unsigned char folded_left = ascii_lower((unsigned char) *left);
        const unsigned char folded_right = ascii_lower((unsigned char) *right);

        if (folded_left != folded_right)
            return (gint) folded_left - (gint) folded_right;
        if (folded_left == 0u)
            return 0;
        left++;
        right++;
    }
}

gint
bgc_glib_ascii_strncasecmp(const gchar *left,
                            const gchar *right,
                            gsize byte_count)
{
    g_assert(left);
    g_assert(right);

    while (byte_count > 0u) {
        const unsigned char folded_left = ascii_lower((unsigned char) *left);
        const unsigned char folded_right = ascii_lower((unsigned char) *right);

        if (folded_left != folded_right)
            return (gint) folded_left - (gint) folded_right;
        if (folded_left == 0u)
            return 0;
        left++;
        right++;
        byte_count--;
    }
    return 0;
}

_Noreturn void
bgc_glib_assertion_failed(const gchar *condition,
                          const gchar *file,
                          const gint line)
{
    fprintf(stderr, "%s:%d: GNUbg assertion failed: %s\n",
            file ? file : "GNUbg", line,
            condition ? condition : "unknown condition");
    abort();
}

static _Noreturn void
abort_out_of_memory(void)
{
    fputs("GNUbg GLib-compatible allocation failed\n", stderr);
    abort();
}

static void *
allocate_n(const size_t count,
           const size_t element_size,
           const int clear,
           const int abort_on_failure)
{
    void *allocation;

    if (count == 0u || element_size == 0u)
        return NULL;
    if (element_size > SIZE_MAX / count) {
        errno = ENOMEM;
        if (abort_on_failure)
            abort_out_of_memory();
        return NULL;
    }

    allocation = clear ?
        calloc(count, element_size) : malloc(count * element_size);
    if (!allocation && abort_on_failure)
        abort_out_of_memory();
    return allocation;
}

void *
bgc_glib_malloc(const size_t byte_count)
{
    return allocate_n(1u, byte_count, FALSE, TRUE);
}

void *
bgc_glib_malloc0(const size_t byte_count)
{
    return allocate_n(1u, byte_count, TRUE, TRUE);
}

void *
bgc_glib_try_malloc0(const size_t byte_count)
{
    return allocate_n(1u, byte_count, TRUE, FALSE);
}

void *
bgc_glib_new0(const size_t count, const size_t element_size)
{
    return allocate_n(count, element_size, TRUE, TRUE);
}

void *
bgc_glib_try_new0(const size_t count, const size_t element_size)
{
    return allocate_n(count, element_size, TRUE, FALSE);
}

void *
bgc_glib_memdup2(const void *memory, const size_t byte_count)
{
    void *copy;

    if (byte_count == 0u)
        return NULL;
    if (!memory) {
        errno = EINVAL;
        return NULL;
    }
    copy = bgc_glib_malloc(byte_count);
    memcpy(copy, memory, byte_count);
    return copy;
}

char *
bgc_glib_strdup(const char *source)
{
    size_t byte_count;
    char *copy;

    if (!source)
        return NULL;
    if (!checked_add_size(strlen(source), 1u, &byte_count)) {
        errno = EOVERFLOW;
        return NULL;
    }
    copy = bgc_glib_malloc(byte_count);
    memcpy(copy, source, byte_count);
    return copy;
}

char *
bgc_glib_build_filename(const char *first_element, ...)
{
    va_list arguments;
    const char *part;
    size_t capacity;
    size_t used;
    char *result;

    if (!first_element) {
        errno = EINVAL;
        return NULL;
    }

    capacity = strlen(first_element);
    va_start(arguments, first_element);
    while ((part = va_arg(arguments, const char *)) != NULL) {
        size_t next_capacity;
        if (!checked_add_size(capacity, strlen(part), &next_capacity) ||
            !checked_add_size(next_capacity, 1u, &capacity)) {
            va_end(arguments);
            errno = EOVERFLOW;
            return NULL;
        }
    }
    va_end(arguments);
    if (!checked_add_size(capacity, 1u, &capacity)) {
        errno = EOVERFLOW;
        return NULL;
    }

    result = bgc_glib_malloc(capacity);
    used = strlen(first_element);
    memcpy(result, first_element, used);
    result[used] = '\0';

    va_start(arguments, first_element);
    while ((part = va_arg(arguments, const char *)) != NULL) {
        const char *source = part;
        size_t part_length;

        if (used > 0u && result[used - 1u] != '/' && source[0] != '/')
            result[used++] = '/';
        else if (used > 0u && result[used - 1u] == '/')
            while (*source == '/')
                source++;
        part_length = strlen(source);
        memcpy(result + used, source, part_length);
        used += part_length;
        result[used] = '\0';
    }
    va_end(arguments);
    return result;
}

gboolean
bgc_glib_file_test(const char *path, const GFileTest test)
{
    struct stat status;

    if (!path || test != G_FILE_TEST_IS_REGULAR)
        return FALSE;
    return stat(path, &status) == 0 && S_ISREG(status.st_mode);
}

void
bgc_glib_warning(const char *format, ...)
{
    va_list arguments;

    fputs("GNUbg warning: ", stderr);
    va_start(arguments, format);
    vfprintf(stderr, format, arguments);
    va_end(arguments);
    fputc('\n', stderr);
}

static void
set_file_error(GError **error, const char *filename)
{
    GError *created;
    const char *reason = strerror(errno);
    size_t message_length;
    size_t filename_length;

    if (!error)
        return;
    *error = NULL;
    created = calloc(1u, sizeof(*created));
    if (!created)
        return;

    filename_length = filename ? strlen(filename) : 0u;
    if (!checked_add_size(filename_length, strlen(reason), &message_length) ||
        !checked_add_size(message_length, 3u, &message_length)) {
        free(created);
        return;
    }
    created->message = malloc(message_length);
    if (!created->message) {
        free(created);
        return;
    }
    snprintf(created->message, message_length, "%s: %s",
             filename ? filename : "", reason);
    *error = created;
}

GMappedFile *
bgc_glib_mapped_file_new(const char *filename,
                         const gboolean writable,
                         GError **error)
{
    FILE *file;
    long length;
    GMappedFile *mapped;

    if (error)
        *error = NULL;
    if (!filename || writable) {
        errno = EINVAL;
        set_file_error(error, filename);
        return NULL;
    }

    file = fopen(filename, "rb");
    if (!file) {
        set_file_error(error, filename);
        return NULL;
    }
    if (fseek(file, 0, SEEK_END) != 0 ||
        (length = ftell(file)) < 0 ||
        fseek(file, 0, SEEK_SET) != 0) {
        set_file_error(error, filename);
        fclose(file);
        return NULL;
    }

    mapped = calloc(1u, sizeof(*mapped));
    if (!mapped) {
        fclose(file);
        return NULL;
    }
    mapped->length = (size_t) length;
    mapped->contents = malloc(mapped->length > 0u ? mapped->length : 1u);
    if (!mapped->contents) {
        free(mapped);
        fclose(file);
        return NULL;
    }
    if (mapped->length > 0u &&
        fread(mapped->contents, 1u, mapped->length, file) != mapped->length) {
        set_file_error(error, filename);
        free(mapped->contents);
        free(mapped);
        fclose(file);
        return NULL;
    }
    fclose(file);
    return mapped;
}

char *
bgc_glib_mapped_file_get_contents(GMappedFile *mapped_file)
{
    return mapped_file ? mapped_file->contents : NULL;
}

void
bgc_glib_mapped_file_unref(GMappedFile *mapped_file)
{
    if (!mapped_file)
        return;
    free(mapped_file->contents);
    free(mapped_file);
}

void
bgc_glib_error_free(GError *error)
{
    if (!error)
        return;
    free(error->message);
    free(error);
}

char *
getDataDir(void)
{
    return datadir;
}

char *
getPkgDataDir(void)
{
    return pkg_datadir;
}

char *
getDocDir(void)
{
    return docdir;
}

void
PrintSystemError(const char *message)
{
    fprintf(stderr, "%s: %s\n", message ? message : "GNUbg", strerror(errno));
}

void
PrintError(const char *message)
{
    fprintf(stderr, "%s\n", message ? message : "GNUbg error");
}

FILE *
GetTemporaryFile(const char *nameTemplate, char **retName)
{
    (void) nameTemplate;
    if (retName)
        *retName = NULL;
    errno = ENOTSUP;
    return NULL;
}

void
output_initialize(void)
{
    foutput_on = TRUE;
}

void
output(const char *message)
{
    if (foutput_on && !cOutputDisabled && message)
        fputs(message, stdout);
}

void
outputl(const char *message)
{
    output(message);
    if (foutput_on && !cOutputDisabled)
        fputc('\n', stdout);
}

void
outputc(const char character)
{
    if (foutput_on && !cOutputDisabled)
        fputc(character, stdout);
}

void
outputerr(const char *message)
{
    if (message)
        fprintf(stderr, "%s: %s\n", message, strerror(errno));
}

void
outputv(const char *format, va_list arguments)
{
    if (foutput_on && !cOutputDisabled && format)
        vfprintf(stdout, format, arguments);
}

void
outputf(const char *format, ...)
{
    va_list arguments;

    va_start(arguments, format);
    outputv(format, arguments);
    va_end(arguments);
}

void
outputerrv(const char *format, va_list arguments)
{
    if (format)
        vfprintf(stderr, format, arguments);
}

void
outputerrf(const char *format, ...)
{
    va_list arguments;

    va_start(arguments, format);
    outputerrv(format, arguments);
    va_end(arguments);
}

void
outputx(void)
{
}

void
outputpostpone(void)
{
    cOutputPostponed++;
}

void
outputresume(void)
{
    if (cOutputPostponed > 0)
        cOutputPostponed--;
}

void
outputnew(void)
{
}

void
outputoff(void)
{
    cOutputDisabled++;
}

void
outputon(void)
{
    if (cOutputDisabled > 0)
        cOutputDisabled--;
}

void
print_utf8_to_locale(const gchar *message)
{
    output(message);
}
