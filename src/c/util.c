#include "app.h"

static Lang s_lang = LANG_CA;

static const char *const s_strings[T_STR_COUNT][LANG_COUNT] = {
  // Catalan            Spanish              English
  { "Favorites",        "Favoritas",         "Favourites"      },  // T_FAVOURITES
  { "A prop meu",       "Cerca de mí",  "Nearby"          },  // T_NEARBY
  { "Cercar per codi",  "Buscar por código", "Search by code" }, // T_BY_CODE
  { "Carregant…",  "Cargando…",    "Loading…"   },  // T_LOADING
  { "Cap bus ara",      "Ningún bus",   "No buses now"    },  // T_NO_BUSES
  { "Error",            "Error",             "Error"           },  // T_ERROR
  { "Cap favorita",     "Sin favoritas",     "No favourites"   },  // T_NO_FAVS
  { "Cap parada a prop","Ninguna cerca",     "None nearby"     },  // T_NO_NEARBY
  { "Arribant",         "Llegando",          "Arriving"        },  // T_ARRIVING
  { "min",              "min",               "min"             },  // T_MIN
  { "Desada",           "Guardada",          "Saved"           },  // T_ADDED
  { "Esborrada",        "Borrada",           "Removed"         },  // T_REMOVED
  { "Codi de parada",   "Código parada","Stop code"       },  // T_STOP_CODE
  { "Mantén central: cerca", "Mantén central: buscar",
    "Hold Select: search" },                                    // T_HOLD_SEARCH
  { "Amunt/Avall: xifra\nCentral: xifra nova",
    "Arriba/Abajo: cifra\nCentral: nueva cifra",
    "Up/Down: digit\nSelect: new digit" },                       // T_BTN_LEGEND
  { "Sense mòbil", "Sin móvil",    "No phone"        },  // T_NO_PHONE
  { "Favorites plenes", "Favoritas llenas",  "Favourites full" },  // T_FAV_FULL
  { "Mantén per desar", "Mantén para guardar", "Hold to save" }, // T_HOLD_TO_SAVE
  { "Parada",           "Parada",            "Stop"            },  // T_STOP
};

const char *i18n(StrId id) {
  if ((unsigned)id >= T_STR_COUNT) return "";
  return s_strings[id][s_lang];
}

void lang_set(Lang lang) {
  if ((unsigned)lang < LANG_COUNT) s_lang = lang;
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

void str_copy(char *dst, const char *src, size_t cap) {
  if (cap == 0) return;
  if (src == NULL) { dst[0] = '\0'; return; }

  size_t i = 0;
  for (; i + 1 < cap && src[i] != '\0'; i++) dst[i] = src[i];
  dst[i] = '\0';
}
