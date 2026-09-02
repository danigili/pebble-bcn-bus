#include "app.h"

static void init(void) {
  favs_load();
  comm_init();
  win_splash_push();
}

static void deinit(void) {
  // Windows tear themselves down as the stack unwinds.
}

int main(void) {
  init();
  app_event_loop();
  deinit();
  return 0;
}
