#include "app.h"

// Both the kept stops and the nearby ones: they differ only in where the
// stops come from and whether they have to be fetched.

#define ANSWER_MS 70000   // past the worst the phone side can take

static Window     *s_window;
static StatusBarLayer *s_status;
static MenuLayer  *s_menu;
static CommHandler s_prev_handler;
static bool        s_nearby_mode;
static DataState   s_state;
static AppTimer   *s_answer_timer;

static int item_count(void) {
  return s_nearby_mode ? g_nearby_count : favs_count();
}

static const Stop *item_at(int index) {
  return s_nearby_mode
      ? ((index >= 0 && index < g_nearby_count) ? &g_nearby[index] : NULL)
      : favs_get(index);
}

// When there is nothing to list we still draw a single row explaining why.
static bool showing_status(void) {
  return item_count() == 0 || (s_nearby_mode && s_state != DS_OK);
}

static const char *status_text(void) {
  if (s_nearby_mode) {
    switch (s_state) {
      case DS_LOADING: return i18n(T_LOADING);
      case DS_ERROR:   return g_error[0] ? g_error : i18n(T_ERROR);
      default:         return i18n(T_NO_NEARBY);
    }
  }
  return i18n(T_NO_FAVS);
}

static uint16_t get_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  return showing_status() ? 1 : item_count();
}

static int16_t get_cell_height(MenuLayer *menu, MenuIndex *index, void *context) {
#ifdef PBL_ROUND
  return menu_layer_is_index_selected(menu, index) ? 60 : 40;
#else
  return 44;
#endif
}

static int16_t get_header_height(MenuLayer *menu, uint16_t section, void *context) {
  return MENU_CELL_BASIC_HEADER_HEIGHT;
}

static void draw_header(GContext *ctx, const Layer *cell, uint16_t section,
                        void *context) {
  menu_cell_basic_header_draw(ctx, cell,
                              i18n(s_nearby_mode ? T_NEARBY : T_FAVOURITES));
}

// Bottom right, the corner the standard cell leaves free.
static void draw_distance(GContext *ctx, const Layer *cell, MenuIndex *index) {
  if (index->row >= MAX_NEARBY) return;

  int metres = g_nearby_dist[index->row];
  if (metres < 0) return;

  GRect bounds = layer_get_bounds(cell);
  char label[12];
  snprintf(label, sizeof(label), "%d m", metres);

  graphics_context_set_text_color(ctx,
      menu_layer_is_index_selected(s_menu, index) ? GColorWhite : GColorBlack);
  graphics_draw_text(ctx, label, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(bounds.size.w - 70 - PBL_IF_ROUND_ELSE(16, 4),
                           bounds.size.h - 21, 70, 18),
                     GTextOverflowModeFill, GTextAlignmentRight, NULL);
}

static void draw_row(GContext *ctx, const Layer *cell, MenuIndex *index,
                     void *context) {
  if (showing_status()) {
    menu_cell_basic_draw(ctx, cell, status_text(), NULL, NULL);
    return;
  }

  const Stop *stop = item_at(index->row);
  if (stop == NULL) return;
  menu_cell_basic_draw(ctx, cell, stop->name, stop->code, NULL);

  if (s_nearby_mode) draw_distance(ctx, cell, index);
}

static void select_click(MenuLayer *menu, MenuIndex *index, void *context) {
  if (showing_status()) return;

  const Stop *stop = item_at(index->row);
  if (stop != NULL) win_stop_push(stop);
}

// Nothing came back: no phone in range, or its side never answered.
static void answer_timed_out(void *data) {
  s_answer_timer = NULL;
  if (!s_nearby_mode || s_state != DS_LOADING) return;

  str_copy(g_error, i18n(T_NO_PHONE), ERR_LEN);
  s_state = DS_ERROR;
  if (s_menu != NULL) menu_layer_reload_data(s_menu);
}

static void on_message(int msg_type) {
  if (s_menu == NULL) return;

  if (s_answer_timer != NULL) {
    app_timer_cancel(s_answer_timer);
    s_answer_timer = NULL;
  }

  if (s_nearby_mode && msg_type == MSG_NEARBY) {
    s_state = (g_nearby_count > 0) ? DS_OK : DS_EMPTY;
  } else if (s_nearby_mode && msg_type == MSG_ERROR) {
    s_state = DS_ERROR;
  } else if (msg_type != MSG_FAVS) {
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
  });
  ui_theme_menu(s_menu);
  menu_layer_set_click_config_onto_window(s_menu, window);
#ifdef PBL_ROUND
  menu_layer_set_center_focused(s_menu, true);
#endif
  layer_add_child(root, menu_layer_get_layer(s_menu));
  s_status = ui_status_bar_add(window);

  s_prev_handler = comm_set_handler(on_message);
}

// The stop window above can have kept or dropped one.
static void window_appear(Window *window) {
  if (!s_nearby_mode && s_menu != NULL) menu_layer_reload_data(s_menu);
}

static void window_unload(Window *window) {
  if (s_answer_timer != NULL) app_timer_cancel(s_answer_timer);
  s_answer_timer = NULL;

  comm_set_handler(s_prev_handler);
  status_bar_layer_destroy(s_status);
  s_status = NULL;
  menu_layer_destroy(s_menu);
  s_menu = NULL;
  window_destroy(window);
  s_window = NULL;
}

static void push(bool nearby_mode) {
  s_nearby_mode = nearby_mode;
  s_state = nearby_mode ? DS_LOADING : DS_OK;

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);

  if (nearby_mode) {
    g_nearby_count = 0;
    g_error[0] = '\0';
    comm_req_nearby();
    s_answer_timer = app_timer_register(ANSWER_MS, answer_timed_out, NULL);
  }
}

void win_favs_push(void) {
  push(false);
}

void win_nearby_push(void) {
  push(true);
}
