import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('native',Path(__file__).parents[1]/'scripts/run-native.py')
native=importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

class ContentEnvironmentTest(unittest.TestCase):
    def test_generation_timeout_is_core_only(self):
        values={'AI_GENERATION_READ_TIMEOUT':'90s'}
        self.assertEqual(native.service_environment('core-api',values).get('AI_GENERATION_READ_TIMEOUT'),'90s')
        for service in ('web','ai-service'):
            self.assertNotIn('AI_GENERATION_READ_TIMEOUT',native.service_environment(service,values))

    def test_native_default_origin_matches_vite_host(self):
        root=Path(__file__).resolve().parents[2]
        self.assertIn("host: env.VITE_DEV_SERVER_HOST || 'localhost'",(root/'frontend/vite.config.ts').read_text(encoding='utf-8'))
        self.assertIn('VITE_DEV_SERVER_HOST=localhost',(root/'.env.example').read_text(encoding='utf-8'))

    def test_proxy_waits_longer_than_default_generation_timeout(self):
        root=Path(__file__).resolve().parents[2]
        self.assertIn('proxy_read_timeout 90s;',(root/'frontend/nginx.conf').read_text(encoding='utf-8'))
    def test_content_secrets_follow_service_boundary(self):
        values={'OPENAI_API_KEY':'synthetic','INTERNAL_TOKEN':'synthetic-internal','CONTENT_DATABASE_PASSWORD':'synthetic-db','CONTENT_ENABLED':'true'}
        core=native.service_environment('core-api',values)
        ai=native.service_environment('ai-service',values)
        web=native.service_environment('web',values)
        self.assertEqual(core.get('CONTENT_ENABLED'),'true')
        self.assertEqual(core.get('CONTENT_DATABASE_PASSWORD'),'synthetic-db')
        self.assertNotIn('OPENAI_API_KEY',core)
        self.assertEqual(ai.get('INTERNAL_TOKEN'),'synthetic-internal')
        self.assertNotIn('CONTENT_DATABASE_PASSWORD',ai)
        for key in values:self.assertNotIn(key,web)
