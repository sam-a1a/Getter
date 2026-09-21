"""Generate small original extension icons using only Python's standard library."""
import struct
import zlib
from pathlib import Path

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

def inside_polygon(x, y, points):
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if ((yi > y) != (yj > y)) and x < (xj-xi)*(y-yi)/(yj-yi)+xi:
            inside = not inside
        j = i
    return inside

points = [(27, 13), (37, 13), (37, 33), (44, 26), (51, 33), (32, 52), (13, 33), (20, 26), (27, 33)]
for size in (16, 32, 48, 128):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            colors = []
            for dy in (.125, .375, .625, .875):
                for dx in (.125, .375, .625, .875):
                    px, py = (x+dx)*64/size, (y+dy)*64/size
                    corner_x, corner_y = max(12-px, 0, px-52), max(12-py, 0, py-52)
                    if corner_x**2 + corner_y**2 > 144:
                        colors.append((0, 0, 0, 0))
                    elif inside_polygon(px, py, points):
                        colors.append((49, 38, 65, 255))
                    else:
                        colors.append((222, 207, 247, 255))
            raw.extend(round(sum(c[i] for c in colors)/16) for i in range(4))
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    (Path(__file__).resolve().parent.parent / 'extension' / 'icons' / f'{size}.png').write_bytes(data)
