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
echo "== watch-side C: the payload decoder =="
cc -std=c11 -Wall -Wextra -Wno-unused-parameter \
   -Itools/stub -Isrc/c \
   -o /tmp/bcnbus-test-comm \
   tools/test-comm.c src/c/util.c src/c/favorites.c
/tmp/bcnbus-test-comm

echo
echo "== watch-side C keeps to the C library the watch has =="
# Pebble's C library is a small subset, and a call it does not carry takes
# the app down on the watch while every host test passes. So the watch code
# is held to what it already uses.
allowed='atoi|memcpy|memmove|memset|snprintf|strcat|strchr|strcmp|strcpy|strlen|strncmp'
used=$(grep -ohE '\b(str[a-z]+|mem[a-z]+|atoi|abs|snprintf|printf|malloc|calloc|free|strtol|strtoul|sprintf)\(' src/c/*.c \
       | sed 's/($//;s/(//' | sort -u)
unexpected=$(echo "$used" | grep -vE "^($allowed)$" || true)
if [ -n "$unexpected" ]; then
  echo "  FAIL not known to be on the watch:"
  echo "$unexpected" | sed 's/^/         /'
  exit 1
fi
echo "$used" | sed 's/^/  ok   /'

echo
echo "== watch-side C compiles for every target platform =="
for flags in "-DPBL_COLOR -DPBL_TOUCH -DPBL_RECT" "-DPBL_BW -DPBL_RECT" "-DPBL_COLOR -DPBL_ROUND"; do
  cc -fsyntax-only -std=c11 -Wall -Wextra -Wno-unused-parameter \
     -Itools/stub $flags src/c/*.c
  echo "  ok   $flags"
done
