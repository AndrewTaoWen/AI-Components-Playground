import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { localAIPlugin } from './server/local-api.js';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const external = env.AI_BACKEND_URL;
  return {
    plugins: external
      ? []
      : [
          localAIPlugin({
            apiKey: env.OPENAI_API_KEY ?? '',
            model: env.OPENAI_MODEL || 'gpt-6-luna',
          }),
        ],
    server: external ? { proxy: { '/api/ai': { target: external, changeOrigin: true } } } : {},
    test: { environment: 'jsdom', include: ['tests/**/*.test.ts*'], restoreMocks: true },
  };
});
