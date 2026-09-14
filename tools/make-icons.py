#!/usr/bin/env python3
"""
Draws the app's icons, so they are code and not an opaque binary in the tree.

A bus seen head on: a square subject for a square icon, and at 25 px the
shape of a bus front —windscreen across the top, two lights below— survives
where a side view turns into a smear. Run after changing anything here:

    python3 tools/make-icons.py
"""

import os
import struct
import zlib

# The bus front, drawn in a 100 x 100 box. The roof is square bar a nick off
# each corner, and the wheels show below the body with a gap between them.
BODY = [(19, 2), (81, 2), (86, 7), (86, 84), (14, 84), (14, 7)]
WHEELS = [(29, 86, 10), (71, 86, 10)]
WINDSCREEN = [(23, 22), (77, 22), (77, 48), (23, 48)]
SIGN = [(32, 8), (68, 8), (68, 16), (32, 16)]        # where the line number goes
BUMPER = [(20, 71), (80, 71), (80, 77), (20, 77)]
LIGHTS = [(28, 60, 8), (72, 60, 8)]


def blank(size):
    return [[(0, 0, 0, 0)] * size for _ in range(size)]


def fill_polygon(image, points, colour):
    top = max(0, int(min(y for _, y in points)))
    bottom = min(len(image) - 1, int(max(y for _, y in points)))

    for y in range(top, bottom + 1):
        crossings = []
        for i in range(len(points)):
            x1, y1 = points[i]
            x2, y2 = points[(i + 1) % len(points)]
            if (y1 <= y < y2) or (y2 <= y < y1):
                crossings.append(x1 + (y - y1) / (y2 - y1) * (x2 - x1))
        crossings.sort()
        for i in range(0, len(crossings) - 1, 2):
            for x in range(int(crossings[i]), int(crossings[i + 1]) + 1):
                if 0 <= x < len(image[y]):
                    image[y][x] = colour


def fill_circle(image, cx, cy, r, colour):
    for y in range(int(cy - r), int(cy + r) + 1):
        for x in range(int(cx - r), int(cx + r) + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                if 0 <= y < len(image) and 0 <= x < len(image[y]):
                    image[y][x] = colour


def draw_front(size, body, detail, detailed):
    """The bus front filling the square, with a little air around it."""
    image = blank(size)
    margin = max(1, size // 16)
    scale = (size - margin * 2) / 100.0

    def at(points):
        return [(margin + x * scale, margin + y * scale) for x, y in points]

    # The wheels first, so the body sits over the top of them and they only
    # show below it.
    for wx, wy, wr in WHEELS:
        fill_circle(image, margin + wx * scale, margin + wy * scale,
                    wr * scale, body)

    fill_polygon(image, at(BODY), body)
    fill_polygon(image, at(WINDSCREEN), detail)

    for lx, ly, lr in LIGHTS:
        fill_circle(image, margin + lx * scale, margin + ly * scale,
                    lr * scale, detail)

    # Too fine to survive at menu-icon size, where they would only smudge
    # the shape that has to read at a glance.
    if detailed:
        fill_polygon(image, at(SIGN), detail)
        fill_polygon(image, at(BUMPER), detail)

    return image


def write_png(path, image):
    size = len(image)
    raw = b''
    for row in image:
        raw += b'\x00' + b''.join(struct.pack('BBBB', *px) for px in row)

    def chunk(tag, data):
        body = tag + data
        return (struct.pack('>I', len(data)) + body +
                struct.pack('>I', zlib.crc32(body) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n' +
           chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) +
           chunk(b'IDAT', zlib.compress(raw, 9)) +
           chunk(b'IEND', b''))

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as out:
        out.write(png)
    print('  %-30s %d x %d' % (path, size, size))


WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)
TMB_RED = (214, 0, 28, 255)

if __name__ == '__main__':
    # The watch's own menu icon: a white shape on nothing.
    write_png('resources/images/menu-icon.png',
              draw_front(25, WHITE, CLEAR, False))

    # For the store listing, where there is room for the detail.
    icon = [[TMB_RED] * 144 for _ in range(144)]
    front = draw_front(144, WHITE, TMB_RED, True)
    for y in range(144):
        for x in range(144):
            if front[y][x][3]:
                icon[y][x] = front[y][x]
    write_png('docs/store-icon.png', icon)
