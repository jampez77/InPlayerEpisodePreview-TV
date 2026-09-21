import {defineConfig} from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    timeout: 15000,
    expect: {timeout: 5000},
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        browserName: 'chromium',
        viewport: {width: 1440, height: 900},
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    webServer: {
        command: 'node demo/server.cjs',
        url: 'http://127.0.0.1:4173/demo/index.html',
        reuseExistingServer: !process.env.CI,
        timeout: 10000
    }
});
