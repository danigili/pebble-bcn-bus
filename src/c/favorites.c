#include "app.h"

// Each favourite lives in its own persistent key: a packed string of all of
// them would blow past the 256 byte limit of a single persisted value.
#define PK_FAV_COUNT  2
#define PK_FAV_BASE 100

static Stop s_favs[MAX_FAVS];
static int  s_count;

static void favs_store(void) {
  persist_write_int(PK_FAV_COUNT, s_count);
  for (int i = 0; i < s_count; i++) {
    persist_write_data(PK_FAV_BASE + i, &s_favs[i], sizeof(Stop));
  }
}

void favs_load(void) {
  s_count = 0;
  if (!persist_exists(PK_FAV_COUNT)) return;

  int stored = persist_read_int(PK_FAV_COUNT);
  if (stored < 0) stored = 0;
  if (stored > MAX_FAVS) stored = MAX_FAVS;

  for (int i = 0; i < stored; i++) {
    if (persist_get_size(PK_FAV_BASE + i) != sizeof(Stop)) continue;
    if (persist_read_data(PK_FAV_BASE + i, &s_favs[s_count], sizeof(Stop)) ==
        (int)sizeof(Stop)) {
      // Guard against a truncated write leaving unterminated strings behind.
      s_favs[s_count].code[CODE_LEN - 1] = '\0';
      s_favs[s_count].name[NAME_LEN - 1] = '\0';
      if (s_favs[s_count].code[0] != '\0') s_count++;
    }
  }
}

int favs_count(void) {
  return s_count;
}

const Stop *favs_get(int index) {
  if (index < 0 || index >= s_count) return NULL;
  return &s_favs[index];
}

static int favs_index_of(const char *code) {
  for (int i = 0; i < s_count; i++) {
    if (strcmp(s_favs[i].code, code) == 0) return i;
  }
  return -1;
}

bool favs_contains(const char *code) {
  return favs_index_of(code) >= 0;
}

bool favs_add(const Stop *stop) {
  if (stop == NULL || stop->code[0] == '\0') return false;
  if (favs_contains(stop->code)) return true;
  if (s_count >= MAX_FAVS) return false;

  s_favs[s_count] = *stop;
  s_count++;
  favs_store();
  comm_sync_favs();
  return true;
}

bool favs_remove(const char *code) {
  int index = favs_index_of(code);
  if (index < 0) return false;

  for (int i = index; i + 1 < s_count; i++) s_favs[i] = s_favs[i + 1];
  s_count--;
  favs_store();
  comm_sync_favs();
  return true;
}

// Replaces the whole list with what the settings page sent down. Destroys
// the payload while parsing it.
void favs_set_from_payload(char *payload) {
  s_count = 0;

  char *cursor = payload;
  char *record;
  while ((record = str_split(&cursor, ';')) != NULL && s_count < MAX_FAVS) {
    if (record[0] == '\0') continue;

    char *field = record;
    char *code = str_split(&field, '|');
    char *name = str_split(&field, '|');
    if (code == NULL || code[0] == '\0') continue;

    str_copy(s_favs[s_count].code, code, CODE_LEN);
    str_copy(s_favs[s_count].name, (name && name[0]) ? name : code, NAME_LEN);
    s_count++;
  }
  favs_store();
}

void favs_encode(char *out, size_t cap) {
  size_t used = 0;
  out[0] = '\0';

  for (int i = 0; i < s_count; i++) {
    int written = snprintf(out + used, cap - used, "%s|%s;",
                           s_favs[i].code, s_favs[i].name);
    if (written < 0 || (size_t)written >= cap - used) break;
    used += written;
  }
}
