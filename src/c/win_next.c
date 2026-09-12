#include "app.h"

#define REFRESH_MS 30000
#define TOAST_MS    1500
#define HEADER_H      36
#define SHOWN_ROWS     2   // the next two buses, and only those

// The screen a stop opens on. It answers the one question someone at a bus
// stop is asking — when is the next bus — with the two soonest arrivals in
// two big rows, and nothing to scroll. The phone sorts by waiting time, so
// they are the first two.
//
// The full list of everything coming is still one press away: Select or Down
// push the stop screen, which is unchanged.

static Window     *s_window;
static Layer      *s_layer;
static CommHandler s_prev_handler;
static Stop        s_stop;
static DataState   s_state;
static AppTimer   *s_refresh_timer;
static AppTimer   *s_toast_timer;
static char        s_toast[24];

static void request_times(void);

static void mark_dirty(void) {
  if (s_layer != NULL) layer_mark_dirty(s_layer);
}

static void toast_expired(void *data) {
  s_toast_timer = NULL;
  s_toast[0] = '\0';
  mark_dirty();
}

static void toast(const char *text) {
  str_copy(s_toast, text, sizeof(s_toast));
  if (s_toast_timer != NULL) app_timer_cancel(s_toast_timer);
  s_toast_timer = app_timer_register(TOAST_MS, toast_expired, NULL);
  mark_dirty();
}

static void refresh_timer_cb(void *data) {
  s_refresh_timer = NULL;
  request_times();
}

static void request_times(void) {
  // Keep showing the previous times while refreshing, so the screen does not
  // blink back to "loading" every half minute.
  if (g_arrival_count == 0) s_state = DS_LOADING;

  comm_req_times(s_stop.code);

  if (s_refresh_timer != NULL) app_timer_cancel(s_refresh_timer);
  s_refresh_timer = app_timer_register(REFRESH_MS, refresh_timer_cb, NULL);

  mark_dirty();
}

static bool showing_status(void) {
  return s_state != DS_OK || g_arrival_count == 0;
}

static const char *status_text(void) {
  switch (s_state) {
    case DS_LOADING: return i18n(T_LOADING);
    case DS_ERROR:   return g_error[0] ? g_error : i18n(T_ERROR);
    default:         return i18n(T_NO_BUSES);
  }
}

static int shown_rows(void) {
  return (g_arrival_count < SHOWN_ROWS) ? g_arrival_count : SHOWN_ROWS;
}

// ------------------------------------------------------------- drawing

// "8 min", or the word for a bus pulling in, or "--" when there is no
// estimate at all. The unit is spelled out: this is the one number on the
// screen and it should read like an answer, not like a stopwatch.
static void format_minutes(const Arrival *arrival, char *out, size_t cap,
                           const char **font) {
  *font = FONT_KEY_GOTHIC_24_BOLD;

  if (arrival->mins < 0) {
    str_copy(out, "--", cap);
  } else if (arrival->mins == 0) {
    str_copy(out, i18n(T_ARRIVING), cap);
    *font = FONT_KEY_GOTHIC_18_BOLD;
  } else {
    snprintf(out, cap, "%d %s", arrival->mins, i18n(T_MIN));
  }
}

static void draw_header(GContext *ctx, GRect bounds, int y) {
  GRect band = GRect(0, y, bounds.size.w, HEADER_H);
  // The band can bleed into the bezel, but nothing written on it may: on a
  // round watch the ends of these two lines are outside the glass.
  int inset = PBL_IF_ROUND_ELSE(30, 4);
  int text_w = bounds.size.w - inset * 2;

  graphics_context_set_fill_color(ctx, ui_accent());
  graphics_fill_rect(ctx, band, 0, GCornerNone);
  graphics_context_set_text_color(ctx, GColorWhite);

  graphics_draw_text(ctx, s_toast[0] ? s_toast : s_stop.name,
                     fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(inset, y - 2, text_w - 16, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  // A filled dot marks a saved stop: no font is guaranteed to carry a star.
  if (favs_contains(s_stop.code)) {
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_circle(ctx, GPoint(bounds.size.w - inset - 7, y + 9), 4);
  }

  // The code, unless the stop has no name of its own and is already showing
  // it. Whatever else is coming is counted on the right, so showing two
  // buses never hides the rest without saying so.
  char line[NAME_LEN + 12];
  if (strcmp(s_stop.name, s_stop.code) == 0) {
    line[0] = '\0';
  } else {
    snprintf(line, sizeof(line), "%s %s", i18n(T_STOP), s_stop.code);
  }
  graphics_draw_text(ctx, line, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(inset, y + 15, text_w - 32, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  int hidden = g_arrival_count - shown_rows();
  if (hidden > 0) {
    char more[12];
    snprintf(more, sizeof(more), "+%d", hidden);
    graphics_draw_text(ctx, more, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(bounds.size.w - inset - 30, y + 15, 30, 18),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
  }
}

static void draw_arrival(GContext *ctx, GRect row, const Arrival *arrival) {
  const int badge_w = 46;
  const int badge_h = 24;
  const int minutes_w = 82;   // enough for the widest of them, "15 min"
  int pad = PBL_IF_ROUND_ELSE(26, 5);
  int x = row.origin.x + pad;
  int right = row.origin.x + row.size.w - pad;
  int mid = row.origin.y + row.size.h / 2;

  // One line per bus: the line it is, where it goes, and how long you wait,
  // read left to right.
  GRect badge = GRect(x, mid - badge_h / 2, badge_w, badge_h);
  graphics_context_set_fill_color(ctx, ui_line_color(arrival->line));
  graphics_fill_rect(ctx, badge, 4, GCornersAll);
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, arrival->line,
                     fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(badge.origin.x, badge.origin.y + 1, badge_w, badge_h),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  char minutes[16];
  const char *font;
  format_minutes(arrival, minutes, sizeof(minutes), &font);

  int minutes_x = right - minutes_w;
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, minutes, fonts_get_system_font(font),
                     GRect(minutes_x, mid - 16, minutes_w, 30),
                     GTextOverflowModeFill, GTextAlignmentRight, NULL);

  // Whatever room is left in between. On a narrow watch there is none, and
  // the destination simply gives way to the two things that matter more.
  int dest_x = x + badge_w + 6;
  int dest_w = minutes_x - dest_x - 4;
  if (dest_w >= 30 && arrival->dest[0] != '\0') {
    graphics_draw_text(ctx, arrival->dest,
                       fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(dest_x, mid - 10, dest_w, 20),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter,
                       NULL);
  }
}

static void layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int header_y = PBL_IF_ROUND_ELSE(26, 0);
  int body_y = header_y + HEADER_H;
  int body_h = bounds.size.h - body_y - PBL_IF_ROUND_ELSE(14, 0);

  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  draw_header(ctx, bounds, header_y);

  if (showing_status()) {
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, status_text(),
                       fonts_get_system_font(FONT_KEY_GOTHIC_18),
                       GRect(8, body_y + (body_h - 26) / 2, bounds.size.w - 16, 26),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter,
                       NULL);
    return;
  }

  int rows = shown_rows();
  int row_h = body_h / SHOWN_ROWS;

  for (int i = 0; i < rows; i++) {
    GRect row = GRect(0, body_y + i * row_h, bounds.size.w, row_h);
    if (i > 0) {
      graphics_context_set_stroke_color(ctx, GColorBlack);
      graphics_draw_line(ctx, GPoint(row.origin.x + 6, row.origin.y),
                         GPoint(row.origin.x + row.size.w - 6, row.origin.y));
    }
    draw_arrival(ctx, row, &g_arrivals[i]);
  }
}

// -------------------------------------------------------------- buttons

// Both the obvious button and the one you reach for when you want to see
// further down a list land on the stop screen, which lists every bus and
// lets you move through them.
static void open_full_list(ClickRecognizerRef ref, void *context) {
  win_stop_push(&s_stop);
}

static void select_long_click(ClickRecognizerRef ref, void *context) {
  if (favs_contains(s_stop.code)) {
    favs_remove(s_stop.code);
    toast(i18n(T_REMOVED));
  } else {
    toast(favs_add(&s_stop) ? i18n(T_ADDED) : i18n(T_FAV_FULL));
  }
  vibes_short_pulse();
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, open_full_list);
  window_single_click_subscribe(BUTTON_ID_DOWN, open_full_list);
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, select_long_click, NULL);
}

// --------------------------------------------------------------- window

static void on_message(int msg_type) {
  if (s_layer == NULL) return;

  switch (msg_type) {
    case MSG_TIMES:
      s_state = (g_arrival_count > 0) ? DS_OK : DS_EMPTY;
      // Adopt the name the API knows, but never clobber one the user gave
      // this stop in the settings page.
      if (g_title[0] != '\0' &&
          (s_stop.name[0] == '\0' || strcmp(s_stop.name, s_stop.code) == 0)) {
        str_copy(s_stop.name, g_title, NAME_LEN);
      }
      break;
    case MSG_ERROR:
      if (g_arrival_count == 0) s_state = DS_ERROR;
      break;
    default:
      return;
  }
  mark_dirty();
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer, layer_update);
  layer_add_child(root, s_layer);

  window_set_click_config_provider(window, click_config);

  // Taken here and put back in unload, the way every other window does it,
  // so the stop screen pushed on top of this one can take its own turn and
  // hand this one back. Doing it on appear and disappear instead would race
  // with that window's load, which may run either side of our disappear.
  s_prev_handler = comm_set_handler(on_message);
}

// Also entered coming back from the stop screen, which has been refreshing
// into the same globals: take the handler back and ask for a fresh set.
static void window_appear(Window *window) {
  comm_set_handler(on_message);
  s_state = (g_arrival_count > 0) ? DS_OK : DS_LOADING;
  request_times();
}

// Nothing to refresh while the stop screen is in front: it does its own.
static void window_disappear(Window *window) {
  if (s_refresh_timer != NULL) app_timer_cancel(s_refresh_timer);
  s_refresh_timer = NULL;
}

static void window_unload(Window *window) {
  if (s_refresh_timer != NULL) app_timer_cancel(s_refresh_timer);
  if (s_toast_timer != NULL) app_timer_cancel(s_toast_timer);
  s_refresh_timer = NULL;
  s_toast_timer = NULL;
  s_toast[0] = '\0';

  comm_set_handler(s_prev_handler);

  layer_destroy(s_layer);
  s_layer = NULL;
  window_destroy(window);
  s_window = NULL;
}

void win_next_push(const Stop *stop) {
  s_stop = *stop;
  if (s_stop.name[0] == '\0') str_copy(s_stop.name, s_stop.code, NAME_LEN);
  s_state = DS_LOADING;
  g_arrival_count = 0;

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .appear = window_appear,
    .disappear = window_disappear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
