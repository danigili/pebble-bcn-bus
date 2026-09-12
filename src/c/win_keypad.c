#include "app.h"

#define MAX_DIGITS   5
#define DISPLAY_H   48

static Window   *s_window;
static StatusBarLayer *s_status;
static Layer    *s_layer;
static char      s_code[MAX_DIGITS + 1];
static int       s_len;
static AppTimer *s_submit_timer;

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

// Deferred by a timer because this can run from inside a click handler, and
// tearing down the window in place would pull the rug from under the caller.
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

// Typing a code is obvious; accepting it is not, since there is no OK key to
// press. So the hold comes first, big and in the accent colour, and the two
// everyday keys sit under it in small type. Both boxes have room for a
// second line, because the same sentence is longer in Spanish than English.
static void draw_button_hint(GContext *ctx, GRect bounds) {
  int inset = PBL_IF_ROUND_ELSE(22, 6);
  int y = DISPLAY_H + 8;

  graphics_context_set_text_color(ctx, ui_accent());
  graphics_draw_text(ctx, i18n(T_HOLD_SEARCH),
                     fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(inset, y, bounds.size.w - inset * 2, 46),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  y += 48;
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, i18n(T_BTN_LEGEND),
                     fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(inset + 4, y, bounds.size.w - (inset + 4) * 2,
                           bounds.size.h - y - 4),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

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

  // The digit being edited sits at the end, so mark it with a caret.
  char shown[MAX_DIGITS + 2];
  snprintf(shown, sizeof(shown), "%s%s", s_code, (s_len > 0) ? "_" : "");
  graphics_draw_text(ctx, shown[0] != '\0' ? shown : " ",
                     fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(4, 13, bounds.size.w - 8, 34),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

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
  s_layer = layer_create(ui_content_bounds(window));
  layer_set_update_proc(s_layer, layer_update);
  layer_add_child(root, s_layer);

  // Added last, so it stays over whatever the window draws.
  s_status = ui_status_bar_add(window);

  // Start on a digit so Up and Down have something to turn right away.
  if (s_len == 0) append_digit('0');
  window_set_click_config_provider(window, click_config);
}

static void window_unload(Window *window) {
  if (s_submit_timer != NULL) app_timer_cancel(s_submit_timer);
  s_submit_timer = NULL;

  status_bar_layer_destroy(s_status);
  s_status = NULL;
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
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
