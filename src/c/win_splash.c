#include "app.h"

// A bus pulling into a stop, drawn as vector paths rather than bitmaps so
// it stays crisp on every screen size. Short, and any button skips it.

#define SPLASH_MS   1500
#define BUS_W         80
#define BUS_H         28
#define WHEEL_R        5
#define DOORS_AT      82   // percent of the way in when the doors open

static Window    *s_window;
static Layer     *s_layer;
static Animation *s_animation;
static AppTimer  *s_finish_timer;
static int        s_progress;    // 0..100
static bool       s_done;

// Nose sloping down to the front, with the corners knocked off the roof.
static const GPathInfo BUS_BODY_PATH = {
  .num_points = 7,
  .points = (GPoint []) {
    {0, 4}, {4, 0}, {58, 0}, {74, 10}, {80, 16}, {80, 28}, {0, 28}
  }
};

static const GPathInfo WINDSCREEN_PATH = {
  .num_points = 4,
  .points = (GPoint []) { {57, 5}, {68, 5}, {76, 15}, {57, 15} }
};

static GPath *s_body;
static GPath *s_windscreen;

// ------------------------------------------------------------ drawing

static void draw_stop(GContext *ctx, GRect bounds, int stop_x, int road_y) {
  int sign_top = road_y - 62;

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, GRect(stop_x - 2, sign_top, 4, 62), 0, GCornerNone);
  graphics_fill_rect(ctx, GRect(stop_x - 13, sign_top, 26, 19), 3, GCornersAll);

  // A bus glyph on the sign would not survive at this size, so a pair of
  // bars reads better as a timetable.
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, GRect(stop_x - 9, sign_top + 5, 18, 3), 0, GCornerNone);
  graphics_fill_rect(ctx, GRect(stop_x - 9, sign_top + 11, 11, 3), 0, GCornerNone);
}

static void draw_bus(GContext *ctx, int bus_x, int body_y) {
  gpath_move_to(s_body, GPoint(bus_x, body_y));
  graphics_context_set_fill_color(ctx, ui_accent());
  gpath_draw_filled(ctx, s_body);
  graphics_context_set_stroke_color(ctx, GColorBlack);
  gpath_draw_outline(ctx, s_body);

  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_context_set_stroke_color(ctx, GColorBlack);
  for (int i = 0; i < 2; i++) {
    GRect window = GRect(bus_x + 8 + i * 24, body_y + 5, 20, 11);
    graphics_fill_rect(ctx, window, 1, GCornersAll);
    graphics_draw_rect(ctx, window);
  }

  gpath_move_to(s_windscreen, GPoint(bus_x, body_y));
  gpath_draw_filled(ctx, s_windscreen);
  gpath_draw_outline(ctx, s_windscreen);

  // The doors part once the bus has settled at the stop.
  if (s_progress >= DOORS_AT) {
    int gap = (s_progress - DOORS_AT) * 5 / (100 - DOORS_AT);
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, GRect(bus_x + 34 - gap, body_y + 17, 4 + gap * 2,
                                  BUS_H - 17), 0, GCornerNone);
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_draw_rect(ctx, GRect(bus_x + 34 - gap, body_y + 17,
                                  4 + gap * 2, BUS_H - 17));
  }

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_circle(ctx, GPoint(bus_x + 17, body_y + BUS_H + WHEEL_R - 1),
                       WHEEL_R);
  graphics_fill_circle(ctx, GPoint(bus_x + 62, body_y + BUS_H + WHEEL_R - 1),
                       WHEEL_R);
}

static void layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  int road_y = bounds.size.h * 70 / 100;
  int stop_x = bounds.size.w - 30;
  int body_y = road_y - BUS_H - (WHEEL_R * 2) + 2;

  // Asphalt, so a tall screen does not end in a band of nothing.
  graphics_context_set_fill_color(ctx, ui_road());
  graphics_fill_rect(ctx, GRect(0, road_y, bounds.size.w,
                                bounds.size.h - road_y), 0, GCornerNone);
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, GRect(0, road_y, bounds.size.w, 2), 0, GCornerNone);
  graphics_context_set_fill_color(ctx, GColorWhite);
  for (int x = 6; x < bounds.size.w - 6; x += 24) {
    graphics_fill_rect(ctx, GRect(x, road_y + 9, 12, 2), 0, GCornerNone);
  }

  // Centre the title in whatever room is left above the bus, rather than
  // measuring down from the road: on a short screen that ran off the top,
  // and on a round one the corners cut it away.
  int title_y = (body_y - 34) / 2;
  if (title_y < 4) title_y = 4;
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, "BCN Bus",
                     fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(0, title_y, bounds.size.w, 34),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  draw_stop(ctx, bounds, stop_x, road_y);

  // Comes in from off-screen and eases to a halt just short of the pole.
  int start_x = -BUS_W - 12;
  int end_x = stop_x - BUS_W - 8;
  int bus_x = start_x + (end_x - start_x) * s_progress / 100;
  draw_bus(ctx, bus_x, body_y);
}

// ---------------------------------------------------------- animation

static void finish_cb(void *data) {
  s_finish_timer = NULL;

  Window *splash = s_window;
  win_main_push();
  if (splash != NULL) window_stack_remove(splash, false);
}

// Deferred, so the window is never torn down from inside an animation
// callback or a click handler.
static void finish(void) {
  if (s_done) return;
  s_done = true;
  s_finish_timer = app_timer_register(10, finish_cb, NULL);
}

static void animation_update(Animation *animation, const AnimationProgress progress) {
  s_progress = ((int)progress * 100) / ANIMATION_NORMALIZED_MAX;
  if (s_progress < 0) s_progress = 0;
  if (s_progress > 100) s_progress = 100;
  if (s_layer != NULL) layer_mark_dirty(s_layer);
}

static const AnimationImplementation s_implementation = {
  .update = animation_update,
};

static void animation_stopped(Animation *animation, bool finished, void *context) {
  s_animation = NULL;   // the framework owns a scheduled animation
  finish();
}

static void skip_click(ClickRecognizerRef ref, void *context) {
  if (s_animation != NULL) {
    animation_unschedule(s_animation);   // this lands in animation_stopped
  } else {
    finish();
  }
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_BACK, skip_click);
  window_single_click_subscribe(BUTTON_ID_UP, skip_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, skip_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, skip_click);
}

// ------------------------------------------------------------- window

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer, layer_update);
  layer_add_child(root, s_layer);

  s_body = gpath_create(&BUS_BODY_PATH);
  s_windscreen = gpath_create(&WINDSCREEN_PATH);

  window_set_click_config_provider(window, click_config);
}

static void window_appear(Window *window) {
  s_animation = animation_create();
  animation_set_duration(s_animation, SPLASH_MS);
  animation_set_curve(s_animation, AnimationCurveEaseOut);
  animation_set_implementation(s_animation, &s_implementation);
  animation_set_handlers(s_animation, (AnimationHandlers) {
    .stopped = animation_stopped,
  }, NULL);
  animation_schedule(s_animation);
}

static void window_unload(Window *window) {
  s_done = true;   // nothing scheduled from here on

  if (s_finish_timer != NULL) app_timer_cancel(s_finish_timer);
  s_finish_timer = NULL;

  if (s_animation != NULL) {
    animation_unschedule(s_animation);
    s_animation = NULL;
  }

  gpath_destroy(s_body);
  gpath_destroy(s_windscreen);
  s_body = NULL;
  s_windscreen = NULL;

  layer_destroy(s_layer);
  s_layer = NULL;
  window_destroy(window);
  s_window = NULL;
}

void win_splash_push(void) {
  s_progress = 0;
  s_done = false;

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, false);
}
