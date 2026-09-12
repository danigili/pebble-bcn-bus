#include "app.h"

#define REFRESH_MS 30000
#define SHOWN_BUSES  2      // the next two of this line, and only those
#define BAND_H      28      // the line's own colour, with its number on it
#define STOP_H      18      // which stop all this is about
#define HEADER_H    (BAND_H + STOP_H)

// The detail of one line at one stop, reached by picking it out of the
// stop's list: when the next bus of that line comes, and when the one after
// it does. Two numbers, as big as they go.
//
// The arrivals come from the same globals the list draws from — the phone
// sends every bus it knows about, one entry each — so this window filters
// them by line rather than asking for anything new.

static Window     *s_window;
static Layer      *s_layer;
static CommHandler s_prev_handler;
static Stop        s_stop;
static char        s_line[LINE_LEN];
static DataState   s_state;
static AppTimer   *s_refresh_timer;

static void request_times(void);

static void mark_dirty(void) {
  if (s_layer != NULL) layer_mark_dirty(s_layer);
}

static void refresh_timer_cb(void *data) {
  s_refresh_timer = NULL;
  request_times();
}

static void request_times(void) {
  comm_req_times(s_stop.code);

  if (s_refresh_timer != NULL) app_timer_cancel(s_refresh_timer);
  s_refresh_timer = app_timer_register(REFRESH_MS, refresh_timer_cb, NULL);

  mark_dirty();
}

// ---------------------------------------------------------------- data

// The soonest buses of this line, in order. The phone has already sorted
// every arrival by waiting time, so taking them as they come keeps that.
static int collect(const Arrival **out, int max) {
  int found = 0;
  for (int i = 0; i < g_arrival_count && found < max; i++) {
    if (strcmp(g_arrivals[i].line, s_line) == 0) out[found++] = &g_arrivals[i];
  }
  return found;
}

// Whatever the API calls the far end of this line. Only the first bus is
// asked: two buses of the same line can be running different trips, and the
// one you are waiting for is the first.
static const char *destination(void) {
  for (int i = 0; i < g_arrival_count; i++) {
    if (strcmp(g_arrivals[i].line, s_line) == 0) return g_arrivals[i].dest;
  }
  return "";
}

static const char *status_text(void) {
  switch (s_state) {
    case DS_LOADING: return i18n(T_LOADING);
    case DS_ERROR:   return g_error[0] ? g_error : i18n(T_ERROR);
    default:         return i18n(T_NO_BUSES);
  }
}

// ------------------------------------------------------------- drawing

static void draw_header(GContext *ctx, GRect bounds, int y) {
  int inset = PBL_IF_ROUND_ELSE(28, 5);
  int text_w = bounds.size.w - inset * 2;

  // The band takes the line's own colour, so the badge from the list turns
  // into the whole strip and the line needs no second mention.
  graphics_context_set_fill_color(ctx, ui_line_color(s_line));
  graphics_fill_rect(ctx, GRect(0, y, bounds.size.w, BAND_H), 0, GCornerNone);

  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, s_line, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(inset, y - 3, text_w, 28),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);

  const char *dest = destination();
  if (dest[0] != '\0') {
    graphics_draw_text(ctx, dest, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(inset + 52, y + 5, text_w - 52, 20),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentRight,
                       NULL);
  }

  // Which stop these times are for, since the same line stops at plenty.
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, s_stop.name, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(inset, y + BAND_H - 2, text_w - 46, STOP_H),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_draw_text(ctx, s_stop.code, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(bounds.size.w - inset - 40, y + BAND_H - 2, 40, STOP_H),
                     GTextOverflowModeFill, GTextAlignmentRight, NULL);
}

// "8 min", or the word for a bus pulling in, or "--" with no estimate.
static void format_minutes(const Arrival *arrival, char *out, size_t cap,
                           const char **font) {
  *font = FONT_KEY_GOTHIC_28_BOLD;

  if (arrival->mins < 0) {
    str_copy(out, "--", cap);
  } else if (arrival->mins == 0) {
    str_copy(out, i18n(T_ARRIVING), cap);
    *font = FONT_KEY_GOTHIC_24_BOLD;
  } else {
    snprintf(out, cap, "%d %s", arrival->mins, i18n(T_MIN));
  }
}

static void layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int header_y = PBL_IF_ROUND_ELSE(22, 0);
  int body_y = header_y + HEADER_H;
  int body_h = bounds.size.h - body_y - PBL_IF_ROUND_ELSE(12, 0);

  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  draw_header(ctx, bounds, header_y);

  const Arrival *next[SHOWN_BUSES];
  int count = (s_state == DS_OK) ? collect(next, SHOWN_BUSES) : 0;

  if (count == 0) {
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, status_text(),
                       fonts_get_system_font(FONT_KEY_GOTHIC_18),
                       GRect(8, body_y + (body_h - 26) / 2, bounds.size.w - 16, 26),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter,
                       NULL);
    return;
  }

  int row_h = body_h / SHOWN_BUSES;

  for (int i = 0; i < count; i++) {
    int row_y = body_y + i * row_h;
    char minutes[16];
    const char *font;
    format_minutes(next[i], minutes, sizeof(minutes), &font);

    if (i > 0) {
      graphics_context_set_stroke_color(ctx, GColorBlack);
      graphics_draw_line(ctx, GPoint(6, row_y), GPoint(bounds.size.w - 6, row_y));
    }

    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, minutes, fonts_get_system_font(font),
                       GRect(4, row_y + (row_h - 34) / 2, bounds.size.w - 8, 38),
                       GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  }
}

// -------------------------------------------------------------- window

static void select_click(ClickRecognizerRef ref, void *context) {
  s_state = DS_LOADING;
  request_times();
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

static void on_message(int msg_type) {
  if (s_layer == NULL) return;

  switch (msg_type) {
    case MSG_TIMES: s_state = (g_arrival_count > 0) ? DS_OK : DS_EMPTY; break;
    case MSG_ERROR: s_state = DS_ERROR; break;
    default: return;
  }
  mark_dirty();
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer, layer_update);
  layer_add_child(root, s_layer);

  window_set_click_config_provider(window, click_config);

  s_prev_handler = comm_set_handler(on_message);
  // The list underneath has just been showing these very times, so they go
  // up straight away and the refresh happens underneath them.
  request_times();
}

static void window_unload(Window *window) {
  if (s_refresh_timer != NULL) app_timer_cancel(s_refresh_timer);
  s_refresh_timer = NULL;

  comm_set_handler(s_prev_handler);
  layer_destroy(s_layer);
  s_layer = NULL;
  window_destroy(window);
  s_window = NULL;
}

void win_line_push(const Stop *stop, const char *line) {
  s_stop = *stop;
  str_copy(s_line, line, sizeof(s_line));
  s_state = (g_arrival_count > 0) ? DS_OK : DS_LOADING;

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
