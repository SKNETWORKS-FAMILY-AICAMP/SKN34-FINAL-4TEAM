#!/usr/bin/env python3
"""Check the routing and forwarding contract of the two nginx configurations."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
for path in (root / 'frontend/nginx.conf', root / 'infrastructure/nginx.dev.conf'):
    config = path.read_text()
    timeout = re.search(r'^\s*proxy_read_timeout\s+(\d+)s;', config, re.M)
    assert timeout and int(timeout.group(1)) > 75, (path, 'proxy must wait beyond the 75s generation deadline')
    for location in ('= /api', '^~ /api/'):
        block = re.search(r'location\s+' + re.escape(location) + r'\s*\{([^}]*)}', config)
        assert block and 'proxy_pass http://core-api:8080;' in block.group(1), (path, location)
    for header in ('Host $http_host', 'X-Forwarded-Host $http_host',
                   'X-Forwarded-Proto $scheme', 'X-Forwarded-For $remote_addr'):
        assert f'proxy_set_header {header};' in config, (path, header)
    if path.name == 'nginx.dev.conf':
        for directive in ('proxy_pass http://web:5173;', 'proxy_http_version 1.1;',
                          'proxy_set_header Upgrade $http_upgrade;',
                          'proxy_set_header Connection $connection_upgrade;'):
            assert directive in config, (path, directive)
    else:
        assert 'try_files $uri =404;' in config
        assert 'try_files $uri $uri/ /index.html;' in config
print('Nginx routing configuration checks passed')
