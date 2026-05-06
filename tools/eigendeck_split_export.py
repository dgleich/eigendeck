#!/usr/bin/env python3
"""
Split a large Eigendeck HTML export into smaller pieces for web hosting.

Usage:
    python3 split-export.py presentation.html [--max-size 20] [--output-dir out/]

This extracts large assets (base64 images, srcdoc demos) into separate files
and replaces them with references. The main HTML file becomes much smaller.

Output:
    out/
      index.html          Main presentation (small)
      assets/
        img-001.png       Extracted images
        img-002.png
        demo-001.html     Extracted demo HTML files
        demo-002.html

No dependencies beyond Python 3.6+ standard library.
"""

import argparse
import base64
import gzip
import hashlib
import os
import re
import sys
from pathlib import Path


def extract_base64_images(html):
    """Find all base64 data URLs, extract to files, return modified HTML and assets."""
    assets = []
    seen = {}  # hash -> filename for dedup

    def replace_image(match):
        data_url = match.group(0)
        # Parse data:image/png;base64,...
        header, b64data = data_url.split(',', 1)
        mime = header.split(':')[1].split(';')[0]
        ext = mime.split('/')[1]
        if ext == 'jpeg':
            ext = 'jpg'
        if ext == 'svg+xml':
            ext = 'svg'

        img_bytes = base64.b64decode(b64data)
        h = hashlib.md5(img_bytes).hexdigest()[:12]

        if h in seen:
            return f'assets/{seen[h]}'

        filename = f'img-{h}.{ext}'
        seen[h] = filename
        assets.append((filename, img_bytes, mime))
        return f'assets/{filename}'

    new_html = re.sub(
        r'data:image/[^;]+;base64,[A-Za-z0-9+/=]+',
        replace_image,
        html
    )
    return new_html, assets


def extract_srcdoc_demos(html):
    """Extract large srcdoc content into separate files, replace with src references."""
    assets = []
    seen = {}  # hash -> filename for dedup

    def replace_srcdoc(match):
        full_match = match.group(0)
        srcdoc_content = match.group(1)

        # Unescape HTML entities
        demo_html = srcdoc_content.replace('&lt;', '<').replace('&gt;', '>') \
            .replace('&amp;', '&').replace('&quot;', '"')

        # Only extract large demos (>10KB)
        if len(demo_html) < 10000:
            return full_match

        h = hashlib.md5(demo_html.encode()).hexdigest()[:12]

        if h in seen:
            filename = seen[h]
        else:
            filename = f'demo-{h}.html'
            seen[h] = filename
            assets.append((filename, demo_html.encode('utf-8'), 'text/html'))

        # Replace srcdoc with src pointing to the extracted file
        # Keep other attributes (sandbox, style, etc.)
        prefix = full_match[:match.start(1) - match.start(0)]
        suffix = full_match[match.end(1) - match.start(0):]
        # Actually, simpler: replace the whole iframe tag
        attrs = re.search(r'(<iframe[^>]*?)srcdoc=".*?"([^>]*>)', full_match, re.DOTALL)
        if attrs:
            return f'{attrs.group(1)}src="assets/{filename}"{attrs.group(2)}'
        return full_match

    new_html = re.sub(
        r'<iframe([^>]*?)srcdoc="(.*?)"([^>]*?)>',
        lambda m: _replace_srcdoc_match(m, seen, assets),
        html,
        flags=re.DOTALL
    )
    return new_html, assets


def _replace_srcdoc_match(match, seen, assets):
    """Helper for srcdoc replacement."""
    before = match.group(1)
    srcdoc_content = match.group(2)
    after = match.group(3)

    # Unescape HTML entities
    demo_html = srcdoc_content.replace('&lt;', '<').replace('&gt;', '>') \
        .replace('&amp;', '&').replace('&quot;', '"')

    # Only extract large demos (>10KB)
    if len(demo_html) < 10000:
        return match.group(0)

    h = hashlib.md5(demo_html.encode()).hexdigest()[:12]

    if h in seen:
        filename = seen[h]
    else:
        filename = f'demo-{h}.html'
        seen[h] = filename
        assets.append((filename, demo_html.encode('utf-8'), 'text/html'))

    return f'<iframe{before}src="assets/{filename}"{after}>'


def compress_embedded_data(html):
    """Compress the eigendeck-source comment (base64 presentation JSON)."""
    def replace_source(match):
        # The source data is already base64, just note its size
        return match.group(0)  # Keep as-is for now

    return html


def main():
    parser = argparse.ArgumentParser(
        description='Split a large Eigendeck HTML export into smaller pieces')
    parser.add_argument('input', help='Input HTML file')
    parser.add_argument('--max-size', type=int, default=20,
                        help='Target max size in MB (default: 20)')
    parser.add_argument('--output-dir', '-o', default=None,
                        help='Output directory (default: input filename without .html)')
    parser.add_argument('--keep-inline', action='store_true',
                        help='Keep small images inline (only extract >50KB)')
    parser.add_argument('--stats', action='store_true',
                        help='Show size statistics without splitting')
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f'Error: {input_path} not found', file=sys.stderr)
        sys.exit(1)

    html = input_path.read_text(encoding='utf-8')
    original_size = len(html)

    if args.stats:
        print(f'File: {input_path} ({original_size / 1024 / 1024:.1f} MB)')
        # Images
        images = re.findall(r'data:image/[^;]+;base64,[A-Za-z0-9+/=]+', html)
        img_size = sum(len(i) for i in images)
        unique_imgs = len(set(hashlib.md5(i.encode()).hexdigest() for i in images))
        print(f'  Base64 images: {img_size / 1024 / 1024:.1f} MB ({len(images)} total, {unique_imgs} unique)')
        # Demos
        srcdocs = re.findall(r'srcdoc="(.*?)"', html, re.DOTALL)
        demo_size = sum(len(s) for s in srcdocs)
        large_demos = sum(1 for s in srcdocs if len(s) > 10000)
        print(f'  srcdoc demos: {demo_size / 1024 / 1024:.1f} MB ({len(srcdocs)} total, {large_demos} >10KB)')
        # Source
        source = re.search(r'<!-- eigendeck-source: (.+?) -->', html)
        if source:
            print(f'  eigendeck-source: {len(source.group(1)) / 1024:.0f} KB')
        other = original_size - img_size - demo_size
        print(f'  Other (HTML/CSS/JS): {other / 1024:.0f} KB')
        # Estimate split size
        est = other / 1024 / 1024
        print(f'\n  Estimated size after split: {est:.1f} MB (HTML only)')
        print(f'  + {img_size / 1024 / 1024 * 0.75:.1f} MB images (as PNG, ~75% of base64)')
        print(f'  + {demo_size / 1024 / 1024:.1f} MB demos (as separate files)')
        return

    # Output directory
    if args.output_dir:
        out_dir = Path(args.output_dir)
    else:
        out_dir = input_path.with_suffix('')
    assets_dir = out_dir / 'assets'
    assets_dir.mkdir(parents=True, exist_ok=True)

    print(f'Splitting {input_path.name} ({original_size / 1024 / 1024:.1f} MB)...')

    # Step 1: Extract base64 images
    html, image_assets = extract_base64_images(html)
    print(f'  Extracted {len(image_assets)} images ({sum(len(d) for _, d, _ in image_assets) / 1024 / 1024:.1f} MB)')

    # Step 2: Extract large srcdoc demos
    html, demo_assets = extract_srcdoc_demos(html)
    print(f'  Extracted {len(demo_assets)} demos ({sum(len(d) for _, d, _ in demo_assets) / 1024 / 1024:.1f} MB)')

    # Step 2.5: Clean up eigendeck-source (strip data URLs from embedded JSON)
    source_match = re.search(r'<!-- eigendeck-source: (.+?) -->', html)
    if source_match and len(source_match.group(1)) > 200000:  # >200KB
        try:
            import json as _json
            source_json = base64.b64decode(source_match.group(1))
            source_str = source_json.decode('utf-8', errors='replace')
            p = _json.loads(source_str)
            # Strip data URL images from elements (they're already in assets/)
            stripped = 0
            for slide in p.get('slides', []):
                for el in slide.get('elements', []):
                    src = el.get('src', '')
                    if src.startswith('data:image'):
                        el['src'] = f'assets/{hashlib.md5(base64.b64decode(src.split(",", 1)[1]).encode() if False else base64.b64decode(src.split(",", 1)[1])).hexdigest()[:12]}.png'
                        stripped += 1
            if stripped:
                new_source = base64.b64encode(_json.dumps(p).encode()).decode()
                html = html[:source_match.start(1)] + new_source + html[source_match.end(1):]
                old_kb = len(source_match.group(1)) / 1024
                new_kb = len(new_source) / 1024
                print(f'  Cleaned eigendeck-source: {old_kb:.0f} KB → {new_kb:.0f} KB ({stripped} data URLs stripped)')
        except Exception as e:
            print(f'  Warning: could not clean eigendeck-source: {e}')

    # Step 3: Write assets
    for filename, data, mime in image_assets + demo_assets:
        (assets_dir / filename).write_bytes(data)

    # Step 4: Write main HTML
    index_path = out_dir / 'index.html'
    index_path.write_text(html, encoding='utf-8')

    final_size = len(html)
    total_assets = sum(len(d) for _, d, _ in image_assets + demo_assets)

    print(f'\nResults:')
    print(f'  {index_path}: {final_size / 1024 / 1024:.1f} MB')
    print(f'  {assets_dir}/: {len(image_assets) + len(demo_assets)} files, {total_assets / 1024 / 1024:.1f} MB')
    print(f'  Total: {(final_size + total_assets) / 1024 / 1024:.1f} MB')
    print(f'  Reduction: {original_size / 1024 / 1024:.1f} → {final_size / 1024 / 1024:.1f} MB main file')

    if final_size > args.max_size * 1024 * 1024:
        print(f'\n  ⚠ Main file still exceeds {args.max_size} MB target')
        print(f'  Consider: fewer slides, smaller images, or --keep-inline to skip small images')


if __name__ == '__main__':
    main()
