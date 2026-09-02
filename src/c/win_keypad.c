#include "app.h"

#define MAX_DIGITS   5
#define DISPLAY_H   48
#define KEY_COLS     3
#define KEY_ROWS     4
#define PRESS_MS   120

#define KEY_BACKSPACE  9
#define KEY_ZERO      10
#define KEY_CONFIRM   11

static Window   *s_window;
static Layer    *s_layer;
static char      s_code[MAX_DIGITS + 1];
static int       s_len;
static bool      s_touch_mode;
static AppTimer *s_submit_timer;

#if defined(PBL_TOUCH)
static int       s_pressed = -1;
static AppTimer *s_press_timer;

static const char *const s_labels[KEY_COLS * KEY_ROWS] = {
  "1", "2", "3",
  "4", "5", "6",
  "7", "8", "9",
  "<", "0", "OK",
};
#endif

// ------------------------------------------------------------- editing

static void submit_cb(void *data) {
  s_submit_timer = NULL;
  if (s_len == 0) return;

  Stop stop;
  memset(&stop, 0, sizeof(stop));
  str_copy(stop.code, s_code, CODE_LEN);

  // Push the stop first, then drop the keypad out of the stack, so Back
  // from the times screen goes straight home instead of back to the keypad.
  Window *keypad = s_window;
  win_stop_push(&stop);
  if (keypad != NULL) window_stack_remove(keypad, false);
}

// Deferred by a timer because this can run from inside a recognizer
// callback, and tearing down the window (and with it the recognizer) in
// place would pull the rug from under the caller.
static void submit(void) {
  if (s_len == 0 || s_submit_timer != NULL) return;
  s_submit_timer = app_timer_register(10, submit_cb, NULL);
}

static void append_digit(char digit) {
  if (s_len >= MAX_DIGITS) return;
  s_code[s_len++] = digit;
  s_code[s_len] = '\0';
}

static void backspace(void) {
  if (s_len > 0) s_code[--s_len] = '\0';
}

static void mark_dirty(void) {
  if (s_layer != NULL) layer_mark_dirty(s_layer);
}

// ------------------------------------------------------------- drawing

static void draw_button_hint(GContext *ctx, GRect bounds) {
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, i18n(T_USE_BUTTONS),
                     fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(6, DISPLAY_H + 8, bounds.size.w - 12, 24),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  graphics_draw_text(ctx, i18n(T_BTN_LEGEND),
                     fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(10, DISPLAY_H + 34, bounds.size.w - 20,
                           bounds.size.h - DISPLAY_H - 38),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

#if defined(PBL_TOUCH)
static GRect key_rect(GRect bounds, int row, int col) {
  int grid_h = bounds.size.h - DISPLAY_H;
  int x0 = col * bounds.size.w / KEY_COLS;
  int x1 = (col + 1) * bounds.size.w / KEY_COLS;
  int y0 = DISPLAY_H + row * grid_h / KEY_ROWS;
  int y1 = DISPLAY_H + (row + 1) * grid_h / KEY_ROWS;
  return GRect(x0, y0, x1 - x0, y1 - y0);
}

static void draw_keypad(GContext *ctx, GRect bounds) {
  for (int row = 0; row < KEY_ROWS; row++) {
    for (int col = 0; col < KEY_COLS; col++) {
      int key = row * KEY_COLS + col;
      GRect cell = key_rect(bounds, row, col);
      bool down = (key == s_pressed);

      graphics_context_set_fill_color(ctx, down ? ui_accent() : GColorWhite);
      graphics_fill_rect(ctx, cell, 0, GCornerNone);
      graphics_context_set_stroke_color(ctx, GColorBlack);
      graphics_draw_rect(ctx, cell);

      graphics_context_set_text_color(ctx, down ? GColorWhite : GColorBlack);
      graphics_draw_text(ctx, s_labels[key],
                         fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                         GRect(cell.origin.x,
                               cell.origin.y + (cell.size.h - 26) / 2,
                               cell.size.w, 28),
                         GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    }
  }
}

static void press_expired(void *data) {
  s_press_timer = NULL;
  s_pressed = -1;
  mark_dirty();
}

static void key_press(int key) {
  s_pressed = key;
  if (s_press_timer != NULL) app_timer_cancel(s_press_timer);
  s_press_timer = app_timer_register(PRESS_MS, press_expired, NULL);

  if (key >= 0 && key <= 8) {
    append_digit('1' + key);
  } else if (key == KEY_ZERO) {
    append_digit('0');
  } else if (key == KEY_BACKSPACE) {
    backspace();
  } else if (key == KEY_CONFIRM) {
    submit();
  }
  mark_dirty();
}

static int key_at(GPoint point, GRect bounds) {
  if (point.y < DISPLAY_H || point.y >= bounds.size.h) return -1;

  int grid_h = bounds.size.h - DISPLAY_H;
  int col = point.x * KEY_COLS / bounds.size.w;
  int row = (point.y - DISPLAY_H) * KEY_ROWS / grid_h;
  if (col < 0 || col >= KEY_COLS || row < 0 || row >= KEY_ROWS) return -1;
  return row * KEY_COLS + col;
}

static void tap_handler(const Recognizer *recognizer, RecognizerEvent event) {
  if (event != RecognizerEvent_Completed || s_layer == NULL) return;

  GPoint point = tap_recognizer_get_tap_point(recognizer);
  int key = key_at(point, layer_get_bounds(s_layer));
  if (key >= 0) key_press(key);
}
#endif  // PBL_TOUCH

static void layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  graphics_context_set_fill_color(ctx, ui_accent());
  graphics_fill_rect(ctx, GRect(0, 0, bounds.size.w, DISPLAY_H), 0, GCornerNone);

  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, i18n(T_STOP_CODE),
                     fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(4, -1, bounds.size.w - 8, 16),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  // In button mode the digit being edited sits at the end, so mark it with
  // a caret; on the keypad the code speaks for itself.
  char shown[MAX_DIGITS + 2];
  snprintf(shown, sizeof(shown), "%s%s", s_code,
           (!s_touch_mode && s_len > 0) ? "_" : "");
  graphics_draw_text(ctx, shown[0] != '\0' ? shown : " ",
                     fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(4, 13, bounds.size.w - 8, 34),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

#if defined(PBL_TOUCH)
  if (s_touch_mode) {
    draw_keypad(ctx, bounds);
    return;
  }
#endif
  draw_button_hint(ctx, bounds);
}

// -------------------------------------------------------------- buttons

static void bump_digit(int delta) {
  if (s_len == 0) {
    append_digit('0');
  } else {
    int value = (s_code[s_len - 1] - '0' + delta + 10) % 10;
    s_code[s_len - 1] = '0' + value;
  }
  mark_dirty();
}

static void up_click(ClickRecognizerRef ref, void *context) {
  bump_digit(1);
}

static void down_click(ClickRecognizerRef ref, void *context) {
  bump_digit(-1);
}

static void next_digit_click(ClickRecognizerRef ref, void *context) {
  append_digit('0');
  mark_dirty();
}

static void search_click(ClickRecognizerRef ref, void *context) {
  submit();
}

static void back_click(ClickRecognizerRef ref, void *context) {
  if (s_len > 1) {
    backspace();
    mark_dirty();
  } else {
    window_stack_pop(true);
  }
}

static void click_config(void *context) {
  // Repeating, so holding Up spins the digit instead of asking for nine
  // separate presses to get from 0 to 9.
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 120, up_click);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 120, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, next_digit_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, search_click, NULL);
  window_single_click_subscribe(BUTTON_ID_BACK, back_click);
}

// -------------------------------------------------------------- window

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer, layer_update);
  layer_add_child(root, s_layer);
}

static void window_appear(Window *window) {
  s_touch_mode = false;

#if defined(PBL_TOUCH)
  // One call covers both "this watch has no touchscreen" and "the user
  // turned touch off in Settings".
  if (touch_service_is_enabled()) {
    s_touch_mode = true;
    window_set_touch_bridge_disabled(window, true);
    window_attach_recognizer(window, tap_recognizer_create(tap_handler, NULL));
  }
#endif

  if (!s_touch_mode) {
    // Start on a digit so Up and Down have something to turn right away.
    if (s_len == 0) append_digit('0');
    window_set_click_config_provider(window, click_config);
  }
  mark_dirty();
}

static void window_unload(Window *window) {
  if (s_submit_timer != NULL) app_timer_cancel(s_submit_timer);
  s_submit_timer = NULL;

#if defined(PBL_TOUCH)
  if (s_press_timer != NULL) app_timer_cancel(s_press_timer);
  s_press_timer = NULL;
  s_pressed = -1;
#endif

  layer_destroy(s_layer);
  s_layer = NULL;
  window_destroy(window);
  s_window = NULL;
}

void win_keypad_push(void) {
  s_code[0] = '\0';
  s_len = 0;

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
