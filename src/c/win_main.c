#include "app.h"

enum { ROW_FAVS = 0, ROW_NEARBY, ROW_BY_CODE, ROW_COUNT };

static Window    *s_window;
static MenuLayer *s_menu;

static uint16_t get_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  return ROW_COUNT;
}

static int16_t get_cell_height(MenuLayer *menu, MenuIndex *index, void *context) {
#ifdef PBL_ROUND
  return menu_layer_is_index_selected(menu, index) ? 60 : 40;
#else
  return 44;
#endif
}

static void draw_row(GContext *ctx, const Layer *cell, MenuIndex *index,
                     void *context) {
  StrId id = T_FAVOURITES;
  switch (index->row) {
    case ROW_NEARBY:  id = T_NEARBY;  break;
    case ROW_BY_CODE: id = T_BY_CODE; break;
    default:          id = T_FAVOURITES; break;
  }
  menu_cell_basic_draw(ctx, cell, i18n(id), NULL, NULL);
}

static void select_click(MenuLayer *menu, MenuIndex *index, void *context) {
  switch (index->row) {
    case ROW_FAVS:    win_favs_push();   break;
    case ROW_NEARBY:  win_nearby_push(); break;
    case ROW_BY_CODE: win_keypad_push(); break;
    default: break;
  }
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks) {
    .get_num_rows = get_num_rows,
    .get_cell_height = get_cell_height,
    .draw_row = draw_row,
    .select_click = select_click,
  });
  ui_theme_menu(s_menu);
  menu_layer_set_click_config_onto_window(s_menu, window);
#ifdef PBL_ROUND
  menu_layer_set_center_focused(s_menu, true);
#endif
  layer_add_child(root, menu_layer_get_layer(s_menu));
}

static void window_unload(Window *window) {
  menu_layer_destroy(s_menu);
  s_menu = NULL;
  window_destroy(window);
  s_window = NULL;
}

void win_main_push(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
