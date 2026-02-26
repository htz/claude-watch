#!/usr/bin/env python3
"""
Generate macOS menu bar template icons for Claude Watch.

Design: A rounded eye shape with Claude's sparkle logo as the pupil.
The eye conveys "watching", the sparkle identifies Claude.

Output:
  assets/IconTemplate.png    (16x16)
  assets/IconTemplate@2x.png (32x32)

macOS template image requirements:
  - Black pixels on transparent background
  - Named with "Template" suffix
  - macOS automatically applies theme-appropriate tinting
"""

import struct
import zlib
import math
import os


def create_png(width: int, height: int, pixels: list[int]) -> bytes:
    """Create a PNG file from RGBA pixel data."""
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels[idx:idx + 4])

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return (sig
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def decode_png(filepath: str) -> tuple[int, int, list[int]]:
    """Decode a PNG file into RGBA pixel data (pure Python)."""
    with open(filepath, 'rb') as f:
        data = f.read()

    # Verify PNG signature
    assert data[:8] == b'\x89PNG\r\n\x1a\n'

    # Parse chunks
    pos = 8
    chunks: dict[bytes, list[bytes]] = {}
    width = height = bit_depth = color_type = 0
    idat_data = b''

    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        chunk_type = data[pos + 4:pos + 8]
        chunk_data = data[pos + 8:pos + 8 + length]
        pos += 12 + length

        if chunk_type == b'IHDR':
            width, height, bit_depth, color_type = struct.unpack(
                '>IIBB', chunk_data[:10]
            )
        elif chunk_type == b'IDAT':
            idat_data += chunk_data
        elif chunk_type == b'IEND':
            break

    # Decompress
    raw = zlib.decompress(idat_data)

    # Determine bytes per pixel
    if color_type == 6:  # RGBA
        bpp = 4
    elif color_type == 2:  # RGB
        bpp = 3
    elif color_type == 4:  # Grayscale + Alpha
        bpp = 2
    elif color_type == 0:  # Grayscale
        bpp = 1
    else:
        raise ValueError(f'Unsupported color type: {color_type}')

    stride = width * bpp

    # Reconstruct scanlines with filter
    pixels = [0] * (width * height * 4)
    prev_row = [0] * stride
    raw_pos = 0

    for y in range(height):
        filter_type = raw[raw_pos]
        raw_pos += 1
        row = list(raw[raw_pos:raw_pos + stride])
        raw_pos += stride

        # Apply PNG filter
        for i in range(stride):
            a = row[i - bpp] if i >= bpp else 0
            b = prev_row[i]
            c = prev_row[i - bpp] if i >= bpp else 0

            if filter_type == 0:  # None
                pass
            elif filter_type == 1:  # Sub
                row[i] = (row[i] + a) & 0xFF
            elif filter_type == 2:  # Up
                row[i] = (row[i] + b) & 0xFF
            elif filter_type == 3:  # Average
                row[i] = (row[i] + (a + b) // 2) & 0xFF
            elif filter_type == 4:  # Paeth
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    pr = a
                elif pb <= pc:
                    pr = b
                else:
                    pr = c
                row[i] = (row[i] + pr) & 0xFF

        # Convert to RGBA
        for x in range(width):
            dst = (y * width + x) * 4
            src = x * bpp
            if color_type == 6:  # RGBA
                pixels[dst] = row[src]
                pixels[dst + 1] = row[src + 1]
                pixels[dst + 2] = row[src + 2]
                pixels[dst + 3] = row[src + 3]
            elif color_type == 2:  # RGB
                pixels[dst] = row[src]
                pixels[dst + 1] = row[src + 1]
                pixels[dst + 2] = row[src + 2]
                pixels[dst + 3] = 255
            elif color_type == 4:  # GA
                pixels[dst] = row[src]
                pixels[dst + 1] = row[src]
                pixels[dst + 2] = row[src]
                pixels[dst + 3] = row[src + 1]
            elif color_type == 0:  # G
                pixels[dst] = row[src]
                pixels[dst + 1] = row[src]
                pixels[dst + 2] = row[src]
                pixels[dst + 3] = 255

        prev_row = row

    return width, height, pixels


def sample_image(
    src_pixels: list[int], src_w: int, src_h: int,
    x: float, y: float,
) -> int:
    """Bilinear sample of alpha from source image. Returns 0-255 alpha."""
    # Map to source coordinates
    if x < 0 or x >= src_w or y < 0 or y >= src_h:
        return 0

    x0 = int(x)
    y0 = int(y)
    x1 = min(x0 + 1, src_w - 1)
    y1 = min(y0 + 1, src_h - 1)
    fx = x - x0
    fy = y - y0

    def get_alpha(px: int, py: int) -> int:
        idx = (py * src_w + px) * 4
        return src_pixels[idx + 3]

    a00 = get_alpha(x0, y0)
    a10 = get_alpha(x1, y0)
    a01 = get_alpha(x0, y1)
    a11 = get_alpha(x1, y1)

    top = a00 + (a10 - a00) * fx
    bot = a01 + (a11 - a01) * fx
    return int(top + (bot - top) * fy)


def clamp(v: float) -> int:
    return max(0, min(255, int(v)))


def draw_icon(
    size: int,
    src_pixels: list[int], src_w: int, src_h: int,
) -> list[int]:
    """
    Draw the Claude Watch icon at the given size.

    Design: A rounded eye with Claude's sparkle logo as the pupil.
    The eye is tall (not too elongated) so the sparkle is clearly visible.
    """
    pixels = [0] * (size * size * 4)
    scale = size / 32.0  # Normalize to 32px design space

    def set_pixel(x: int, y: int, alpha: int) -> None:
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 4
            pixels[idx] = 0
            pixels[idx + 1] = 0
            pixels[idx + 2] = 0
            pixels[idx + 3] = max(pixels[idx + 3], alpha)

    def distance(x1: float, y1: float, x2: float, y2: float) -> float:
        return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)

    # --- Eye shape parameters (in 32px design space) ---
    eye_cx = 16.0
    eye_cy = 16.0
    eye_width = 14.0    # Half-width of the eye
    eye_height = 10.0   # Half-height — tall, rounded eye

    # --- Sparkle (Claude logo) placement ---
    sparkle_radius = 7.0  # Radius of the area where the sparkle is drawn

    for py in range(size):
        for px in range(size):
            dx = px / scale
            dy = py / scale

            rel_x = dx - eye_cx
            rel_y = dy - eye_cy

            alpha = 0.0

            # --- Eye outline (almond/lens shape from two arcs) ---
            arc_r = (eye_width ** 2 + eye_height ** 2) / (2.0 * eye_height)
            upper_cy = eye_cy + (arc_r - eye_height)
            lower_cy = eye_cy - (arc_r - eye_height)

            dist_upper = distance(dx, dy, eye_cx, upper_cy)
            dist_lower = distance(dx, dy, eye_cx, lower_cy)

            inside_upper = dist_upper < arc_r
            inside_lower = dist_lower < arc_r

            edge_upper = arc_r - dist_upper
            edge_lower = arc_r - dist_lower

            stroke = 2.0 * scale
            outer_stroke = 1.2 * scale

            if inside_upper and inside_lower:
                # Inside the eye
                edge_dist = min(edge_upper, edge_lower) * scale

                # --- Claude sparkle as pupil ---
                dist_center = distance(dx, dy, eye_cx, eye_cy)
                if dist_center < sparkle_radius + 0.5:
                    # Map to source image coordinates
                    # Center the source image in the sparkle area
                    src_x = (rel_x / sparkle_radius * 0.5 + 0.5) * src_w
                    src_y = (rel_y / sparkle_radius * 0.5 + 0.5) * src_h
                    sampled = sample_image(src_pixels, src_w, src_h, src_x, src_y)
                    if sampled > 0:
                        alpha = max(alpha, sampled * 0.9)

                # --- Eye outline stroke ---
                if edge_dist < stroke:
                    t = edge_dist / stroke
                    outline_alpha = (1.0 - t) * 255
                    alpha = max(alpha, outline_alpha)
            else:
                # Outside — anti-aliased outer edge
                if abs(rel_x) < eye_width + 2:
                    out_upper = -edge_upper if not inside_upper else 0
                    out_lower = -edge_lower if not inside_lower else 0
                    out_dist = max(out_upper, out_lower)
                    if out_dist < outer_stroke:
                        t = 1.0 - (out_dist / outer_stroke)
                        alpha = max(alpha, t * 255)

            if alpha > 0:
                set_pixel(px, py, clamp(alpha))

    return pixels


def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    assets_dir = os.path.join(script_dir, '..', 'assets')
    os.makedirs(assets_dir, exist_ok=True)

    # Load Claude sparkle source image
    src_path = os.path.expanduser('~/Downloads/icons8-100.png')
    src_w, src_h, src_pixels = decode_png(src_path)
    print(f'Loaded source: {src_path} ({src_w}x{src_h})')

    # Generate 16x16 (@1x)
    pixels_16 = draw_icon(16, src_pixels, src_w, src_h)
    png_16 = create_png(16, 16, pixels_16)
    path_16 = os.path.join(assets_dir, 'IconTemplate.png')
    with open(path_16, 'wb') as f:
        f.write(png_16)
    print(f'Created {path_16} (16x16)')

    # Generate 32x32 (@2x)
    pixels_32 = draw_icon(32, src_pixels, src_w, src_h)
    png_32 = create_png(32, 32, pixels_32)
    path_32 = os.path.join(assets_dir, 'IconTemplate@2x.png')
    with open(path_32, 'wb') as f:
        f.write(png_32)
    print(f'Created {path_32} (32x32)')


if __name__ == '__main__':
    main()
