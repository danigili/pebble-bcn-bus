/*
 * Host-side stand-ins that rasterise instead of drawing on a watch, so the
 * splash animation can be rendered to an image and actually looked at.
 * The drawing code under test is the real src/c/win_splash.c.
 */

#include "app.h"
#include "preview.h"

GColor GColorWhite = { 0xffffff };
GColor GColorBlack = { 0x000000 };

GColor GColorFromHEX(uint32_t hex) {
  GColor colour = { hex };
  return colour;
}

static int      s_w, s_h;
static uint8_t *s_px;
static uint32_t s_fill = 0x000000;
static uint32_t s_stroke = 0x000000;
static uint32_t s_text = 0x000000;

struct Layer { GRect bounds; void (*update)(Layer *, GContext *); };
struct Window { WindowHandlers handlers; };
struct GPath { const GPathInfo *info; GPoint offset; };

static Layer *s_layer;
static const AnimationImplementation *s_impl;

// ------------------------------------------------------------ raster

static void put(int x, int y, uint32_t colour) {
  if (x < 0 || y < 0 || x >= s_w || y >= s_h) return;
  uint8_t *p = s_px + (y * s_w + x) * 3;
  p[0] = (colour >> 16) & 0xff;
  p[1] = (colour >> 8) & 0xff;
  p[2] = colour & 0xff;
}

static void fill_box(int x0, int y0, int w, int h, uint32_t colour) {
  for (int y = y0; y < y0 + h; y++)
    for (int x = x0; x < x0 + w; x++) put(x, y, colour);
}

static void line(int x0, int y0, int x1, int y1, uint32_t colour) {
  int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  int dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;
  for (;;) {
    put(x0, y0, colour);
    if (x0 == x1 && y0 == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

void preview_begin(int width, int height) {
  s_w = width;
  s_h = height;
  free(s_px);
  s_px = malloc((size_t)width * height * 3);
  memset(s_px, 0xd0, (size_t)width * height * 3);   // grey surround
}

void preview_clear(void) {
  memset(s_px, 0xd0, (size_t)s_w * s_h * 3);
}

// Chalk is circular: blank whatever the bezel would cut away, so clipping
// is visible in the preview instead of being guessed at.
void preview_round_mask(void) {
  int cx = s_w / 2, cy = s_h / 2, r = (s_w < s_h ? s_w : s_h) / 2;
  for (int y = 0; y < s_h; y++)
    for (int x = 0; x < s_w; x++) {
      int dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r) put(x, y, 0x303030);
    }
}

int preview_write_ppm(const char *path) {
  FILE *f = fopen(path, "wb");
  if (!f) return -1;
  fprintf(f, "P6\n%d %d\n255\n", s_w, s_h);
  fwrite(s_px, 1, (size_t)s_w * s_h * 3, f);
  fclose(f);
  return 0;
}

const AnimationImplementation *preview_impl(void) { return s_impl; }

void preview_draw_frame(void) {
  if (s_layer && s_layer->update) s_layer->update(s_layer, NULL);
}

// ---------------------------------------------------------- graphics

void graphics_context_set_fill_color(GContext *ctx, GColor c) { s_fill = c.rgb; }
void graphics_context_set_stroke_color(GContext *ctx, GColor c) { s_stroke = c.rgb; }
void graphics_context_set_text_color(GContext *ctx, GColor c) { s_text = c.rgb; }

void graphics_fill_rect(GContext *ctx, GRect r, uint16_t radius, GCornerMask m) {
  fill_box(r.origin.x, r.origin.y, r.size.w, r.size.h, s_fill);
}

void graphics_draw_rect(GContext *ctx, GRect r) {
  line(r.origin.x, r.origin.y, r.origin.x + r.size.w - 1, r.origin.y, s_stroke);
  line(r.origin.x, r.origin.y + r.size.h - 1,
       r.origin.x + r.size.w - 1, r.origin.y + r.size.h - 1, s_stroke);
  line(r.origin.x, r.origin.y, r.origin.x, r.origin.y + r.size.h - 1, s_stroke);
  line(r.origin.x + r.size.w - 1, r.origin.y,
       r.origin.x + r.size.w - 1, r.origin.y + r.size.h - 1, s_stroke);
}

void graphics_fill_circle(GContext *ctx, GPoint c, uint16_t radius) {
  for (int y = -radius; y <= radius; y++)
    for (int x = -radius; x <= radius; x++)
      if (x * x + y * y <= radius * radius) put(c.x + x, c.y + y, s_fill);
}

// Glyphs are not the point here; a bar of the right size in the right place
// is enough to check the text is where it should be and fits.
void graphics_draw_text(GContext *ctx, const char *t, GFont font, GRect box,
                        GTextOverflowMode o, GTextAlignment align, void *attrs) {
  int size = atoi(font + 1);
  if (size <= 0) size = 14;

  int w = (int)(strlen(t) * size * 52 / 100);
  if (w > box.size.w) w = box.size.w;
  int h = size * 72 / 100;

  int x = box.origin.x;
  if (align == GTextAlignmentCenter) x += (box.size.w - w) / 2;
  else if (align == GTextAlignmentRight) x += box.size.w - w;

  fill_box(x, box.origin.y + size * 18 / 100, w, h, s_text);
}

// ------------------------------------------------------------- gpath

GPath *gpath_create(const GPathInfo *info) {
  GPath *path = calloc(1, sizeof(GPath));
  path->info = info;
  return path;
}

void gpath_destroy(GPath *path) { free(path); }
void gpath_move_to(GPath *path, GPoint offset) { path->offset = offset; }

void gpath_draw_filled(GContext *ctx, GPath *path) {
  int n = (int)path->info->num_points;
  int miny = 1 << 20, maxy = -(1 << 20);
  for (int i = 0; i < n; i++) {
    int y = path->info->points[i].y + path->offset.y;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  for (int y = miny; y <= maxy; y++) {
    double xs[32];
    int count = 0;
    for (int i = 0; i < n && count < 32; i++) {
      int j = (i + 1) % n;
      double x1 = path->info->points[i].x + path->offset.x;
      double y1 = path->info->points[i].y + path->offset.y;
      double x2 = path->info->points[j].x + path->offset.x;
      double y2 = path->info->points[j].y + path->offset.y;
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs[count++] = x1 + (y - y1) / (y2 - y1) * (x2 - x1);
      }
    }
    for (int a = 0; a < count; a++)
      for (int b = a + 1; b < count; b++)
        if (xs[b] < xs[a]) { double t = xs[a]; xs[a] = xs[b]; xs[b] = t; }
    for (int a = 0; a + 1 < count; a += 2)
      for (int x = (int)xs[a]; x <= (int)xs[a + 1]; x++) put(x, y, s_fill);
  }
}

void gpath_draw_outline(GContext *ctx, GPath *path) {
  int n = (int)path->info->num_points;
  for (int i = 0; i < n; i++) {
    int j = (i + 1) % n;
    line(path->info->points[i].x + path->offset.x,
         path->info->points[i].y + path->offset.y,
         path->info->points[j].x + path->offset.x,
         path->info->points[j].y + path->offset.y, s_stroke);
  }
}

// -------------------------------------------------------- ui plumbing

GFont fonts_get_system_font(const char *key) { return key; }

Layer *layer_create(GRect frame) {
  Layer *layer = calloc(1, sizeof(Layer));
  layer->bounds = frame;
  s_layer = layer;
  return layer;
}
void layer_destroy(Layer *layer) { if (layer == s_layer) s_layer = NULL; free(layer); }
void layer_add_child(Layer *parent, Layer *child) {}
GRect layer_get_bounds(const Layer *layer) { return layer->bounds; }
void layer_set_update_proc(Layer *layer, void (*proc)(Layer *, GContext *)) {
  layer->update = proc;
}
void layer_mark_dirty(Layer *layer) {}

Window *window_create(void) { return calloc(1, sizeof(Window)); }
void window_destroy(Window *window) { free(window); }
void window_set_window_handlers(Window *window, WindowHandlers handlers) {
  window->handlers = handlers;
}
Layer *window_get_root_layer(const Window *window) {
  static Layer root;
  root.bounds = GRect(0, 0, s_w, s_h);
  return &root;
}
void window_stack_push(Window *window, bool animated) {
  if (window->handlers.load) window->handlers.load(window);
  if (window->handlers.appear) window->handlers.appear(window);
}
void window_stack_pop(bool animated) {}
bool window_stack_remove(Window *window, bool animated) { return true; }
void window_set_click_config_provider(Window *w, void (*p)(void *)) {}
void window_single_click_subscribe(ButtonId id, ClickHandler handler) {}

Animation *animation_create(void) { return (Animation *)calloc(1, 8); }
void animation_set_duration(Animation *a, uint32_t ms) {}
void animation_set_curve(Animation *a, AnimationCurve c) {}
void animation_set_implementation(Animation *a, const AnimationImplementation *i) {
  s_impl = i;
}
void animation_set_handlers(Animation *a, AnimationHandlers h, void *ctx) {}
bool animation_schedule(Animation *a) { return true; }      // driven by hand
bool animation_unschedule(Animation *a) { return true; }

AppTimer *app_timer_register(uint32_t ms, void (*cb)(void *), void *data) { return NULL; }
void app_timer_cancel(AppTimer *timer) {}

void win_main_push(void) {}    // the splash never gets there in a preview

/* Menu styling is irrelevant to the splash, but ui.c pulls it in. */
void menu_layer_set_normal_colors(MenuLayer *menu, GColor bg, GColor fg) {}
void menu_layer_set_highlight_colors(MenuLayer *menu, GColor bg, GColor fg) {}
