/* Host-side stand-ins for the watch services the tested code touches. */

#include "app.h"

GColor GColorWhite = { 1 };
GColor GColorBlack = { 0 };

GColor GColorFromHEX(uint32_t hex) {
  GColor colour = { (uint8_t)(hex & 0xff) };
  return colour;
}

#define SLOTS 160
static struct { bool used; uint8_t data[64]; size_t size; int32_t value; } s_persist[SLOTS];

bool persist_exists(uint32_t key) {
  return key < SLOTS && s_persist[key].used;
}

int persist_get_size(uint32_t key) {
  return (key < SLOTS && s_persist[key].used) ? (int)s_persist[key].size : -1;
}

int32_t persist_read_int(uint32_t key) {
  return (key < SLOTS) ? s_persist[key].value : 0;
}

int persist_read_data(uint32_t key, void *buffer, size_t size) {
  if (key >= SLOTS || !s_persist[key].used) return -1;
  size_t n = size < s_persist[key].size ? size : s_persist[key].size;
  memcpy(buffer, s_persist[key].data, n);
  return (int)n;
}

int persist_write_int(uint32_t key, int32_t value) {
  if (key >= SLOTS) return -1;
  s_persist[key].used = true;
  s_persist[key].value = value;
  s_persist[key].size = sizeof(int32_t);
  return sizeof(int32_t);
}

int persist_write_data(uint32_t key, const void *data, size_t size) {
  if (key >= SLOTS || size > sizeof(s_persist[0].data)) return -1;
  s_persist[key].used = true;
  s_persist[key].size = size;
  memcpy(s_persist[key].data, data, size);
  return (int)size;
}

/* favourites push themselves to the phone on every change; off-watch that
   is a no-op. */
void comm_sync_favs(void) {}
