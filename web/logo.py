"""Write the vibepult logo as a PNG: eight fader strips over a pixel-font wordmark, stdlib only.

    python web/logo.py [scale] [out.png]     # default scale 16 -> 816 x 368, web/logo.png
"""
import struct, sys, zlib

GLYPHS = {  # 5 x 7 pixel font, only the letters the name needs
    "V": "X...X X...X X...X X...X X...X .X.X. ..X..",
    "I": "XXXXX ..X.. ..X.. ..X.. ..X.. ..X.. XXXXX",
    "B": "XXXX. X...X X...X XXXX. X...X X...X XXXX.",
    "E": "XXXXX X.... X.... XXXX. X.... X.... XXXXX",
    "P": "XXXX. X...X X...X XXXX. X.... X.... X....",
    "U": "X...X X...X X...X X...X X...X X...X .XXX.",
    "L": "X.... X.... X.... X.... X.... X.... XXXXX",
    "T": "XXXXX ..X.. ..X.. ..X.. ..X.. ..X.. ..X..",
}
NAME = "VIBEPULT"
CAPS = [3, 6, 8, 5, 1, 4, 7, 2]   # fader cap positions, one strip per letter, 0 = bottom of the 10-unit track
MARGIN, TRACK, GAP = 2, 10, 2
W = MARGIN * 2 + len(NAME) * 6 - 1
H = MARGIN * 2 + TRACK + GAP + 7
INK, TRACK_INK, CAP_INK = (240, 240, 240, 255), (90, 90, 90, 255), (255, 176, 0, 255)  # cap = the desk's LCD amber


def cells():
    """Yield (x, y, rgba) in logo units; everything else is transparent."""
    for i, ch in enumerate(NAME):
        x0 = MARGIN + i * 6
        for r, row in enumerate(GLYPHS[ch].split()):
            for c, bit in enumerate(row):
                if bit == "X":
                    yield x0 + c, MARGIN + TRACK + GAP + r, INK
        for y in range(TRACK):                    # the slot
            yield x0 + 2, MARGIN + y, TRACK_INK
        cy = MARGIN + TRACK - 1 - CAPS[i]         # the cap, 3 wide 2 tall, centred on the slot
        for dx in (-1, 0, 1):
            for dy in (0, 1):
                yield x0 + 2 + dx, cy - 1 + dy, CAP_INK


def png(scale):
    px = bytearray(W * scale * H * scale * 4)
    for x, y, rgba in cells():
        for yy in range(y * scale, (y + 1) * scale):
            px[(yy * W * scale + x * scale) * 4:(yy * W * scale + (x + 1) * scale) * 4] = bytes(rgba) * scale
    stride = W * scale * 4
    raw = b"".join(b"\0" + px[r * stride:(r + 1) * stride] for r in range(H * scale))

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W * scale, H * scale, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    scale = int(sys.argv[1]) if len(sys.argv) > 1 else 16
    out = sys.argv[2] if len(sys.argv) > 2 else "web/logo.png"
    data = png(scale)
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", data[16:24]) == (W * scale, H * scale)
    open(out, "wb").write(data)
    print(f"{out}: {W * scale} x {H * scale}, {len(data)} bytes")
