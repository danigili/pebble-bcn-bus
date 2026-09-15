#include "app.h"

#define PK_LANG 3

static Lang s_lang = LANG_CA;

static const char *const s_strings[T_STR_COUNT][LANG_COUNT] = {
  // Catalan            Spanish              English
  { "Preferides",       "Favoritas",         "Favourites"      },  // T_FAVOURITES
  { "A prop meu",       "Cerca de mí",  "Nearby"          },  // T_NEARBY
  { "Cercar per codi",  "Buscar por código", "Search by code" }, // T_BY_CODE
  { "Carregant…",  "Cargando…",    "Loading…"   },  // T_LOADING
  { "Cap bus ara",      "Ningún bus",   "No buses now"    },  // T_NO_BUSES
  { "Error",            "Error",             "Error"           },  // T_ERROR
  { "Cap preferida",    "Sin favoritas",     "No favourites"   },  // T_NO_FAVS
  { "Cap parada a prop","Ninguna cerca",     "None nearby"     },  // T_NO_NEARBY
  { "Arribant",         "Llegando",          "Arriving"        },  // T_ARRIVING
  { "min",              "min",               "min"             },  // T_MIN
  { "Desada",           "Guardada",          "Saved"           },  // T_ADDED
  { "Esborrada",        "Borrada",           "Removed"         },  // T_REMOVED
  { "Codi de parada",   "Código parada","Stop code"       },  // T_STOP_CODE
  { "Mantingues central: cerca", "Mantén central: buscar",
    "Hold Select: search" },                                    // T_HOLD_SEARCH
  { "Amunt/Avall: xifra\nCentral: xifra nova",
    "Arriba/Abajo: cifra\nCentral: nueva cifra",
    "Up/Down: digit\nSelect: new digit" },                       // T_BTN_LEGEND
  { "Sense mòbil", "Sin móvil",    "No phone"        },  // T_NO_PHONE
  { "Preferides plenes","Favoritas llenas",  "Favourites full" },  // T_FAV_FULL
  { "Mantingues per desar", "Mantén para guardar", "Hold to save" }, // T_HOLD_TO_SAVE
  { "Parada",           "Parada",            "Stop"            },  // T_STOP
  { "Cap més previst",  "Ninguno más",       "No more yet"     },  // T_NO_MORE
};

const char *i18n(StrId id) {
  if ((unsigned)id >= T_STR_COUNT) return "";
  return s_strings[id][s_lang];
}

// Read at startup, so the first frame is already in the right language
// instead of Catalan until the phone gets a word in.
void lang_load(void) {
  if (!persist_exists(PK_LANG)) return;

  int32_t stored = persist_read_int(PK_LANG);
  if (stored >= 0 && stored < LANG_COUNT) s_lang = (Lang)stored;
}

void lang_set(Lang lang) {
  if ((unsigned)lang >= LANG_COUNT || lang == s_lang) return;

  s_lang = lang;
  persist_write_int(PK_LANG, (int32_t)lang);
}

Lang lang_get(void) {
  return s_lang;
}

char *str_split(char **cursor, char sep) {
  if (*cursor == NULL || **cursor == '\0') return NULL;

  char *start = *cursor;
  char *found = strchr(start, sep);
  if (found) {
    *found = '\0';
    *cursor = found + 1;
  } else {
    *cursor = start + strlen(start);
  }
  return start;
}

// A stop sign pads the code out to four digits; the service does not know
// it that way. "0828" is 828. All zeros keeps one, so the code stays a code
// and the service can say it does not exist.
void str_drop_leading_zeros(char *text) {
  if (text == NULL) return;

  size_t skip = 0;
  while (text[skip] == '0' && text[skip + 1] != '\0') skip++;
  if (skip == 0) return;

  size_t i = 0;
  while (text[skip + i] != '\0') {
    text[i] = text[skip + i];
    i++;
  }
  text[i] = '\0';
}

void str_copy(char *dst, const char *src, size_t cap) {
  if (cap == 0) return;
  if (src == NULL) { dst[0] = '\0'; return; }

  size_t i = 0;
  for (; i + 1 < cap && src[i] != '\0'; i++) dst[i] = src[i];
  dst[i] = '\0';
}
