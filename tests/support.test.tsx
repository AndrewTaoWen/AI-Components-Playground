import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AIProvider,
  createAIMemory,
  evaluateAIPolicies,
  createPersistentAIMemory,
  type AIMemoryCheckpoint,
} from '@ai-components/react';
import { SupportCase } from '../demo/examples/support.js';
import { SUPPORT_SCOPE, supportFollowupPolicy } from '../demo/support-policy.js';
import { demoTransport } from '../demo/mock.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function setup() {
  let disk: AIMemoryCheckpoint | null = null;
  const adapter = {
    load: async () => disk,
    save: async (checkpoint: AIMemoryCheckpoint) => {
      disk = checkpoint;
    },
  };
  const persistence = await createPersistentAIMemory({ adapter });
  const view = render(
    <AIProvider memory={persistence.memory} memoryScope={SUPPORT_SCOPE} transport={demoTransport}>
      <SupportCase persistence={persistence} />
    </AIProvider>,
  );
  return { persistence, adapter, ...view };
}
it('borrows an accepted customer for a reviewed reply, then applies and undoes selected follow-ups', async () => {
  vi.useFakeTimers();
  const { persistence } = await setup();
  expect(
    (screen.getByRole('button', { name: 'Review follow-up tasks' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Accept customer request' }));
  fireEvent.click(screen.getByRole('button', { name: /Help me write/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(screen.getByText(/Hi Alex Chen, thanks for reaching out from Northwind/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use draft' }));
  expect(
    (screen.getByRole('textbox', { name: 'Support reply' }) as HTMLTextAreaElement).value,
  ).toContain('Alex Chen');
  fireEvent.click(screen.getByRole('button', { name: 'Review follow-up tasks' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Follow up with Alex Chen at Northwind' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Apply action (1)' }));
  });
  const checklist = screen.getByRole('list', { name: 'Support follow-up checklist' });
  expect(checklist.textContent).toContain('Check invoice details for Alex Chen');
  expect(checklist.textContent).not.toContain('Follow up with');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Undo action' }));
  });
  expect(checklist.textContent).toBe('');
  expect(persistence.memory.getSnapshot().actions.map((event) => event.type)).toContain(
    'support.followup.undone',
  );
  await act(async () => {
    await persistence.dispose();
  });
});
it('rejects stale task review after manual edits without overwriting them', async () => {
  const { persistence } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Accept customer request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review follow-up tasks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add manual follow-up' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Apply action (2)' }));
  });
  expect(screen.getByRole('alert').textContent).toContain('changed');
  expect(
    within(screen.getByRole('list', { name: 'Support follow-up checklist' })).getAllByRole(
      'listitem',
    ),
  ).toHaveLength(1);
  expect(
    persistence.memory
      .getSnapshot()
      .actions.some((event) => event.type === 'support.followup.accepted'),
  ).toBe(false);
  await act(async () => {
    await persistence.dispose();
  });
});
it('restores accepted customer context and suppresses a dismissed next move across reloads', async () => {
  const first = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Accept customer request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review follow-up tasks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss action' }));
  await act(async () => {
    await first.persistence.dispose();
  });
  first.unmount();
  const restored = await createPersistentAIMemory({ adapter: first.adapter });
  render(
    <AIProvider memory={restored.memory} memoryScope={SUPPORT_SCOPE} transport={demoTransport}>
      <SupportCase persistence={restored} />
    </AIProvider>,
  );
  expect(screen.getByText('Accepted: Alex Chen at Northwind · revision 1')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Review follow-up tasks' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(document.body.textContent).toContain('memory:current.customer');
  await act(async () => {
    await restored.dispose();
  });
});

it('does not borrow a reply accepted for a previous customer', () => {
  const memory = createAIMemory();
  memory.remember(
    SUPPORT_SCOPE,
    'customer',
    { name: 'First', company: 'One', issue: 'Invoice', revision: 1 },
    { type: 'customer.accepted' },
  );
  memory.remember(SUPPORT_SCOPE, 'reply', 'Old customer reply', { type: 'reply.accepted' });
  memory.remember(
    SUPPORT_SCOPE,
    'customer',
    { name: 'Second', company: 'Two', issue: 'Invoice', revision: 2 },
    { type: 'customer.accepted' },
  );
  const result = evaluateAIPolicies({
    policies: [supportFollowupPolicy],
    snapshot: memory.getSnapshot(),
    scope: SUPPORT_SCOPE,
  });
  expect(result.predictions[0].inspection.borrowed.acceptedReply).toBeUndefined();
  expect(JSON.stringify(result.predictions[0].inspection)).not.toContain('Old customer reply');
});
