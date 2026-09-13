#include "app.h"

GColor ui_arrival_color(const Arrival *arrival) {
#ifdef PBL_COLOR
  if (arrival->color != 0) return GColorFromHEX(arrival->color);
#endif
  return ui_line_color(arrival->line);
}

// A stopgap for the lines TMB has not given us a colour for, which in
// practice means the first seconds after an install, before the phone has
// the line list. It goes by family, and being a guess it is only ever
// roughly right: V lines are green and the AMB's are yellow because that is
// what they turned out to be, the rest is the Nova Xarxa read off a map.
GColor ui_line_color(const char *line) {
#ifdef PBL_COLOR
  uint32_t hex;
  switch (line[0]) {
    case 'H': hex = 0x008EC1; break;   // horizontal, light blue
    case 'V': hex = 0x00A94F; break;   // vertical, green
    case 'D': hex = 0x7C3F98; break;   // diagonal, purple
    case 'N': hex = 0x1B3D8F; break;   // night, dark blue
    case 'X': hex = 0xEF7C00; break;   // express, orange
    case 'B': hex = 0xFFD800; break;   // the AMB's, yellow
    default:  hex = 0xD6001C; break;   // the numbered lines, TMB red
  }
  return GColorFromHEX(hex);
#else
  (void)line;
  return GColorBlack;
#endif
}

GColor ui_accent(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0xD6001C);
#else
  return GColorBlack;
#endif
}

void ui_theme_menu(MenuLayer *menu) {
  menu_layer_set_normal_colors(menu, GColorWhite, GColorBlack);
  menu_layer_set_highlight_colors(menu, ui_accent(), GColorWhite);
}

// The time, on every screen. Pebble's own status bar draws it, so it is the
// watch's clock in the watch's format and nothing here has to keep it.
StatusBarLayer *ui_status_bar_add(Window *window) {
  StatusBarLayer *bar = status_bar_layer_create();
  status_bar_layer_set_colors(bar, GColorWhite, GColorBlack);
  status_bar_layer_set_separator_mode(bar, StatusBarLayerSeparatorModeNone);
  layer_add_child(window_get_root_layer(window), status_bar_layer_get_layer(bar));
  return bar;
}

// What is left of the window once the status bar has had its strip. Layers
// built from this keep drawing in their own coordinates, starting at zero.
GRect ui_content_bounds(Window *window) {
  GRect bounds = layer_get_bounds(window_get_root_layer(window));
  bounds.origin.y += STATUS_BAR_LAYER_HEIGHT;
  bounds.size.h -= STATUS_BAR_LAYER_HEIGHT;
  return bounds;
}
