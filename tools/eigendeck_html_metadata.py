#!/usr/bin/env python3
"""
Extract metadata from an Eigendeck HTML export.

Usage:
    python3 eigendeck-html-metadata.py presentation.html
    python3 eigendeck-html-metadata.py presentation.html --json
    python3 eigendeck-html-metadata.py presentation.html --outline

No dependencies beyond Python 3.6+ standard library.
"""

import argparse
import base64
import json
import re
import sys
from collections import Counter
from pathlib import Path


def extract_source(html):
    """Extract and decode the eigendeck-source JSON from the HTML."""
    match = re.search(r'<!-- eigendeck-source: (.+?) -->', html)
    if not match:
        return None
    try:
        decoded = base64.b64decode(match.group(1))
        return json.loads(decoded.decode('utf-8', errors='replace'))
    except Exception:
        return None


def count_images(html):
    """Count and measure inline base64 images."""
    images = re.findall(r'src="(data:image/([^;]+);base64,[A-Za-z0-9+/=]+)"', html)
    by_type = Counter()
    total_size = 0
    for data_url, img_type in images:
        by_type[img_type] += 1
        total_size += len(data_url)
    return len(images), total_size, dict(by_type)


def count_iframes(html):
    """Count srcdoc and src iframes."""
    srcdoc_count = len(re.findall(r'<iframe[^>]*srcdoc="', html))
    all_iframes = len(re.findall(r'<iframe', html))
    return srcdoc_count, all_iframes - srcdoc_count


def main():
    parser = argparse.ArgumentParser(description='Extract metadata from Eigendeck HTML export')
    parser.add_argument('input', help='Input HTML file')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    parser.add_argument('--outline', action='store_true', help='Show slide outline')
    parser.add_argument('--elements', action='store_true', help='Show all elements per slide')
    parser.add_argument('--source', action='store_true', help='Extract eigendeck-source JSON to stdout')
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f'Error: {input_path} not found', file=sys.stderr)
        sys.exit(1)

    html = input_path.read_text(encoding='utf-8')
    file_size = len(html)

    # Verify this is an Eigendeck export
    presentation = extract_source(html)
    has_slides = bool(re.search(r'data-index="\d+"', html))
    if not presentation and not has_slides:
        print(f'Error: {input_path} is not an Eigendeck HTML export', file=sys.stderr)
        sys.exit(1)

    if args.source:
        if presentation:
            json.dump(presentation, sys.stdout, indent=2)
            print()
        else:
            print('No eigendeck-source found', file=sys.stderr)
            sys.exit(1)
        return

    # Basic HTML stats
    title_match = re.search(r'<title>(.*?)</title>', html)
    html_title = title_match.group(1) if title_match else '?'
    slide_count = len(re.findall(r'data-index="\d+"', html))
    num_images, image_size, image_types = count_images(html)
    srcdoc_count, src_count = count_iframes(html)
    source_match = re.search(r'<!-- eigendeck-source: (.+?) -->', html)
    source_size = len(source_match.group(1)) if source_match else 0

    # From eigendeck-source (if available)
    src_title = None
    src_author = None
    src_venue = None
    src_theme = None
    src_slides = 0
    element_counts = Counter()

    if presentation:
        src_title = presentation.get('title')
        src_theme = presentation.get('theme', 'white')
        config = presentation.get('config', {})
        src_author = config.get('author')
        src_venue = config.get('venue')
        src_slides = len(presentation.get('slides', []))
        for slide in presentation.get('slides', []):
            for el in slide.get('elements', []):
                element_counts[el.get('type', '?')] += 1

    if args.outline and presentation:
        print(f'{src_title or html_title}')
        if src_author:
            print(f'  {src_author}' + (f' · {src_venue}' if src_venue else ''))
        print(f'  {src_slides} slides, theme: {src_theme}')
        print()
        for i, slide in enumerate(presentation.get('slides', [])):
            elements = slide.get('elements', [])
            title_el = next((e for e in elements if e.get('preset') == 'title'), None)
            title_text = ''
            if title_el:
                title_text = re.sub(r'<[^>]+>', '', title_el.get('html', '')).strip()
                title_text = title_text.replace('&nbsp;', ' ').replace('&amp;', '&')[:60]

            types = Counter(e.get('type', '?') for e in elements)
            type_str = ', '.join(f'{c} {t}' for t, c in types.most_common())

            group = f' [group {slide["groupId"][:6]}]' if slide.get('groupId') else ''
            theme = f' [{slide["theme"]}]' if slide.get('theme') else ''

            print(f'  {i+1:3d}. {title_text or "(no title)"}')
            if args.elements:
                for el in elements:
                    t = el.get('type', '?')
                    p = el.get('position', {})
                    pos_str = f'({p.get("x", 0)},{p.get("y", 0)} {p.get("width", 0)}x{p.get("height", 0)})'
                    if t == 'text':
                        text = re.sub(r'<[^>]+>', '', el.get('html', '')).strip()[:40]
                        text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
                        print(f'       [{el.get("preset", "?")}] {pos_str} "{text}"')
                    elif t == 'image':
                        src = el.get('src', '')
                        if src.startswith('data:'):
                            print(f'       [image] {pos_str} data URL ({len(src)//1024} KB)')
                        else:
                            print(f'       [image] {pos_str} {src}')
                    elif t == 'demo-piece':
                        print(f'       [demo-piece] {pos_str} {el.get("demoSrc", "?")} #{el.get("piece", "?")}')
                    elif t == 'demo':
                        print(f'       [demo] {pos_str} {el.get("src", "?")}')
                    elif t == 'arrow':
                        print(f'       [arrow] ({el.get("x1")},{el.get("y1")}) → ({el.get("x2")},{el.get("y2")})')
                    elif t == 'cover':
                        print(f'       [cover] {pos_str} {el.get("color", "#fff")}')
            else:
                if type_str:
                    print(f'       {type_str}{group}{theme}')
        return

    metadata = {
        'file': str(input_path),
        'file_size_mb': round(file_size / 1024 / 1024, 1),
        'title': src_title or html_title,
        'author': src_author,
        'venue': src_venue,
        'theme': src_theme,
        'slides': src_slides or slide_count,
        'images': {
            'count': num_images,
            'size_mb': round(image_size / 1024 / 1024, 1),
            'types': image_types,
        },
        'demos': {
            'srcdoc': srcdoc_count,
            'external': src_count,
        },
        'elements': dict(element_counts),
        'eigendeck_source_kb': round(source_size / 1024),
        'has_mathjax_cdn': bool(re.search(r'mathjax@3', html)),
    }

    if args.json:
        json.dump(metadata, sys.stdout, indent=2)
        print()
    else:
        print(f'{metadata["title"]}')
        if metadata['author']:
            print(f'  {metadata["author"]}' + (f' · {metadata["venue"]}' if metadata['venue'] else ''))
        print(f'  File: {metadata["file_size_mb"]} MB')
        print(f'  Slides: {metadata["slides"]}')
        print(f'  Theme: {metadata["theme"] or "white"}')
        print(f'  Images: {metadata["images"]["count"]} ({metadata["images"]["size_mb"]} MB)')
        if metadata['images']['types']:
            print(f'    Types: {metadata["images"]["types"]}')
        print(f'  Demos: {metadata["demos"]["srcdoc"]} inline, {metadata["demos"]["external"]} external')
        if metadata['elements']:
            parts = [f'{c} {t}' for t, c in sorted(metadata['elements'].items(), key=lambda x: -x[1])]
            print(f'  Elements: {", ".join(parts)}')
        print(f'  Eigendeck source: {metadata["eigendeck_source_kb"]} KB')
        print(f'  MathJax CDN: {"yes" if metadata["has_mathjax_cdn"] else "no (pre-rendered)"}')


if __name__ == '__main__':
    main()
