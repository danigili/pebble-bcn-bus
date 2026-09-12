#pragma once

#include <pebble.h>
#include <string.h>
#include <stdlib.h>

// ---------------------------------------------------------------- limits

#define MAX_FAVS      12
#define MAX_NEARBY    16
#define MAX_ARRIVALS  16

#define CODE_LEN       7
#define NAME_LEN      28
#define LINE_LEN       8
#define DEST_LEN      28
#define ERR_LEN       48
#define PAYLOAD_LEN 1024

// ------------------------------------------------------- wire protocol
//
// Payloads are packed strings rather than one dictionary key per item,
// because an AppMessage dictionary is small and every key costs overhead.
//   arrivals : "line|mins|dest;line|mins|dest;..."
//   stops    : "code|name;code|name;..."

// watch -> phone, sent as MESSAGE_KEY_CMD
#define CMD_REQ_TIMES   1
#define CMD_REQ_NEARBY  2
#define CMD_SYNC_FAVS   3

// phone -> watch, sent as MESSAGE_KEY_MSG_TYPE
#define MSG_FAVS    1
#define MSG_TIMES   2
#define MSG_ERROR   3
#define MSG_READY   4
#define MSG_NEARBY  5

// ----------------------------------------------------------------- types

typedef struct {
  char code[CODE_LEN];
  char name[NAME_LEN];
} Stop;

typedef struct {
  char line[LINE_LEN];
  char dest[DEST_LEN];
  int  mins;              // -1 when the API gave us no usable estimate
} Arrival;

typedef enum { DS_IDLE, DS_LOADING, DS_OK, DS_EMPTY, DS_ERROR } DataState;

typedef enum { LANG_CA = 0, LANG_ES, LANG_EN, LANG_COUNT } Lang;

typedef enum {
  T_FAVOURITES, T_NEARBY, T_BY_CODE, T_LOADING, T_NO_BUSES, T_ERROR,
  T_NO_FAVS, T_NO_NEARBY, T_ARRIVING, T_MIN, T_ADDED, T_REMOVED,
  T_STOP_CODE, T_HOLD_SEARCH, T_BTN_LEGEND, T_NO_PHONE, T_FAV_FULL, T_HOLD_TO_SAVE,
  T_STOP, T_STR_COUNT
} StrId;

// ------------------------------------------------------------- util.c

const char *i18n(StrId id);
void        lang_set(Lang lang);
Lang        lang_get(void);

// Splits a mutable string in place. Returns NULL once exhausted.
char *str_split(char **cursor, char sep);
void  str_copy(char *dst, const char *src, size_t cap);

// -------------------------------------------------------- favorites.c
//
// The watch owns the favourites; the phone keeps a mirror so they can be
// edited from the settings page. That way adding one still works with the
// phone out of range.

void        favs_load(void);
int         favs_count(void);
const Stop *favs_get(int index);
bool        favs_contains(const char *code);
bool        favs_add(const Stop *stop);
bool        favs_remove(const char *code);
void        favs_set_from_payload(char *payload);
void        favs_encode(char *out, size_t cap);

// ------------------------------------------------------------- comm.c

typedef void (*CommHandler)(int msg_type);

void comm_init(void);
// Returns the handler that was installed before, so a window can put it
// back when it unloads and the window underneath takes over again.
CommHandler comm_set_handler(CommHandler handler);
void comm_req_times(const char *code);
void comm_req_nearby(void);
void comm_sync_favs(void);
bool comm_ready(void);

extern Arrival g_arrivals[MAX_ARRIVALS];
extern int     g_arrival_count;
extern Stop    g_nearby[MAX_NEARBY];
extern int     g_nearby_count;
extern char    g_error[ERR_LEN];
extern char    g_title[NAME_LEN];

// ------------------------------------------------------------ windows

void win_main_push(void);
void win_favs_push(void);
void win_nearby_push(void);
void win_stop_push(const Stop *stop);
void win_keypad_push(void);

// ---------------------------------------------------------------- ui.c

void   ui_theme_menu(MenuLayer *menu);
GColor ui_line_color(const char *line);
GColor ui_accent(void);
