import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('native',Path(__file__).parents[1]/'scripts/run-native.py')
native=importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

class ContentEnvironmentTest(unittest.TestCase):
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
