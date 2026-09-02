#!/bin/sh
# Runs everything that can be verified without the Pebble SDK or a watch:
# the phone-side JavaScript, and the watch-side string and favourites logic
# compiled for the host against tools/stub/pebble.h.
set -e

cd "$(dirname "$0")/.."

echo "== phone-side JavaScript =="
node tools/test-pkjs.js

echo
echo "== watch-side C =="
cc -std=c11 -Wall -Wextra -Wno-unused-parameter \
   -Itools/stub -Isrc/c \
   -o /tmp/bcnbus-test-c \
   tools/test-c.c tools/stubs.c src/c/util.c src/c/favorites.c
/tmp/bcnbus-test-c

echo
echo "== splash animation renders =="
cc -std=c11 -Wall -Wextra -Wno-unused-parameter -DPBL_COLOR -DPBL_RECT \
   -Itools/stub -Isrc/c -Itools/preview -o /tmp/bcnbus-preview \
   tools/preview/preview.c tools/preview/render.c src/c/win_splash.c src/c/ui.c
/tmp/bcnbus-preview > /dev/null
python3 tools/preview/ppm2png.py '/tmp/splash-emery-*.ppm' /tmp/bcnbus-splash.png

echo
echo "== watch-side C compiles for every target platform =="
for flags in "-DPBL_COLOR -DPBL_TOUCH -DPBL_RECT" "-DPBL_BW -DPBL_RECT" "-DPBL_COLOR -DPBL_ROUND"; do
  cc -fsyntax-only -std=c11 -Wall -Wextra -Wno-unused-parameter \
     -Itools/stub $flags src/c/*.c
  echo "  ok   $flags"
done
