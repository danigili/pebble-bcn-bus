#include "app.h"

Arrival g_arrivals[MAX_ARRIVALS];
int     g_arrival_count;
Stop    g_nearby[MAX_NEARBY];
int     g_nearby_count;
int     g_nearby_dist[MAX_NEARBY];
char    g_error[ERR_LEN];
char    g_title[NAME_LEN];

static CommHandler s_handler;
static bool        s_ready;
static char        s_payload[PAYLOAD_LEN];

// PebbleKit JS sends plain numbers as int32, but be tolerant of a phone
// library that packs them smaller.
static int32_t tuple_int(Tuple *tuple) {
  if (tuple == NULL) return 0;
  switch (tuple->length) {
    case 1:  return tuple->value->int8;
    case 2:  return tuple->value->int16;
    default: return tuple->value->int32;
  }
}

static void copy_payload(Tuple *tuple) {
  s_payload[0] = '\0';
  if (tuple != NULL) str_copy(s_payload, tuple->value->cstring, PAYLOAD_LEN);
}

// A colour arrives as the two hex digits of the watch's own colour byte:
// two bits a channel, which is all the screen has. Spread back out to the
// hex triplet GColorFromHEX wants. Six digits are taken as they come, and
// nothing at all means TMB had no colour for that line.
static uint32_t parse_color(const char *text) {
  if (text == NULL || text[0] == '\0') return 0;

  uint32_t value = (uint32_t)strtoul(text, NULL, 16);
  if (strlen(text) > 2) return value;

  uint32_t hex = 0;
  for (int i = 0; i < 3; i++) {
    uint32_t channel = (value >> (4 - i * 2)) & 0x3;
    hex |= (channel * 85) << (16 - i * 8);
  }
  return hex;
}

// A bus with no estimate goes last, never first.
static int wait_of(const Arrival *arrival) {
  return (arrival->mins < 0) ? 100000 : arrival->mins;
}

// The phone chooses what fits in the message by line —every line's next bus
// before anyone's second— so what arrives is not in time order. Put it back:
// the list reads as a stop's departure board.
static void sort_arrivals(void) {
  for (int i = 1; i < g_arrival_count; i++) {
    Arrival pending = g_arrivals[i];
    int j = i - 1;
    while (j >= 0 && wait_of(&g_arrivals[j]) > wait_of(&pending)) {
      g_arrivals[j + 1] = g_arrivals[j];
      j--;
    }
    g_arrivals[j + 1] = pending;
  }
}

static void parse_arrivals(char *payload) {
  g_arrival_count = 0;

  char *cursor = payload;
  char *record;
  while ((record = str_split(&cursor, ';')) != NULL &&
         g_arrival_count < MAX_ARRIVALS) {
    if (record[0] == '\0') continue;

    char *field = record;
    char *line = str_split(&field, '|');
    char *mins = str_split(&field, '|');
    char *dest = str_split(&field, '|');
    char *color = str_split(&field, '|');
    if (line == NULL || line[0] == '\0') continue;

    Arrival *arrival = &g_arrivals[g_arrival_count];
    str_copy(arrival->line, line, LINE_LEN);
    str_copy(arrival->dest, dest ? dest : "", DEST_LEN);
    arrival->mins = (mins && mins[0]) ? atoi(mins) : -1;
    arrival->color = parse_color(color);

    // Where the destination or the colour were left out, they are the ones
    // already given for this line: the phone only says them once.
    if (arrival->dest[0] == '\0' || arrival->color == 0) {
      for (int i = 0; i < g_arrival_count; i++) {
        if (strcmp(g_arrivals[i].line, arrival->line) != 0) continue;
        if (arrival->dest[0] == '\0') {
          str_copy(arrival->dest, g_arrivals[i].dest, DEST_LEN);
        }
        if (arrival->color == 0) arrival->color = g_arrivals[i].color;
        break;
      }
    }
    g_arrival_count++;
  }

  sort_arrivals();
}

// Third field, where there is one, is how far away the stop is in metres.
static int parse_stops(char *payload, Stop *out, int *dists, int max) {
  int count = 0;

  char *cursor = payload;
  char *record;
  while ((record = str_split(&cursor, ';')) != NULL && count < max) {
    if (record[0] == '\0') continue;

    char *field = record;
    char *code = str_split(&field, '|');
    char *name = str_split(&field, '|');
    char *dist = str_split(&field, '|');
    if (code == NULL || code[0] == '\0') continue;

    str_copy(out[count].code, code, CODE_LEN);
    str_copy(out[count].name, (name && name[0]) ? name : code, NAME_LEN);
    if (dists != NULL) dists[count] = (dist && dist[0]) ? atoi(dist) : -1;
    count++;
  }
  return count;
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *lang = dict_find(iter, MESSAGE_KEY_LANG);
  if (lang != NULL) lang_set((Lang)tuple_int(lang));

  Tuple *type_tuple = dict_find(iter, MESSAGE_KEY_MSG_TYPE);
  if (type_tuple == NULL) return;
  int type = (int)tuple_int(type_tuple);

  Tuple *payload = dict_find(iter, MESSAGE_KEY_PAYLOAD);
  Tuple *title = dict_find(iter, MESSAGE_KEY_TITLE);

  switch (type) {
    case MSG_READY:
      s_ready = true;
      comm_sync_favs();
      break;

    case MSG_FAVS:
      copy_payload(payload);
      favs_set_from_payload(s_payload);
      break;

    case MSG_TIMES:
      if (title != NULL) str_copy(g_title, title->value->cstring, NAME_LEN);
      copy_payload(payload);
      parse_arrivals(s_payload);
      break;

    case MSG_NEARBY:
      copy_payload(payload);
      g_nearby_count = parse_stops(s_payload, g_nearby, g_nearby_dist,
                                   MAX_NEARBY);
      break;

    case MSG_ERROR:
      g_error[0] = '\0';
      if (payload != NULL) str_copy(g_error, payload->value->cstring, ERR_LEN);
      if (g_error[0] == '\0') str_copy(g_error, i18n(T_ERROR), ERR_LEN);
      break;

    default:
      return;
  }

  if (s_handler != NULL) s_handler(type);
}

static void inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "inbox dropped: %d", (int)reason);
  str_copy(g_error, i18n(T_ERROR), ERR_LEN);
  if (s_handler != NULL) s_handler(MSG_ERROR);
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason,
                          void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "outbox failed: %d", (int)reason);
  str_copy(g_error, i18n(T_NO_PHONE), ERR_LEN);
  if (s_handler != NULL) s_handler(MSG_ERROR);
}

static void send(int cmd, const char *code, const char *payload) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) return;

  dict_write_int32(iter, MESSAGE_KEY_CMD, cmd);
  if (code != NULL) dict_write_cstring(iter, MESSAGE_KEY_STOP_CODE, code);
  if (payload != NULL) dict_write_cstring(iter, MESSAGE_KEY_PAYLOAD, payload);
  app_message_outbox_send();
}

void comm_init(void) {
  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_failed(outbox_failed);

  AppMessageResult result = app_message_open(2048, 512);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "app_message_open(2048): %d", (int)result);
    app_message_open(512, 256);
  }
}

CommHandler comm_set_handler(CommHandler handler) {
  CommHandler previous = s_handler;
  s_handler = handler;
  return previous;
}

void comm_req_times(const char *code) {
  send(CMD_REQ_TIMES, code, NULL);
}

void comm_req_nearby(void) {
  send(CMD_REQ_NEARBY, NULL, NULL);
}

void comm_sync_favs(void) {
  if (!s_ready) return;

  static char encoded[PAYLOAD_LEN];
  favs_encode(encoded, sizeof(encoded));
  send(CMD_SYNC_FAVS, NULL, encoded);
}

bool comm_ready(void) {
  return s_ready;
}
