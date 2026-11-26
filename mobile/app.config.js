const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { loadEnvFile } = require('node:process');

const root = resolve(__dirname, '..');
const env = resolve(root, '.env');
if (existsSync(env)) loadEnvFile(env);

module.exports = ({ config }) => {
  const firebaseFile = process.env.MOBILE_GOOGLE_SERVICES_FILE;
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ['expo-notifications', { defaultChannel: 'storyfork' }]],
    android: {
      ...config.android,
      ...(firebaseFile ? { googleServicesFile: resolve(root, firebaseFile) } : {}),
    },
    extra: {
      ...config.extra,
      webUrl: process.env.MOBILE_WEB_URL ?? '',
      androidRemotePush: Boolean(firebaseFile),
    },
  };
};
