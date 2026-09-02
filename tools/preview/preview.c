/* Renders frames of the splash animation for every screen size. */

#include "preview.h"

static void frames(const char *name, int w, int h, bool round) {
  static const int stops[] = { 0, 30, 60, 85, 100 };

  preview_begin(w, h);
  win_splash_push();          // runs the real load/appear handlers

  const AnimationImplementation *impl = preview_impl();
  if (impl == NULL || impl->update == NULL) {
    printf("no animation implementation captured\n");
    return;
  }

  for (unsigned i = 0; i < sizeof(stops) / sizeof(stops[0]); i++) {
    impl->update(NULL, (AnimationProgress)
                 ((long)stops[i] * ANIMATION_NORMALIZED_MAX / 100));
    preview_clear();
    preview_draw_frame();
    if (round) preview_round_mask();

    char path[128];
    snprintf(path, sizeof(path), "/tmp/splash-%s-%03d.ppm", name, stops[i]);
    preview_write_ppm(path);
    printf("  %s\n", path);
  }
}

int main(void) {
  printf("emery 200x228\n");  frames("emery", 200, 228, false);
  printf("basalt 144x168\n"); frames("basalt", 144, 168, false);
  printf("chalk 180x180\n");  frames("chalk", 180, 180, true);
  return 0;
}
