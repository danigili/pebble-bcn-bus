#include "app.h"

#define REFRESH_MS 30000
#define TOAST_MS    1500
#define HEADER_H      24

// Every way of finding a stop lands here, so this is the one place that
// knows how to add or drop a favourite: short press refreshes, long press
// toggles.

static Window     *s_window;
static StatusBarLayer *s_status;
static MenuLayer  *s_menu;
static CommHandler s_prev_handler;
static Stop        s_stop;
static DataState   s_state;
static AppTimer   *s_refresh_timer;
static AppTimer   *s_toast_timer;
static char        s_toast[24];

static void request_times(void);

static void mark_dirty(void) {
  if (s_menu != NULL) layer_mark_dirty(menu_layer_get_layer(s_menu));
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
  // Keep showing the previous times while refreshing, so the list does not
  // blink back to "loading" every half minute.
  if (g_arrival_count == 0) s_state = DS_LOADING;

  comm_req_times(s_stop.code);

  if (s_refresh_timer != NULL) app_timer_cancel(s_refresh_timer);
  s_refresh_timer = app_timer_register(REFRESH_MS, refresh_timer_cb, NULL);

  if (s_menu != NULL) menu_layer_reload_data(s_menu);
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

static uint16_t get_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  return showing_status() ? 1 : g_arrival_count;
}

static int16_t get_cell_height(MenuLayer *menu, MenuIndex *index, void *context) {
#ifdef PBL_ROUND
  return menu_layer_is_index_selected(menu, index) ? 60 : 42;
#else
  return 44;
#endif
}

static int16_t get_header_height(MenuLayer *menu, uint16_t section, void *context) {
  return HEADER_H;
}

static void draw_header(GContext *ctx, const Layer *cell, uint16_t section,
                        void *context) {
  GRect bounds = layer_get_bounds(cell);
  bool is_fav = favs_contains(s_stop.code);

  graphics_context_set_fill_color(ctx, ui_accent());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, s_toast[0] ? s_toast : s_stop.name,
                     fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(4, -2, bounds.size.w - 22, bounds.size.h),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  // A filled dot marks a saved stop: no font is guaranteed to carry a star.
  if (is_fav) {
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_circle(ctx, GPoint(bounds.size.w - 11, bounds.size.h / 2), 4);
  }
}

static void draw_row(GContext *ctx, const Layer *cell, MenuIndex *index,
                     void *context) {
  GRect bounds = layer_get_bounds(cell);
  bool selected = menu_layer_is_index_selected(s_menu, index);
  GColor text_color = selected ? GColorWhite : GColorBlack;

  if (showing_status()) {
    graphics_context_set_text_color(ctx, text_color);
    graphics_draw_text(ctx, status_text(),
                       fonts_get_system_font(FONT_KEY_GOTHIC_18),
                       GRect(6, (bounds.size.h - 24) / 2, bounds.size.w - 12, 24),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    return;
  }

  const Arrival *arrival = &g_arrivals[index->row];

  const int badge_w = 46;
  const int badge_h = 24;
  GRect badge = GRect(4, (bounds.size.h - badge_h) / 2, badge_w, badge_h);
  graphics_context_set_fill_color(ctx, ui_line_color(arrival->line));
  graphics_fill_rect(ctx, badge, 4, GCornersAll);
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, arrival->line,
                     fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(badge.origin.x, badge.origin.y + 1, badge_w, badge_h),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  char minutes[16];
  const char *minutes_font = FONT_KEY_GOTHIC_24_BOLD;
  if (arrival->mins < 0) {
    str_copy(minutes, "--", sizeof(minutes));
  } else if (arrival->mins == 0) {
    str_copy(minutes, i18n(T_ARRIVING), sizeof(minutes));
    minutes_font = FONT_KEY_GOTHIC_14_BOLD;
  } else {
    snprintf(minutes, sizeof(minutes), "%d'", arrival->mins);
  }

  const int right_w = 58;
  graphics_context_set_text_color(ctx, text_color);
  graphics_draw_text(ctx, minutes, fonts_get_system_font(minutes_font),
                     GRect(bounds.size.w - right_w - 4,
                           (bounds.size.h - 26) / 2, right_w, 26),
                     GTextOverflowModeFill, GTextAlignmentRight, NULL);

  int dest_x = badge_w + 10;
  int dest_w = bounds.size.w - dest_x - right_w - 6;
  if (dest_w > 10 && arrival->dest[0] != '\0') {
    graphics_draw_text(ctx, arrival->dest,
                       fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(dest_x, (bounds.size.h - 20) / 2, dest_w, 20),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
}

// Picking a bus opens that line's detail. With nothing to pick — loading,
// an error, no buses — the press means what it always did: try again.
static void select_click(MenuLayer *menu, MenuIndex *index, void *context) {
  if (showing_status() || index->row >= g_arrival_count) {
    request_times();
    return;
  }
  win_line_push(&s_stop, g_arrivals[index->row].line);
}

static void select_long_click(MenuLayer *menu, MenuIndex *index, void *context) {
  if (favs_contains(s_stop.code)) {
    favs_remove(s_stop.code);
    toast(i18n(T_REMOVED));
  } else {
    toast(favs_add(&s_stop) ? i18n(T_ADDED) : i18n(T_FAV_FULL));
  }
  vibes_short_pulse();
}

static void on_message(int msg_type) {
  if (s_menu == NULL) return;

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
  menu_layer_reload_data(s_menu);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_menu = menu_layer_create(ui_content_bounds(window));
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks) {
    .get_num_rows = get_num_rows,
    .get_cell_height = get_cell_height,
    .get_header_height = get_header_height,
    .draw_header = draw_header,
    .draw_row = draw_row,
    .select_click = select_click,
    .select_long_click = select_long_click,
  });
  ui_theme_menu(s_menu);
  menu_layer_set_click_config_onto_window(s_menu, window);
#ifdef PBL_ROUND
  menu_layer_set_center_focused(s_menu, true);
#endif
  layer_add_child(root, menu_layer_get_layer(s_menu));

  // Added last, so it stays over whatever the window draws.
  s_status = ui_status_bar_add(window);

  s_prev_handler = comm_set_handler(on_message);
  request_times();
}

static void window_unload(Window *window) {
  if (s_refresh_timer != NULL) app_timer_cancel(s_refresh_timer);
  if (s_toast_timer != NULL) app_timer_cancel(s_toast_timer);
  s_refresh_timer = NULL;
  s_toast_timer = NULL;
  s_toast[0] = '\0';

  comm_set_handler(s_prev_handler);
  status_bar_layer_destroy(s_status);
  s_status = NULL;
  menu_layer_destroy(s_menu);
  s_menu = NULL;
  window_destroy(window);
  s_window = NULL;
}

void win_stop_push(const Stop *stop) {
  s_stop = *stop;
  if (s_stop.name[0] == '\0') str_copy(s_stop.name, s_stop.code, NAME_LEN);
  s_state = DS_LOADING;
  g_arrival_count = 0;

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
