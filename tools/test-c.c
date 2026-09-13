/*
 * Runs the watch-side string and favourites logic on the host, against the
 * stub pebble.h. Verifies the seam that matters most: a payload encoded by
 * the phone must parse back into exactly the same stops on the watch.
 *
 * Build and run: see tools/run-tests.sh
 */

#include "app.h"

static int failures;
static int checks;

static void check_str(const char *name, const char *actual, const char *expected) {
  checks++;
  if (strcmp(actual, expected) == 0) {
    printf("  ok   %s\n", name);
  } else {
    failures++;
    printf("  FAIL %s\n         expected \"%s\"\n         actual   \"%s\"\n",
           name, expected, actual);
  }
}

static void check_int(const char *name, int actual, int expected) {
  checks++;
  if (actual == expected) {
    printf("  ok   %s\n", name);
  } else {
    failures++;
    printf("  FAIL %s\n         expected %d, actual %d\n", name, actual, expected);
  }
}

static void check_true(const char *name, bool value) {
  check_int(name, value ? 1 : 0, 1);
}

int main(void) {
  char buffer[256];

  printf("\nstr_split\n");
  {
    char text[] = "a|bb|ccc";
    char *cursor = text;
    check_str("first field", str_split(&cursor, '|'), "a");
    check_str("second field", str_split(&cursor, '|'), "bb");
    check_str("last field", str_split(&cursor, '|'), "ccc");
    check_true("exhausted returns NULL", str_split(&cursor, '|') == NULL);
  }
  {
    char text[] = "a||c";
    char *cursor = text;
    str_split(&cursor, '|');
    check_str("an empty field is preserved", str_split(&cursor, '|'), "");
  }
  {
    char text[] = "";
    char *cursor = text;
    check_true("an empty string yields nothing", str_split(&cursor, '|') == NULL);
  }

  printf("\nstr_copy\n");
  str_copy(buffer, "hello", sizeof(buffer));
  check_str("copies", buffer, "hello");
  {
    char small[4];
    str_copy(small, "abcdefgh", sizeof(small));
    check_str("truncates and terminates", small, "abc");
  }
  str_copy(buffer, NULL, sizeof(buffer));
  check_str("NULL becomes empty", buffer, "");

  printf("\nfavourites\n");
  favs_load();
  check_int("start empty", favs_count(), 0);

  {
    // Exactly what tools/test-pkjs.js asserts the phone encodes.
    char payload[] = "366|Casa;1122|Feina;";
    favs_set_from_payload(payload);
  }
  check_int("payload from the phone parses", favs_count(), 2);
  check_str("first code", favs_get(0)->code, "366");
  check_str("first name", favs_get(0)->name, "Casa");
  check_str("second name", favs_get(1)->name, "Feina");

  favs_encode(buffer, sizeof(buffer));
  check_str("re-encodes identically", buffer, "366|Casa;1122|Feina;");

  check_true("contains a known stop", favs_contains("366"));
  check_true("does not contain an unknown stop", !favs_contains("999"));

  {
    Stop stop;
    memset(&stop, 0, sizeof(stop));
    str_copy(stop.code, "742", CODE_LEN);
    str_copy(stop.name, "Parada 742", NAME_LEN);
    check_true("adds a new stop", favs_add(&stop));
    check_int("count grew", favs_count(), 3);
    check_true("adding the same stop twice is a no-op", favs_add(&stop));
    check_int("count unchanged", favs_count(), 3);
  }

  check_true("removes", favs_remove("1122"));
  check_int("count shrank", favs_count(), 2);
  check_true("removing something absent fails", !favs_remove("1122"));
  favs_encode(buffer, sizeof(buffer));
  check_str("order preserved after removal", buffer, "366|Casa;742|Parada 742;");

  {
    // A stop saved from the watch has no name until the API supplies one.
    char payload[] = "500|;";
    favs_set_from_payload(payload);
    check_str("a nameless stop falls back to its code", favs_get(0)->name, "500");
  }

  {
    char payload[] = "";
    favs_set_from_payload(payload);
    check_int("an empty payload clears the list", favs_count(), 0);
  }

  {
    // More favourites than the watch keeps room for.
    char payload[512];
    buffer[0] = '\0';
    int used = 0;
    for (int i = 0; i < MAX_FAVS + 5; i++) {
      used += snprintf(payload + used, sizeof(payload) - used, "%d|Stop %d;", i, i);
    }
    favs_set_from_payload(payload);
    check_int("the list is capped, not overrun", favs_count(), MAX_FAVS);
  }

  printf("\ni18n\n");
  lang_set(LANG_ES);
  check_str("spanish", i18n(T_FAVOURITES), "Favoritas");
  lang_set(LANG_EN);
  check_str("english", i18n(T_FAVOURITES), "Favourites");
  lang_set(LANG_CA);
  check_str("catalan", i18n(T_FAVOURITES), "Preferides");
  check_str("an out of range id is empty, not a crash", i18n((StrId)999), "");

  printf("\n%s\n", failures == 0
      ? "all checks passed"
      : "SOME CHECKS FAILED");
  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
