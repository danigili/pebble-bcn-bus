/*
 * Drives the real payload decoder from src/c/comm.c on the host.
 *
 * The decoder and its sort are file-static — they are plumbing, not API —
 * so the file is included rather than linked, which tests the code that
 * actually runs instead of a copy of it. The watch services it calls are
 * stood in for here; nothing is sent anywhere.
 */

#include <stdio.h>
#include "app.h"

// --------------------------------------------------------------- stubs

void app_message_register_inbox_received(void (*cb)(DictionaryIterator *, void *)) {}
void app_message_register_inbox_dropped(void (*cb)(AppMessageResult, void *)) {}
void app_message_register_outbox_failed(
    void (*cb)(DictionaryIterator *, AppMessageResult, void *)) {}
AppMessageResult app_message_open(uint32_t inbox, uint32_t outbox) { return APP_MSG_OK; }
AppMessageResult app_message_outbox_begin(DictionaryIterator **iter) { return APP_MSG_OK; }
AppMessageResult app_message_outbox_send(void) { return APP_MSG_OK; }
Tuple *dict_find(const DictionaryIterator *iter, uint32_t key) { return NULL; }
uint32_t dict_write_int32(DictionaryIterator *i, uint32_t k, int32_t v) { return 0; }
uint32_t dict_write_cstring(DictionaryIterator *i, uint32_t k, const char *v) { return 0; }

// Favourites are along for the ride: comm.c syncs them. Nothing is kept.
bool persist_exists(uint32_t key) { return false; }
int persist_get_size(uint32_t key) { return -1; }
int32_t persist_read_int(uint32_t key) { return 0; }
int persist_read_data(uint32_t key, void *buffer, size_t size) { return -1; }
int persist_write_int(uint32_t key, int32_t value) { return 0; }
int persist_write_data(uint32_t key, const void *data, size_t size) { return (int)size; }

#include "comm.c"

// ---------------------------------------------------------------- test

static int checks;
static int failures;

static void check(const char *name, const char *got, const char *want) {
  checks++;
  if (strcmp(got, want) == 0) {
    printf("  ok   %s\n", name);
  } else {
    failures++;
    printf("  FAIL %s\n         want %s\n         got  %s\n", name, want, got);
  }
}

// What the watch ends up holding, as "line:minutes" in the order it holds it.
static void decode(const char *payload, char *out, size_t cap) {
  char buffer[PAYLOAD_LEN];
  str_copy(buffer, payload, sizeof(buffer));
  parse_arrivals(buffer);

  out[0] = '\0';
  for (int i = 0; i < g_arrival_count; i++) {
    char one[40];
    snprintf(one, sizeof(one), "%s%s:%d", i ? " " : "",
             g_arrivals[i].line, g_arrivals[i].mins);
    strncat(out, one, cap - strlen(out) - 1);
  }
}

int main(void) {
  char got[512];

  printf("\narrivals\n");

  // The phone fills the message by line — every line's next bus before
  // anyone's second — so this is the order it arrives in.
  decode("V31|1|A;V33|4|B;H8|6|C;V31|10|A;V33|14|B;H8|21|C;", got, sizeof(got));
  check("sorted back into the order they turn up at the stop", got,
        "V31:1 V33:4 H8:6 V31:10 V33:14 H8:21");

  decode("H8|21|C;V31|1|A;V33|4|B;", got, sizeof(got));
  check("whatever order they came in", got, "V31:1 V33:4 H8:21");

  decode("V31|-1|A;V33|4|B;V31|0|A;", got, sizeof(got));
  check("no estimate goes last, arriving goes first", got,
        "V31:0 V33:4 V31:-1");

  decode("V31|8|A;", got, sizeof(got));
  check("one on its own", got, "V31:8");

  decode("", got, sizeof(got));
  check("an empty payload holds nothing", got, "");

  decode("V31|5|A;|9|B;X|;", got, sizeof(got));
  check("records with no line are dropped, the rest survive", got,
        "V31:5 X:-1");

  printf("\nnearby\n");

  char stops[PAYLOAD_LEN];
  str_copy(stops, "366|Pl Catalunya|14;1122|Gran Via|135;999|Sense|;",
           sizeof(stops));
  g_nearby_count = parse_stops(stops, g_nearby, g_nearby_dist, MAX_NEARBY);

  checks++;
  if (g_nearby_count == 3 && g_nearby_dist[0] == 14 && g_nearby_dist[1] == 135 &&
      g_nearby_dist[2] == -1 && strcmp(g_nearby[1].name, "Gran Via") == 0) {
    printf("  ok   distances ride along, and -1 where there is none\n");
  } else {
    failures++;
    printf("  FAIL distances: %d stops, %d %d %d\n", g_nearby_count,
           g_nearby_dist[0], g_nearby_dist[1], g_nearby_dist[2]);
  }

  printf(failures ? "\n%d of %d checks FAILED\n" : "\nall checks passed\n",
         failures, checks);
  return failures ? 1 : 0;
}
