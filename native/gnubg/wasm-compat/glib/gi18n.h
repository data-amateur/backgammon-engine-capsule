/* SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef BGC_GNUBG_WASM_GI18N_H
#define BGC_GNUBG_WASM_GI18N_H

#define _(message) (message)
#define N_(message) (message)
#define C_(context, message) (message)
#define NC_(context, message) (message)
#define gettext(message) (message)
#define ngettext(singular, plural, count) \
    ((count) == 1 ? (singular) : (plural))

#endif
