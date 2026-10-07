"""Translate the public kitchen display catalog using AWS Translate.
Requires boto3 and an AWS profile with translate:TranslateDocument and translate:ListLanguages.
Only checked-in UI text is sent. Existing translations are reused; placeholders are protected.
Run: python scripts/translate-kitchen-display.py --profile posnic-admin --region ap-south-1
"""
import argparse
import concurrent.futures
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
import boto3

ROOT = Path(__file__).resolve().parents[1] / 'api/src/kitchen-board/locales'
class Rows(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows = {}; self.key = None
    def handle_starttag(self, tag, attrs):
        if tag == 'p':
            self.key = dict(attrs).get('id'); self.rows[self.key] = ''
    def handle_endtag(self, tag):
        if tag == 'p': self.key = None
    def handle_data(self, value):
        if self.key is not None: self.rows[self.key] += value

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', required=True)
    parser.add_argument('--region', default='ap-south-1')
    args = parser.parse_args()
    client = boto3.Session(profile_name=args.profile, region_name=args.region).client('translate')
    supported = set()
    token = None
    while True:
        page = client.list_languages(**({'NextToken':token} if token else {}))
        supported.update(row['LanguageCode'] for row in page['Languages'])
        token = page.get('NextToken')
        if not token: break
    source = json.loads((ROOT/'en.json').read_text(encoding='utf-8'))
    languages = json.loads((ROOT/'index.json').read_text(encoding='utf-8'))
    mapping = {'nb': 'no', 'zh-CN': 'zh', 'zh-TW': 'zh-TW'}
    def translate(language):
        code = language['code']; target = mapping.get(code, code)
        if code == 'en': return
        if target not in supported:
            print('Unsupported by AWS:', code, flush=True); return
        path = ROOT/(code+'.json')
        values = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        pending = [key for key in source if key not in values]
        if not pending: return
        rows = []
        for index, key in enumerate(pending):
            text = re.sub(r'\{\w+\}', lambda m:'<span translate="no">'+m[0]+'</span>', html.escape(key))
            # Product names retain their identity across languages.
            text = re.sub(r'\b(Posnic|POSNIC|Captain|POS|HDMI|Windows)\b', lambda m:'<span translate="no">'+m[0]+'</span>', text)
            rows.append('<p id="s'+str(index)+'">'+text+'</p>')
        document = ('<html><body>'+''.join(rows)+'</body></html>').encode('utf-8')
        for attempt in range(4):
            try:
                result = client.translate_document(Document={'Content':document, 'ContentType':'text/html'}, SourceLanguageCode='en', TargetLanguageCode=target)
                break
            except client.exceptions.TooManyRequestsException:
                if attempt == 3: raise
                time.sleep(2**attempt)
        parsed = Rows(); parsed.feed(result['TranslatedDocument']['Content'].decode('utf-8'))
        for index, key in enumerate(pending):
            translated = parsed.rows.get('s'+str(index), '').strip().replace('\u2014', '-').replace('\u2013', '-')
            if not translated or sorted(re.findall(r'\{\w+\}',key)) != sorted(re.findall(r'\{\w+\}',translated)):
                raise ValueError('Missing text or changed placeholder: '+code+' '+key)
            values[key] = translated
        path.write_text(json.dumps({key:values[key] for key in source},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(code+': '+str(len(pending))+' AWS translations',flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(translate,languages))
if __name__ == '__main__': main()
