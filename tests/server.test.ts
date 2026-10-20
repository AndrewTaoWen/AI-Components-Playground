// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { AIRequest } from '@ai-components/react';
import { createOpenAIGenerator, outputSchema } from '../server/openai.js';
import { createLocalHandler } from '../server/local-api.js';

const request: AIRequest = {
  action: 'rewrite',
  text: 'Original reply',
  prompt: 'Be concise.',
  instruction: 'Make it friendly.',
  context: { _ai: { borrowed: { customer: 'Alex' } } },
};
function completed(text: string) {
  return Response.json({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  });
}
const signal = () => new AbortController().signal;
function localRequest(body: unknown = request, headers: Record<string, string> = {}) {
  return new Request('http://127.0.0.1:5180/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
it('uses the selected server model, forwards prompt/context, and keeps the key out of the body', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => completed('Hi Alex'));
  const generate = createOpenAIGenerator({ apiKey: 'test-secret', fetch: fetcher });
  expect(await generate(request, { signal: signal() })).toEqual({ text: 'Hi Alex' });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/responses');
  const body = JSON.parse(options!.body as string);
  expect(body).toMatchObject({
    model: 'gpt-6-luna',
    store: false,
    max_output_tokens: 2048,
    reasoning: { effort: 'none' },
  });
  expect(body.instructions).toContain('Be concise.');
  expect(body.instructions).toContain('Make it friendly.');
  expect(JSON.parse(body.input).context).toEqual(request.context);
  expect(options!.headers).toMatchObject({ Authorization: 'Bearer test-secret' });
  expect(options!.body).not.toContain('test-secret');
  expect(body.text).toBeUndefined();
});
it('enforces allowed fields through a strict changes schema and parses structured proposals', async () => {
  const result = {
    changes: [{ field: 'reply', value: 'Hello Alex', reason: 'Greet the customer.' }],
  };
  const fetcher = vi.fn<typeof fetch>(async () => completed(JSON.stringify(result)));
  const generate = createOpenAIGenerator({ apiKey: 'test', fetch: fetcher });
  const input: AIRequest = {
    ...request,
    action: 'extract',
    text: JSON.stringify({ fields: [{ key: 'reply', label: 'Reply' }], values: { reply: '' } }),
  };
  expect(await generate(input, { signal: signal() })).toEqual({ text: '', data: result });
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.text.format).toMatchObject({
    type: 'json_schema',
    strict: true,
    schema: {
      properties: {
        changes: {
          items: { properties: { field: { enum: ['reply'] } }, additionalProperties: false },
        },
      },
    },
  });
});
it('preserves invoice search nulls while omitting absent form and date fields', async () => {
  const outputs = [
    { status: 'unpaid', minAmount: null, customer: null },
    { name: 'Alex', company: null },
    { date: '2026-10-23', time: null, timeZone: 'America/Toronto' },
  ];
  const fetcher = vi.fn<typeof fetch>(async () => completed(JSON.stringify(outputs.shift())));
  const generate = createOpenAIGenerator({ apiKey: 'test', fetch: fetcher });
  expect(
    (await generate({ ...request, action: 'search', context: {} }, { signal: signal() })).data,
  ).toEqual({ status: 'unpaid', minAmount: null, customer: null });
  expect(
    (
      await generate(
        {
          ...request,
          action: 'extract',
          context: { fields: [{ name: 'name' }, { name: 'company' }] },
        },
        { signal: signal() },
      )
    ).data,
  ).toEqual({ name: 'Alex' });
  expect(
    (
      await generate(
        { ...request, action: 'extract', context: { dateInput: { timeZone: 'America/Toronto' } } },
        { signal: signal() },
      )
    ).data,
  ).toEqual({ date: '2026-10-23', timeZone: 'America/Toronto' });
});
it('supports option enums, typed filter operators, and mapping enums', () => {
  const select = outputSchema({
    ...request,
    action: 'select',
    context: { options: [{ value: 'billing' }, { value: 'support' }] },
  });
  expect(select).toMatchObject({
    properties: { values: { items: { enum: ['billing', 'support'] } } },
  });
  const filters = outputSchema({
    ...request,
    action: 'search',
    context: { fields: [{ name: 'amount', type: 'number', operators: ['greater than'] }] },
  });
  expect(filters).toMatchObject({
    properties: {
      filters: {
        items: {
          anyOf: [
            {
              properties: {
                field: { enum: ['amount'] },
                operator: { enum: ['greater than'] },
                value: { type: 'number' },
              },
            },
          ],
        },
      },
    },
  });
  const mapping = outputSchema({
    ...request,
    action: 'extract',
    context: { mapping: { sources: ['Email'], targets: [{ value: 'email' }] } },
  });
  expect(mapping).toMatchObject({
    properties: {
      mappings: {
        items: { properties: { source: { enum: ['Email'] }, target: { enum: ['email'] } } },
      },
    },
  });
});
it.each([
  { status: 'incomplete', output: [] },
  {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }],
  },
  {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }],
  },
])('rejects incomplete, refused, and empty model output', async (body) => {
  const generate = createOpenAIGenerator({
    apiKey: 'test',
    fetch: async () => Response.json(body),
  });
  await expect(generate(request, { signal: signal() })).rejects.toThrow();
});
it('does not echo raw provider errors or the key to the client', async () => {
  const handler = createLocalHandler({
    apiKey: 'test-secret',
    fetch: async () => Response.json({ error: 'test-secret' }, { status: 401 }),
  });
  const response = await handler(localRequest());
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('test-secret');
});
it('reports configuration without exposing the key and blocks unconfigured generation', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const handler = createLocalHandler({ apiKey: '', fetch: fetcher });
  const status = await handler(new Request('http://localhost:5180/api/ai/status'));
  expect(await status.json()).toEqual({ configured: false, model: 'gpt-6-luna' });
  const response = await handler(localRequest());
  expect(response.status).toBe(503);
  expect(await response.text()).toContain('.env.local');
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects cross-origin requests and malformed or oversized JSON before generation', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const handler = createLocalHandler({ apiKey: 'test', fetch: fetcher });
  expect((await handler(localRequest(request, { Origin: 'https://other.example' }))).status).toBe(
    403,
  );
  expect((await handler(localRequest(request, { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(
    403,
  );
  expect((await handler(new Request('http://other.example/api/ai/status'))).status).toBe(403);
  expect((await handler(localRequest({ action: 'unknown' }))).status).toBe(400);
  expect((await handler(localRequest({ ...request, text: 'a'.repeat(40_000) }))).status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});
it('propagates cancellation to the upstream request', async () => {
  const controller = new AbortController();
  let upstream: AbortSignal | undefined;
  const generate = createOpenAIGenerator({
    apiKey: 'test',
    fetch: async (_url, options) => {
      upstream = options?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) =>
        upstream!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }),
      );
    },
  });
  const pending = generate(request, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('Aborted');
  expect(upstream?.aborted).toBe(true);
});
