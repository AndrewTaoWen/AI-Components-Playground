import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../demo/main.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function runMock() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

it('runs the packaged suggestions workflow with partial acceptance and undo', async () => {
  vi.useFakeTimers();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /Change preview/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Suggest next steps' }));
  await runMock();
  expect((screen.getByRole('textbox', { name: 'Category' }) as HTMLInputElement).value).toBe(
    'Uncategorized',
  );
  expect(screen.getByText('memory:current.customer')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /^Priority/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected (2)' }));
  expect((screen.getByRole('textbox', { name: 'Category' }) as HTMLInputElement).value).toBe(
    'Billing',
  );
  expect((screen.getByRole('textbox', { name: 'Priority' }) as HTMLInputElement).value).toBe(
    'Normal',
  );
  expect((screen.getByRole('textbox', { name: 'Reply' }) as HTMLInputElement).value).toContain(
    'Alex Chen',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Undo AI changes' }));
  expect((screen.getByRole('textbox', { name: 'Category' }) as HTMLInputElement).value).toBe(
    'Uncategorized',
  );
  expect((screen.getByRole('textbox', { name: 'Reply' }) as HTMLInputElement).value).toBe('');
});

it('shares accepted customer memory with a separate writing control', async () => {
  vi.useFakeTimers();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /Workflow memory/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Customer details' }), {
    target: { value: 'Name: Alex Chen\nCompany: Northwind' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Suggest field values' }));
  await runMock();
  fireEvent.click(screen.getByRole('button', { name: 'Apply values' }));
  fireEvent.click(screen.getByRole('button', { name: 'Shorten' }));
  await runMock();
  expect(screen.getByText(/Hi Alex Chen, thanks for reaching out from Northwind/)).toBeTruthy();
  expect(
    (screen.getByRole('textbox', { name: 'Customer reply' }) as HTMLTextAreaElement).value,
  ).not.toContain('Alex Chen');
  fireEvent.click(screen.getByRole('button', { name: 'Use rewrite' }));
  expect(
    (screen.getByRole('textbox', { name: 'Customer reply' }) as HTMLTextAreaElement).value,
  ).toContain('Alex Chen');
});

it('shows the selected model and explains missing-key failures in live mode', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      input.endsWith('/status')
        ? Response.json({ configured: false, model: 'gpt-6-luna' })
        : Response.json({ error: 'Key missing' }, { status: 503 }),
    ),
  );
  await act(async () => {
    render(<App />);
  });
  expect(screen.getByText(/gpt-6-luna: add OPENAI_API_KEY/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use /api/ai endpoint' }));
  expect(screen.getByText('gpt-6-luna')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
  });
  expect(
    screen.getByText('Add OPENAI_API_KEY to .env.local, then restart npm run dev.'),
  ).toBeTruthy();
});
