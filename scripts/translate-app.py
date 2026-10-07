"""Fill missing public UI and server-message translations with AWS Translate.

Refresh sources first with i18n-coverage.js --write-english and
i18n-server-text.js --write. Requires boto3. Existing nonempty entries are
never overwritten. Checkpoints after every batch allow interrupted runs to resume.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
import threading
import boto3
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]
TOKEN = re.compile(r'<[^>]+>|\{(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\}')
FORMAT = r'\b(?:[Yy]{4}|[Dd]{2}|[Mm]{2})(?:[/.-](?:[Yy]{4}|[Dd]{2}|[Mm]{2}))*\b'


class Rows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = {}
        self.key = None

    def handle_starttag(self, tag, attrs):
        if tag == 'p':
            self.key = dict(attrs).get('id')
            self.rows[self.key] = ''

    def handle_endtag(self, tag):
        if tag == 'p':
            self.key = None

    def handle_data(self, value):
        if self.key is not None:
            self.rows[self.key] += value


def read(path):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def save(path, values):
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(values, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--region', default='ap-south-1')
    args = parser.parse_args()
    client = boto3.Session(profile_name=args.profile, region_name=args.region).client('translate')
    supported, token = set(), None
    while True:
        page = client.list_languages(**({'NextToken': token} if token else {}))
        supported.update(row['LanguageCode'] for row in page['Languages'])
        token = page.get('NextToken')
        if not token:
            break
    config = (ROOT / 'frontend/gulpfile.js/config.js').read_text(encoding='utf-8')
    codes = re.findall(r"\{ code: '([^']+)'", config)
    glossary = read(ROOT / 'languages/_glossary.json')
    terms = glossary.get('doNotTranslate', []) + glossary.get('brands', [])
    protected = re.compile(TOKEN.pattern + '|' + FORMAT + r'|\b(?:' + '|'.join(re.escape(t) for t in sorted(terms, key=len, reverse=True)) + r')\b')
    sources = [(ROOT / 'languages', read(ROOT / 'languages/_english.json')),
               (ROOT / 'languages/server', {key: key for key in read(ROOT / 'languages/server/_english.json')})]
    context = read(ROOT / 'languages/_translation-context.json')
    for key, wording in context.items():
        original = sources[0][1].get(key)
        if original is None or sorted(TOKEN.findall(original)) != sorted(TOKEN.findall(wording)):
            raise ValueError('Invalid translation context or changed tokens: ' + key)
        sources[0][1][key] = wording
    rate_lock = threading.Lock()
    last_request = [0.0]

    def run(code):
        target = {'nb': 'no', 'zh-CN': 'zh'}.get(code, code)
        if code == 'en':
            return
        if target not in supported:
            print('AWS unsupported, retaining existing pack: ' + code, flush=True)
            return
        for directory, source in sources:
            path = directory / (code + '.json')
            values = read(path)
            pending = [(key, text) for key, text in source.items() if text and not values.get(key, '').strip()]
            total = len(pending)
            while pending:
                batch, rows, size = [], [], 0
                while pending:
                    key, text = pending[0]
                    parts, start = [], 0
                    for match in protected.finditer(text):
                        parts += [html.escape(text[start:match.start()]), '<span translate="no">' + html.escape(match[0]) + '</span>']
                        start = match.end()
                    parts.append(html.escape(text[start:]))
                    row = '<p id="s' + str(len(batch)) + '">' + ''.join(parts) + '</p>'
                    if size + len(row.encode('utf-8')) > 35000 and batch:
                        break
                    size += len(row.encode('utf-8'))
                    rows.append(row)
                    batch.append(pending.pop(0))
                document = ('<html><body>' + ''.join(rows) + '</body></html>').encode('utf-8')
                for attempt in range(6):
                    try:
                        with rate_lock:
                            time.sleep(max(0, 1.2 - (time.monotonic() - last_request[0])))
                            last_request[0] = time.monotonic()
                        response = client.translate_document(Document={'Content': document, 'ContentType': 'text/html'}, SourceLanguageCode='en', TargetLanguageCode=target)
                        break
                    except ClientError as error:
                        if error.response['Error']['Code'] not in ('ThrottlingException', 'TooManyRequestsException') or attempt == 5:
                            raise
                        time.sleep(2 ** attempt)
                result = Rows()
                result.feed(response['TranslatedDocument']['Content'].decode('utf-8'))
                additions = {}
                for index, (key, original) in enumerate(batch):
                    text = result.rows.get('s' + str(index), '').strip().replace('\u2013', '-').replace('\u2014', '-').replace('\u00a0', ' ')
                    if not text or sorted(TOKEN.findall(original)) != sorted(TOKEN.findall(text)):
                        raise ValueError('Changed markup/placeholder or empty translation: ' + code + ' ' + key)
                    additions[key] = text
                values.update(additions)
                save(path, values)
                print(f'{code} {directory.name}: {total - len(pending)}/{total}', flush=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(run, codes))


if __name__ == '__main__':
    main()
