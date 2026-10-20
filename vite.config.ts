import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  // A developer-supplied backend implements the library's AIRequest/AIResponse contract.
  // Credentials belong on that backend, never in VITE_* variables or browser inputs.
  const { AI_BACKEND_URL } = loadEnv(mode, process.cwd(), 'AI_');
  return {
    server: AI_BACKEND_URL
      ? { proxy: { '/api/ai': { target: AI_BACKEND_URL, changeOrigin: true } } }
      : {},
    test: { environment: 'jsdom', include: ['tests/**/*.test.tsx'], restoreMocks: true },
  };
});
