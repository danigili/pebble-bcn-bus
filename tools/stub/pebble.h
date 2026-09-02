/* Minimal stand-in for pebble.h: enough of the surface BCN Bus uses to let a
   host compiler check syntax, signatures and field access. Not the SDK. */
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct { uint8_t argb; } GColor;
typedef struct { int16_t x, y; } GPoint;
typedef struct { int16_t w, h; } GSize;
typedef struct { GPoint origin; GSize size; } GRect;
static inline GPoint GPointMake(int16_t x, int16_t y){ GPoint p={x,y}; return p; }
static inline GRect GRectMake(int16_t x,int16_t y,int16_t w,int16_t h){ GRect r={{x,y},{w,h}}; return r; }
#define GPoint(x,y) GPointMake((int16_t)(x),(int16_t)(y))
#define GRect(x,y,w,h) GRectMake((int16_t)(x),(int16_t)(y),(int16_t)(w),(int16_t)(h))

extern GColor GColorWhite, GColorBlack;
GColor GColorFromHEX(uint32_t hex);

typedef enum { GCornerNone=0, GCornersAll=1 } GCornerMask;
typedef enum { GTextOverflowModeFill, GTextOverflowModeTrailingEllipsis } GTextOverflowMode;
typedef enum { GTextAlignmentLeft, GTextAlignmentCenter, GTextAlignmentRight } GTextAlignment;

typedef struct GContext GContext;
typedef struct Layer Layer;
typedef struct Window Window;
typedef struct MenuLayer MenuLayer;
typedef struct GFont_ *GFont;
typedef struct AppTimer AppTimer;
typedef struct GBitmap GBitmap;

#define FONT_KEY_GOTHIC_14 "g14"
#define FONT_KEY_GOTHIC_14_BOLD "g14b"
#define FONT_KEY_GOTHIC_18 "g18"
#define FONT_KEY_GOTHIC_18_BOLD "g18b"
#define FONT_KEY_GOTHIC_24_BOLD "g24b"
#define FONT_KEY_GOTHIC_28_BOLD "g28b"
GFont fonts_get_system_font(const char *key);

Layer *layer_create(GRect frame);
void layer_destroy(Layer *layer);
void layer_add_child(Layer *parent, Layer *child);
GRect layer_get_bounds(const Layer *layer);
void layer_set_update_proc(Layer *layer, void (*proc)(Layer *, GContext *));
void layer_mark_dirty(Layer *layer);

typedef void (*WindowHandler)(Window *);
typedef struct { WindowHandler load, appear, disappear, unload; } WindowHandlers;
Window *window_create(void);
void window_destroy(Window *window);
void window_set_window_handlers(Window *window, WindowHandlers handlers);
void window_stack_push(Window *window, bool animated);
void window_stack_pop(bool animated);
bool window_stack_remove(Window *window, bool animated);
Layer *window_get_root_layer(const Window *window);
void window_set_click_config_provider(Window *window, void (*provider)(void *));

typedef enum { BUTTON_ID_BACK, BUTTON_ID_UP, BUTTON_ID_SELECT, BUTTON_ID_DOWN } ButtonId;
typedef void *ClickRecognizerRef;
typedef void (*ClickHandler)(ClickRecognizerRef, void *);
void window_single_click_subscribe(ButtonId id, ClickHandler handler);
void window_single_repeating_click_subscribe(ButtonId id, uint16_t ms, ClickHandler handler);
void window_long_click_subscribe(ButtonId id, uint16_t ms, ClickHandler down, ClickHandler up);

typedef struct { uint16_t section, row; } MenuIndex;
#define MENU_CELL_BASIC_HEADER_HEIGHT 16
typedef struct {
  uint16_t (*get_num_sections)(MenuLayer *, void *);
  uint16_t (*get_num_rows)(MenuLayer *, uint16_t, void *);
  int16_t (*get_cell_height)(MenuLayer *, MenuIndex *, void *);
  int16_t (*get_header_height)(MenuLayer *, uint16_t, void *);
  void (*draw_row)(GContext *, const Layer *, MenuIndex *, void *);
  void (*draw_header)(GContext *, const Layer *, uint16_t, void *);
  void (*select_click)(MenuLayer *, MenuIndex *, void *);
  void (*select_long_click)(MenuLayer *, MenuIndex *, void *);
} MenuLayerCallbacks;
MenuLayer *menu_layer_create(GRect frame);
void menu_layer_destroy(MenuLayer *menu);
void menu_layer_set_callbacks(MenuLayer *menu, void *context, MenuLayerCallbacks cbs);
void menu_layer_set_click_config_onto_window(MenuLayer *menu, Window *window);
Layer *menu_layer_get_layer(const MenuLayer *menu);
void menu_layer_reload_data(MenuLayer *menu);
bool menu_layer_is_index_selected(const MenuLayer *menu, MenuIndex *index);
void menu_layer_set_normal_colors(MenuLayer *menu, GColor bg, GColor fg);
void menu_layer_set_highlight_colors(MenuLayer *menu, GColor bg, GColor fg);
void menu_layer_set_center_focused(MenuLayer *menu, bool centered);
void menu_cell_basic_draw(GContext *ctx, const Layer *cell, const char *title,
                          const char *subtitle, GBitmap *icon);
void menu_cell_basic_header_draw(GContext *ctx, const Layer *cell, const char *title);

void graphics_context_set_fill_color(GContext *ctx, GColor color);
void graphics_context_set_text_color(GContext *ctx, GColor color);
void graphics_context_set_stroke_color(GContext *ctx, GColor color);
void graphics_fill_rect(GContext *ctx, GRect rect, uint16_t radius, GCornerMask mask);
void graphics_draw_rect(GContext *ctx, GRect rect);
void graphics_fill_circle(GContext *ctx, GPoint centre, uint16_t radius);
void graphics_draw_text(GContext *ctx, const char *text, GFont font, GRect box,
                        GTextOverflowMode overflow, GTextAlignment align, void *attrs);

AppTimer *app_timer_register(uint32_t ms, void (*cb)(void *), void *data);
void app_timer_cancel(AppTimer *timer);
void vibes_short_pulse(void);
void app_event_loop(void);

typedef enum { APP_MSG_OK = 0, APP_MSG_BUSY } AppMessageResult;
typedef union { char cstring[1]; int8_t int8; int16_t int16; int32_t int32; } TupleValue;
typedef struct { uint32_t key; uint8_t type; uint16_t length; TupleValue value[1]; } Tuple;
typedef struct DictionaryIterator DictionaryIterator;
Tuple *dict_find(const DictionaryIterator *iter, uint32_t key);
uint32_t dict_write_int32(DictionaryIterator *iter, uint32_t key, int32_t value);
uint32_t dict_write_cstring(DictionaryIterator *iter, uint32_t key, const char *value);
void app_message_register_inbox_received(void (*cb)(DictionaryIterator *, void *));
void app_message_register_inbox_dropped(void (*cb)(AppMessageResult, void *));
void app_message_register_outbox_failed(void (*cb)(DictionaryIterator *, AppMessageResult, void *));
AppMessageResult app_message_open(uint32_t inbox, uint32_t outbox);
AppMessageResult app_message_outbox_begin(DictionaryIterator **iter);
AppMessageResult app_message_outbox_send(void);

bool persist_exists(uint32_t key);
int persist_get_size(uint32_t key);
int32_t persist_read_int(uint32_t key);
int persist_read_data(uint32_t key, void *buffer, size_t size);
int persist_write_int(uint32_t key, int32_t value);
int persist_write_data(uint32_t key, const void *data, size_t size);

#define APP_LOG_LEVEL_WARNING 1
#define APP_LOG(level, ...) ((void)0)

#define MESSAGE_KEY_CMD 1
#define MESSAGE_KEY_STOP_CODE 2
#define MESSAGE_KEY_MSG_TYPE 3
#define MESSAGE_KEY_PAYLOAD 4
#define MESSAGE_KEY_TITLE 5
#define MESSAGE_KEY_LANG 6

#if defined(PBL_TOUCH)
typedef struct Recognizer Recognizer;
typedef enum { RecognizerEvent_Started, RecognizerEvent_Updated,
               RecognizerEvent_Completed, RecognizerEvent_Cancelled } RecognizerEvent;
typedef void (*RecognizerEventCb)(const Recognizer *, RecognizerEvent);
bool touch_service_is_enabled(void);
Recognizer *tap_recognizer_create(RecognizerEventCb cb, void *context);
GPoint tap_recognizer_get_tap_point(const Recognizer *recognizer);
void window_attach_recognizer(Window *window, Recognizer *recognizer);
void window_set_touch_bridge_disabled(Window *window, bool disabled);
#endif
