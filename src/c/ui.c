#include "app.h"

// TMB paints its network by line family: the H (horizontal), V (vertical)
// and D (diagonal) lines of the Nova Xarxa each have their own colour, night
// buses are dark blue and the conventional numbered lines are the classic
// TMB red. Close enough that a glance at the badge tells you the family.
GColor ui_line_color(const char *line) {
#ifdef PBL_COLOR
  uint32_t hex;
  switch (line[0]) {
    case 'H': hex = 0x008EC1; break;
    case 'V': hex = 0x7C3F98; break;
    case 'D': hex = 0x00A94F; break;
    case 'N': hex = 0x1B3D8F; break;
    case 'X': hex = 0xEF7C00; break;
    default:  hex = 0xD6001C; break;
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

GColor ui_road(void) {
#ifdef PBL_COLOR
  return GColorFromHEX(0xAAAAAA);
#else
  return GColorWhite;
#endif
}

void ui_theme_menu(MenuLayer *menu) {
  menu_layer_set_normal_colors(menu, GColorWhite, GColorBlack);
  menu_layer_set_highlight_colors(menu, ui_accent(), GColorWhite);
}
