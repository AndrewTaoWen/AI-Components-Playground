import { createFetchTransport } from '@ai-components/react';

export const liveTransport = createFetchTransport('/api/ai', {
  async fetch(input, options) {
    const response = await fetch(input, options);
    if (response.ok) return response;
    if (response.status === 503)
      throw new Error('Add OPENAI_API_KEY to .env.local, then restart npm run dev.');
    if (response.status === 429) throw new Error('Too many requests. Wait a moment and try again.');
    throw new Error(
      `Live request failed (${response.status}). Check your API key, API balance, and model access.`,
    );
  },
});
