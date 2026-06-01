#!/usr/bin/env python3
import argparse
import base64
import hashlib
import re
from pathlib import Path


DATA_URI_RE = re.compile(
    r'(?:xlink:href|href)\s*=\s*"data:image/([a-zA-Z0-9.+-]+);base64,([^"]+)"',
    re.IGNORECASE,
)

IMAGE_TAG_RE = re.compile(r'<image\b[^>]*>', re.IGNORECASE | re.DOTALL)
ID_RE = re.compile(r'\bid\s*=\s*"([^"]+)"', re.IGNORECASE)


def sanitize_name(value: str) -> str:
    cleaned = re.sub(r'[^a-zA-Z0-9._-]+', '_', value).strip('._-')
    return cleaned or 'image'


def decode_base64(payload: str) -> bytes:
    compact = re.sub(r'\s+', '', payload)
    padding = (-len(compact)) % 4
    if padding:
        compact += '=' * padding
    return base64.b64decode(compact)


def extract_from_svg(svg_path: Path, out_root: Path) -> int:
    content = svg_path.read_text(encoding='utf-8', errors='ignore')
    out_dir = out_root / f"{svg_path.stem}__assets"
    out_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    seen_hashes = set()

    for idx, image_tag_match in enumerate(IMAGE_TAG_RE.finditer(content), start=1):
        image_tag = image_tag_match.group(0)
        data_match = DATA_URI_RE.search(image_tag)
        if not data_match:
            continue

        ext = data_match.group(1).lower().replace('jpeg', 'jpg')
        payload = data_match.group(2)

        id_match = ID_RE.search(image_tag)
        image_id = sanitize_name(id_match.group(1)) if id_match else f"image_{idx:03d}"

        binary = decode_base64(payload)
        digest = hashlib.sha1(binary).hexdigest()
        if digest in seen_hashes:
            continue
        seen_hashes.add(digest)

        file_name = f"{idx:03d}_{image_id}.{ext}"
        out_file = out_dir / file_name
        out_file.write_bytes(binary)
        count += 1

    if count == 0:
        try:
            out_dir.rmdir()
        except OSError:
            pass

    return count


def main() -> int:
    parser = argparse.ArgumentParser(description='Extract embedded base64 images from SVG files.')
    parser.add_argument('input', help='SVG file or directory to scan recursively')
    parser.add_argument(
        '--output',
        help='Output directory root (default: input directory)',
        default=None,
    )
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise SystemExit(f"Input not found: {input_path}")

    if input_path.is_file():
        svgs = [input_path]
        output_root = Path(args.output).resolve() if args.output else input_path.parent
    else:
        svgs = sorted(input_path.rglob('*.svg'))
        output_root = Path(args.output).resolve() if args.output else input_path

    total_images = 0
    total_files = 0

    for svg in svgs:
        extracted = extract_from_svg(svg, output_root)
        if extracted > 0:
            print(f"{svg}: {extracted} extracted")
            total_files += 1
            total_images += extracted

    print(f"Done. SVG with extractions: {total_files}, images extracted: {total_images}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
