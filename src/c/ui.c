#include "app.h"

GColor ui_arrival_color(const Arrival *arrival) {
#ifdef PBL_COLOR
  if (arrival->color != 0) return GColorFromHEX(arrival->color);
#endif
  return ui_line_color(arrival->line);
}

// For lines the phone has sent no colour for.
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

// Ten points around a hundred-unit circle: an outer tip and an inner corner
// in turn, scaled to the radius asked for.
static const GPoint STAR[] = {
  {    0, -100 },
  {   22,  -31 },
  {   95,  -31 },
  {   36,   12 },
  {   59,   81 },
  {    0,   38 },
  {  -59,   81 },
  {  -36,   12 },
  {  -95,  -31 },
  {  -22,  -31 }
};

#define STAR_POINTS (sizeof(STAR) / sizeof(STAR[0]))

// The points sit around the origin; gpath_move_to places them.
void ui_draw_star(GContext *ctx, GPoint centre, int radius, GColor colour) {
  static GPoint    s_points[STAR_POINTS];
  static GPathInfo s_info = { STAR_POINTS, s_points };
  static GPath    *s_star;
  static int       s_radius;

  if (s_star == NULL) {
    s_star = gpath_create(&s_info);
    if (s_star == NULL) return;
  }

  if (radius != s_radius) {
    for (unsigned i = 0; i < STAR_POINTS; i++) {
      s_points[i] = GPoint(STAR[i].x * radius / 100, STAR[i].y * radius / 100);
    }
    s_radius = radius;
  }

  gpath_move_to(s_star, centre);

  // Filled and then outlined in the same colour: a five-pointed star ends in
  // a tip one pixel wide, and filling alone leaves it off.
  graphics_context_set_fill_color(ctx, colour);
  graphics_context_set_stroke_color(ctx, colour);
  graphics_context_set_stroke_width(ctx, 1);
  gpath_draw_filled(ctx, s_star);
  gpath_draw_outline(ctx, s_star);
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

// The system status bar, which draws the time in the watch's own format.
StatusBarLayer *ui_status_bar_add(Window *window) {
  StatusBarLayer *bar = status_bar_layer_create();
  status_bar_layer_set_colors(bar, GColorWhite, GColorBlack);
  status_bar_layer_set_separator_mode(bar, StatusBarLayerSeparatorModeNone);
  layer_add_child(window_get_root_layer(window), status_bar_layer_get_layer(bar));
  return bar;
}

// The window below the status bar. A layer built from this draws in its own
// coordinates, starting at zero.
GRect ui_content_bounds(Window *window) {
  GRect bounds = layer_get_bounds(window_get_root_layer(window));
  bounds.origin.y += STATUS_BAR_LAYER_HEIGHT;
  bounds.size.h -= STATUS_BAR_LAYER_HEIGHT;
  return bounds;
}
