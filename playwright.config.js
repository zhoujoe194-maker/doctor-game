import { defineConfig } from '@playwright/test';
import { resolveUiPort } from './scripts/ui-port.mjs';

const port = resolveUiPort(process.env);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/ui', timeout: 60000, workers: 1,
  use: { baseURL, viewport: { width: 1440, height: 1060 }, headless: true },
  webServer: {
    command: 'node scripts/serve.mjs',
    env: { ...process.env, PORT: String(port) },
    url: baseURL,
    reuseExistingServer: false
  },
  reporter: 'list'
});
