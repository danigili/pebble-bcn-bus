#include "app.h"

// A bus driving past, in the chunky flat style the watch's own UI uses:
// thick strokes, flat fills, no fine detail that would disappear at this
// size. The shapes are GPath outlines scaled to the screen at load time,
// so the same drawing fills a 144px Basalt and a 200px Emery alike.

#define SPLASH_MS  1400

// The bus is designed in a 100 x 42 box and scaled from there. Wheels hang
// below it, so the whole vehicle is UNIT_TALL high.
#define UNIT_W      100
#define UNIT_H       42
#define WHEEL_R       9
#define UNIT_TALL   (UNIT_H + WHEEL_R)

static Window    *s_window;
static Layer     *s_layer;
static Animation *s_animation;
static AppTimer  *s_finish_timer;
static int        s_progress;   // 0..100
static bool       s_done;
static int        s_scale;      // target width in the same units as UNIT_W

static const GPoint BUS_BASE[] = {
  {4, 0}, {74, 0}, {90, 10}, {100, 22}, {100, 42}, {0, 42}, {0, 4}
};
static const GPoint SCREEN_BASE[] = {
  {76, 8}, {86, 8}, {96, 22}, {76, 22}
};

#define BUS_PTS    (sizeof(BUS_BASE) / sizeof(BUS_BASE[0]))
#define SCREEN_PTS (sizeof(SCREEN_BASE) / sizeof(SCREEN_BASE[0]))

static GPoint    s_bus_pts[BUS_PTS];
static GPoint    s_screen_pts[SCREEN_PTS];
static GPathInfo s_bus_info    = { BUS_PTS, s_bus_pts };
static GPathInfo s_screen_info = { SCREEN_PTS, s_screen_pts };
static GPath    *s_bus;
static GPath    *s_screen;

static int sc(int units) {
  return units * s_scale / UNIT_W;
}

// ------------------------------------------------------------ drawing

static void draw_bus(GContext *ctx, int bus_x, int body_y, int stroke) {
  GPoint at = GPoint(bus_x, body_y);

  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_context_set_stroke_width(ctx, stroke);

  graphics_context_set_fill_color(ctx, ui_accent());
  gpath_move_to(s_bus, at);
  gpath_draw_filled(ctx, s_bus);
  gpath_draw_outline(ctx, s_bus);

  graphics_context_set_fill_color(ctx, GColorWhite);
  for (int i = 0; i < 2; i++) {
    GRect window = GRect(bus_x + sc(10 + i * 32), body_y + sc(8),
                         sc(26), sc(16));
    graphics_fill_rect(ctx, window, sc(3), GCornersAll);
    graphics_draw_round_rect(ctx, window, sc(3));
  }

  gpath_move_to(s_screen, at);
  gpath_draw_filled(ctx, s_screen);
  gpath_draw_outline(ctx, s_screen);

  for (int i = 0; i < 2; i++) {
    GPoint hub = GPoint(bus_x + sc(i == 0 ? 24 : 72), body_y + sc(UNIT_H));
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_circle(ctx, hub, sc(WHEEL_R));
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_circle(ctx, hub, sc(4));
  }
}

static void draw_speed_lines(GContext *ctx, int bus_x, int body_y, int stroke) {
  static const int rows[] = { 12, 24, 36 };
  static const int lengths[] = { 34, 52, 34 };

  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_context_set_stroke_width(ctx, stroke);

  for (int i = 0; i < 3; i++) {
    int y = body_y + sc(rows[i]);
    int right = bus_x - sc(10);
    graphics_draw_line(ctx, GPoint(right - sc(lengths[i]), y), GPoint(right, y));
  }
}

static void layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int stroke = (bounds.size.w >= 180) ? 5 : 3;   // must be odd

  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  int road_y = bounds.size.h * 76 / 100;
  int body_y = road_y - sc(UNIT_TALL);

  graphics_context_set_fill_color(ctx, ui_road());
  graphics_fill_rect(ctx, GRect(0, road_y, bounds.size.w,
                                bounds.size.h - road_y), 0, GCornerNone);
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, GRect(0, road_y - stroke / 2, bounds.size.w, stroke),
                     0, GCornerNone);

  // Lane markings, so the asphalt reads as a road going somewhere.
  graphics_context_set_fill_color(ctx, GColorWhite);
  int dash_y = road_y + sc(14);
  if (dash_y < bounds.size.h - stroke) {
    for (int x = sc(6); x < bounds.size.w; x += sc(30)) {
      graphics_fill_rect(ctx, GRect(x, dash_y, sc(16), stroke), 0, GCornerNone);
    }
  }

  // Centre the title in whatever room is left above the bus. Measuring down
  // from the road instead ran it off the top of a short screen and let the
  // bezel eat it on a round one.
  int title_y = (body_y - 32) / 2;
  int title_min = PBL_IF_ROUND_ELSE(bounds.size.h * 13 / 100, 4);
  if (title_y < title_min) title_y = title_min;

  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, "BCN Bus",
                     fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(0, title_y, bounds.size.w, 34),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  // Straight through at a constant speed and out the far side.
  int start_x = -sc(UNIT_W) - sc(70);
  int end_x = bounds.size.w + sc(10);
  int bus_x = start_x + (end_x - start_x) * s_progress / 100;

  draw_speed_lines(ctx, bus_x, body_y, stroke);
  draw_bus(ctx, bus_x, body_y, stroke);
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

static void scale_paths(GRect bounds) {
  s_scale = bounds.size.w * PBL_IF_ROUND_ELSE(70, 78) / 100;

  for (unsigned i = 0; i < BUS_PTS; i++) {
    s_bus_pts[i] = GPoint(sc(BUS_BASE[i].x), sc(BUS_BASE[i].y));
  }
  for (unsigned i = 0; i < SCREEN_PTS; i++) {
    s_screen_pts[i] = GPoint(sc(SCREEN_BASE[i].x), sc(SCREEN_BASE[i].y));
  }
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  scale_paths(bounds);
  s_bus = gpath_create(&s_bus_info);
  s_screen = gpath_create(&s_screen_info);

  s_layer = layer_create(bounds);
  layer_set_update_proc(s_layer, layer_update);
  layer_add_child(root, s_layer);

  window_set_click_config_provider(window, click_config);
}

static void window_appear(Window *window) {
  s_animation = animation_create();
  animation_set_duration(s_animation, SPLASH_MS);
  animation_set_curve(s_animation, AnimationCurveLinear);
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

  gpath_destroy(s_bus);
  gpath_destroy(s_screen);
  s_bus = NULL;
  s_screen = NULL;

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
