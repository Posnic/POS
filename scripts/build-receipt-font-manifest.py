"""Index the unmodified receipt fonts. Development dependency: fonttools.

Run after adding/replacing a font and its original OFL notice:
    python -m pip install fonttools
    python scripts/build-receipt-font-manifest.py
"""
import hashlib
import json
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
directory = ROOT / 'src' / 'fonts'
fonts = []
for file in sorted(directory.glob('*.ttf')):
    family = file.stem
    license_file = family + '-OFL.txt'
    if not (directory / license_file).is_file():
        raise ValueError('Missing original license: ' + license_file)
    with TTFont(file) as font:
        ranges = []
        for point in sorted(font.getBestCmap()):
            if ranges and point == ranges[-1][1] + 1:
                ranges[-1][1] = point
            else:
                ranges.append([point, point])
    fonts.append(dict(family=family, file=file.name, license=license_file,
                      source='https://github.com/google/fonts/tree/main/ofl/' + family.lower(),
                      sha256=hashlib.sha256(file.read_bytes()).hexdigest(), ranges=ranges))
(directory / 'manifest.json').write_text(json.dumps({'fonts': fonts}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Indexed', len(fonts), 'receipt fonts')
