"""Sync four approved original-format artifacts to Drive; never delete remote files."""
import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
import uuid

ARTIFACTS = (
    'SKN34-final-4Team.hwpx',
    'SKN34-final-4Team_WBS.xlsx',
    'SKN34-final-4Team_요구사항정의서.xlsx',
    'SKN34-final-4Team.pdf',
)
ROOT = Path(__file__).resolve().parents[2]


def artifacts(root):
    docs = root / 'docs'
    if docs.is_symlink() or not docs.is_dir():
        raise ValueError('docs must be a real directory')
    result = []
    for name in ARTIFACTS:
        matches = [p for p in docs.iterdir() if unicodedata.normalize('NFC', p.name) == name]
        if len(matches) != 1 or matches[0].is_symlink() or not matches[0].is_file():
            raise ValueError('Missing, ambiguous or unsafe artifact: ' + name)
        result.append(matches[0])
    return result


def match_remote(name, files):
    name = unicodedata.normalize('NFC', name)
    matches = [f for f in files if unicodedata.normalize('NFC', f['name']) == name]
    if len(matches) > 1:
        raise ValueError('Duplicate Drive filename; refusing overwrite: ' + name)
    match = matches[0] if matches else None
    if match and match.get('mimeType', '').startswith('application/vnd.google-apps.'):
        raise ValueError('Refusing to overwrite Google-native document: ' + name)
    if match and match.get('capabilities', {}).get('canEdit') is False:
        raise ValueError('Drive file is not editable: ' + name)
    return match


class Drive:
    def __init__(self):
        keys = ('GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET', 'GDRIVE_REFRESH_TOKEN')
        if not all(os.environ.get(key) for key in keys):
            raise ValueError('Missing required GDRIVE OAuth Secrets')
        body = urlencode(dict(zip(('client_id', 'client_secret', 'refresh_token'),
                                  (os.environ[key] for key in keys)), grant_type='refresh_token')).encode()
        token = self.request('POST', 'https://oauth2.googleapis.com/token', data=body,
                             headers={'Content-Type': 'application/x-www-form-urlencoded'})
        self.token = token['access_token']

    def request(self, method, url, data=None, headers=None):
        headers = dict(headers or {})
        if hasattr(self, 'token'):
            headers['Authorization'] = 'Bearer ' + self.token
        try:
            with urlopen(Request(url, data=data, headers=headers, method=method), timeout=120) as response:
                return json.load(response)
        except HTTPError as error:
            # Response bodies may contain credential details; never print them.
            raise RuntimeError('Google request failed (HTTP %s); check OAuth, API access and folder permissions' % error.code) from None
        except URLError:
            raise RuntimeError('Google network request failed') from None


def upload(api, folder, path, remote):
    content = path.read_bytes()
    checksum = hashlib.md5(content).hexdigest()
    if remote and remote.get('md5Checksum') == checksum:
        return 'unchanged'
    metadata: dict = {'name': unicodedata.normalize('NFC', path.name)}
    if not remote:
        metadata['parents'] = [folder]
    boundary = 'storyfork_' + uuid.uuid4().hex
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    body = (('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n').encode()
            + json.dumps(metadata, ensure_ascii=False).encode()
            + ('\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n').encode()
            + content + ('\r\n--' + boundary + '--\r\n').encode())
    url = 'https://www.googleapis.com/upload/drive/v3/files'
    if remote:
        url += '/' + quote(remote['id'], safe='')
    url += '?' + urlencode({'uploadType': 'multipart', 'fields': 'id,md5Checksum', 'supportsAllDrives': 'true'})
    result = api.request('PATCH' if remote else 'POST', url, data=body,
                         headers={'Content-Type': 'multipart/related; boundary=' + boundary})
    if result.get('md5Checksum') != checksum:
        raise ValueError('Upload checksum not confirmed: ' + path.name)
    print('Drive file:', result['id'])
    return 'updated' if remote else 'created'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate local artifact allowlist without network access')
    args = parser.parse_args()
    paths = artifacts(ROOT)  # Validate all four before any remote operation.
    if args.check:
        for path in paths:
            print('Validated:', path.relative_to(ROOT))
        return
    folder = os.environ.get('GDRIVE_FOLDER_ID', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]+', folder):
        raise ValueError('Missing or invalid GDRIVE_FOLDER_ID variable')
    api = Drive()
    info = api.request('GET', 'https://www.googleapis.com/drive/v3/files/' + folder + '?' + urlencode({
        'fields': 'id,mimeType,trashed,capabilities(canAddChildren)', 'supportsAllDrives': 'true'}))
    if info.get('trashed') or info.get('mimeType') != 'application/vnd.google-apps.folder' or not info.get('capabilities', {}).get('canAddChildren'):
        raise ValueError('Target is not a writable Drive folder')
    files, page = [], None
    while True:
        params = {'q': "'%s' in parents and trashed = false" % folder,
                  'fields': 'nextPageToken,files(id,name,mimeType,md5Checksum,capabilities(canEdit))',
                  'pageSize': 1000, 'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true'}
        if page:
            params['pageToken'] = page
        result = api.request('GET', 'https://www.googleapis.com/drive/v3/files?' + urlencode(params))
        files.extend(result.get('files', []))
        page = result.get('nextPageToken')
        if not page:
            break
    matches = [match_remote(path.name, files) for path in paths]  # Refuse ambiguity before writes.
    for path, remote in zip(paths, matches):
        print(path.name + ': ' + upload(api, folder, path, remote), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print('Drive sync failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
