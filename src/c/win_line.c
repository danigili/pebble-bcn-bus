#include "app.h"

#define REFRESH_MS 30000
#define SHOWN_BUSES  2      // the next two of this line, and only those
#define BAND_H      28      // the line's own colour, with its number on it
#define STOP_H      18      // which stop all this is about
#define HEADER_H    (BAND_H + STOP_H)

// One line at one stop: its next two buses, filtered out of the arrivals the
// stop screen is drawing from.

static Window     *s_window;
static StatusBarLayer *s_status;
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

// This line's buses, soonest first: g_arrivals is already in time order.
static int collect(const Arrival **out, int max) {
  int found = 0;
  for (int i = 0; i < g_arrival_count && found < max; i++) {
    if (strcmp(g_arrivals[i].line, s_line) == 0) out[found++] = &g_arrivals[i];
  }
  return found;
}

// Where the first bus of this line is headed.
// This line's colour, from any of its buses.
static GColor line_color(void) {
  for (int i = 0; i < g_arrival_count; i++) {
    if (strcmp(g_arrivals[i].line, s_line) == 0) {
      return ui_arrival_color(&g_arrivals[i]);
    }
  }
  return ui_line_color(s_line);
}

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

  graphics_context_set_fill_color(ctx, line_color());
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

  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, s_stop.name, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(inset, y + BAND_H - 2, text_w - 46, STOP_H),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_draw_text(ctx, s_stop.code, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(bounds.size.w - inset - 40, y + BAND_H - 2, 40, STOP_H),
                     GTextOverflowModeFill, GTextAlignmentRight, NULL);
}

// The number in large type, the unit small beside it, numbers aligned to a
// column so the two buses read under each other. A bus pulling in has a word
// instead, which takes the whole row.
static void draw_wait(GContext *ctx, GRect row, const Arrival *arrival) {
  bool wide = row.size.w >= 180;
  int mid = row.origin.y + row.size.h / 2;

  graphics_context_set_text_color(ctx, GColorBlack);

  if (arrival->mins == 0) {
    const char *font = wide ? FONT_KEY_GOTHIC_28_BOLD : FONT_KEY_GOTHIC_24_BOLD;
    graphics_draw_text(ctx, i18n(T_ARRIVING), fonts_get_system_font(font),
                       GRect(4, mid - 18, row.size.w - 8, 36),
                       GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    return;
  }

  char number[12];
  if (arrival->mins < 0) {
    str_copy(number, "--", sizeof(number));
  } else {
    snprintf(number, sizeof(number), "%d", arrival->mins);
  }

  int column = row.size.w * 52 / 100;   // where the numbers end and min begins
  int big_h = wide ? 46 : 34;

  graphics_draw_text(ctx, number,
                     fonts_get_system_font(wide ? FONT_KEY_BITHAM_42_BOLD
                                                : FONT_KEY_BITHAM_30_BLACK),
                     GRect(4, mid - big_h / 2 - 2, column - 4, big_h + 4),
                     GTextOverflowModeFill, GTextAlignmentRight, NULL);

  graphics_draw_text(ctx, i18n(T_MIN),
                     fonts_get_system_font(wide ? FONT_KEY_GOTHIC_24_BOLD
                                                : FONT_KEY_GOTHIC_18),
                     GRect(column + 5, mid - (wide ? 14 : 11),
                           row.size.w - column - 9, wide ? 28 : 22),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
}

static void layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int header_y = PBL_IF_ROUND_ELSE(8, 0);   // the status bar already took the top
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

  for (int i = 0; i < SHOWN_BUSES; i++) {
    GRect row = GRect(0, body_y + i * row_h, bounds.size.w, row_h);

    if (i > 0) {
      graphics_context_set_stroke_color(ctx, GColorBlack);
      graphics_draw_line(ctx, GPoint(row.origin.x + 6, row.origin.y),
                         GPoint(row.origin.x + row.size.w - 6, row.origin.y));
    }

    if (i < count) {
      draw_wait(ctx, row, next[i]);
    } else {
      graphics_context_set_text_color(ctx, GColorBlack);
      graphics_draw_text(ctx, i18n(T_NO_MORE),
                         fonts_get_system_font(FONT_KEY_GOTHIC_14),
                         GRect(4, row.origin.y + row.size.h / 2 - 10,
                               row.size.w - 8, 20),
                         GTextOverflowModeTrailingEllipsis,
                         GTextAlignmentCenter, NULL);
    }
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
  s_layer = layer_create(ui_content_bounds(window));
  layer_set_update_proc(s_layer, layer_update);
  layer_add_child(root, s_layer);
  s_status = ui_status_bar_add(window);

  window_set_click_config_provider(window, click_config);

  s_prev_handler = comm_set_handler(on_message);
  request_times();
}

static void window_unload(Window *window) {
  if (s_refresh_timer != NULL) app_timer_cancel(s_refresh_timer);
  s_refresh_timer = NULL;

  comm_set_handler(s_prev_handler);
  status_bar_layer_destroy(s_status);
  s_status = NULL;
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
