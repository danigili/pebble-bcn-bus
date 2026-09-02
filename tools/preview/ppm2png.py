#!/usr/bin/env python3
"""Tiles PPM frames side by side and writes a PNG, using only the stdlib."""
import glob, struct, sys, zlib


def read_ppm(path):
    with open(path, 'rb') as f:
        data = f.read()
    parts = data.split(b'\n', 3)
    w, h = map(int, parts[1].split())
    return w, h, parts[3][:w * h * 3]


def write_png(path, w, h, rgb):
    raw = b''.join(b'\x00' + rgb[y * w * 3:(y + 1) * w * 3] for y in range(h))

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload +
                struct.pack('>I', zlib.crc32(tag + payload) & 0xffffffff))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def main(pattern, out):
    paths = sorted(glob.glob(pattern))
    if not paths:
        sys.exit('no frames matched ' + pattern)

    frames = [read_ppm(p) for p in paths]
    gap = 6
    height = max(f[1] for f in frames)
    width = sum(f[0] for f in frames) + gap * (len(frames) - 1)

    canvas = bytearray(b'\x40' * (width * height * 3))
    x0 = 0
    for w, h, rgb in frames:
        for y in range(h):
            start = ((y) * width + x0) * 3
            canvas[start:start + w * 3] = rgb[y * w * 3:(y + 1) * w * 3]
        x0 += w + gap

    write_png(out, width, height, bytes(canvas))
    print('wrote', out, width, 'x', height)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
