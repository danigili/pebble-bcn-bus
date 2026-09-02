#pragma once
#include "app.h"

void preview_begin(int width, int height);
void preview_clear(void);
void preview_draw_frame(void);
int  preview_write_ppm(const char *path);
void preview_round_mask(void);
const AnimationImplementation *preview_impl(void);
