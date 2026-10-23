import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AIProvider,
  AITextarea,
  AIActionReview,
  AIContextInspector,
  AIActionRejectedError,
  createPersistentAIMemory,
  createWebStorageMemoryAdapter,
  inspectAIRequest,
  useAI,
  useAIAction,
  useAIMemory,
  useAIPrediction,
  useAITask,
  type AIPersistentMemory,
  type AIPrediction,
} from '@ai-components/react';
import {
  SUPPORT_SCOPE,
  currentCustomer,
  currentFollowups,
  supportReplyConfig,
  supportFollowupPolicy,
  type Customer,
  type SupportStep,
  type SupportReceipt,
} from '../support-policy.js';
import type { ComponentExample } from './registry.js';

export function SupportCase({ persistence }: { persistence: AIPersistentMemory }) {
  const environment = useAI();
  const { memory, actions, remember } = useAIMemory();
  const [draft, setDraft] = useState({
    name: 'Alex Chen',
    company: 'Northwind',
    issue: 'I cannot access my invoice after signup.',
  });
  const [reply, setReply] = useState(
    typeof memory.reply === 'string' ? memory.reply : 'Thank you for reaching out.',
  );
  const [formError, setFormError] = useState('');
  const [active, setActive] = useState<AIPrediction<SupportStep> | null>(null);
  const receipts = useRef(new Map<string, SupportReceipt>());
  const undos = useRef(new Set<string>());
  const persistenceStatus = useSyncExternalStore(
    persistence.subscribeStatus,
    persistence.getStatus,
    persistence.getStatus,
  );
  const task = useAITask(supportReplyConfig);
  const prediction = useAIPrediction({ policies: [supportFollowupPolicy] });
  const action = useAIAction<SupportStep, SupportReceipt>({
    type: 'support.followup',
    source: 'support-case',
    validate(proposal) {
      const step = proposal.steps[0].payload;
      if (
        step.customerRevision !== currentCustomer(environment.memory)?.revision ||
        step.targetRevision !== currentFollowups(environment.memory).revision
      )
        throw new AIActionRejectedError(
          'The accepted customer or task list changed. Review fresh follow-up tasks.',
        );
    },
    async execute(proposal, selected, { mutationId }) {
      const cached = receipts.current.get(mutationId);
      if (cached) return cached;
      const step = proposal.steps[0].payload;
      const before = currentFollowups(environment.memory);
      // A local, synchronous revision check/write simulates the app's authoritative transaction.
      if (
        step.targetRevision !== before.revision ||
        step.customerRevision !== currentCustomer(environment.memory)?.revision
      )
        throw new AIActionRejectedError('The support case changed before execution.');
      const next = {
        revision: before.revision + 1,
        tasks: [
          ...before.tasks,
          ...proposal.steps
            .filter((item) => selected.includes(item.id))
            .map((item) => item.payload.text),
        ],
      };
      remember('followups', next, { type: 'support.tasks.updated' });
      const receipt = { revision: next.revision, previous: before };
      receipts.current.set(mutationId, receipt);
      return receipt;
    },
    async undo(receipt, { mutationId }) {
      if (undos.current.has(mutationId)) return;
      const current = currentFollowups(environment.memory);
      if (current.revision !== receipt.revision)
        throw new AIActionRejectedError(
          'The task list has newer edits. Undo would overwrite them.',
        );
      remember(
        'followups',
        { revision: current.revision + 1, tasks: receipt.previous.tasks },
        { type: 'support.tasks.undone' },
      );
      undos.current.add(mutationId);
    },
  });
  const busy = ['validating', 'executing', 'undoing'].includes(action.status);
  const followups = currentFollowups(environment.memory);
  const accepted = currentCustomer(environment.memory);
  return (
    <div className="support-case">
      <p className="description">
        Accept customer details once. A writing field borrows them for a reply, and a local policy
        offers reviewable follow-up tasks.
      </p>
      <form
        aria-label="Customer request"
        onSubmit={(event) => {
          event.preventDefault();
          setFormError('');
          if (!draft.name.trim() || !draft.company.trim() || !draft.issue.trim()) {
            setFormError('Complete the customer, company, and request.');
            return;
          }
          const customer: Customer = {
            name: draft.name.trim(),
            company: draft.company.trim(),
            issue: draft.issue.trim(),
            revision: (currentCustomer(environment.memory)?.revision ?? 0) + 1,
          };
          remember('customer', customer, { type: 'customer.accepted', source: 'support-form' });
        }}
      >
        <label>
          Customer name
          <input
            aria-label="Support customer name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          Company
          <input
            aria-label="Support company"
            value={draft.company}
            onChange={(event) => setDraft({ ...draft, company: event.target.value })}
          />
        </label>
        <label>
          Request
          <textarea
            aria-label="Support request"
            value={draft.issue}
            onChange={(event) => setDraft({ ...draft, issue: event.target.value })}
          />
        </label>
        <button type="submit" disabled={busy || action.retryPending}>
          Accept customer request
        </button>
      </form>
      {formError && <p role="alert">{formError}</p>}
      <p role="status">
        {accepted
          ? `Accepted: ${accepted.name} at ${accepted.company} · revision ${accepted.revision}`
          : 'Customer details have not been accepted yet.'}
      </p>
      <label className="field-label" htmlFor="support-case-reply">
        Support reply
      </label>
      <AITextarea
        id="support-case-reply"
        aria-label="Support reply"
        value={reply}
        onValueChange={setReply}
        ai={supportReplyConfig}
      />
      <AIContextInspector
        inspection={inspectAIRequest(task.prepare({ action: 'write', text: reply }), SUPPORT_SCOPE)}
        label="What informs this reply?"
      />
      <h3>Next moves</h3>
      <button
        type="button"
        disabled={!prediction.predictions.length || busy || action.retryPending || !action.enabled}
        onClick={() => {
          const next = prediction.predictions[0];
          if (next && action.review(next.proposal)) setActive(next);
        }}
      >
        Review follow-up tasks
      </button>
      <AIActionReview
        disabled={!action.enabled}
        proposal={action.proposal}
        onAccept={action.accept}
        onDismiss={action.dismiss}
        onUndo={action.undo}
        canUndo={action.canUndo}
        busy={busy}
        retryPending={action.retryPending}
        error={action.error}
      />
      <AIContextInspector
        inspection={active?.inspection ?? prediction.predictions[0]?.inspection ?? null}
      />
      {prediction.errors.map((error) => (
        <p role="alert" key={error.policy}>
          {error.message}
        </p>
      ))}
      <h3>Support follow-up checklist</h3>
      <ul aria-label="Support follow-up checklist">
        {followups.tasks.map((text, index) => (
          <li key={`${index}:${text}`}>{text}</li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy || action.retryPending}
        onClick={() => {
          const current = currentFollowups(environment.memory);
          remember(
            'followups',
            {
              revision: current.revision + 1,
              tasks: [...current.tasks, 'A manually added follow-up'],
            },
            { type: 'support.tasks.edited' },
          );
        }}
      >
        Add manual follow-up
      </button>
      <p className="footnote">
        Drafts stay here for review. The follow-up policy makes no model calls. Accepted context,
        tasks, and outcomes are saved in this browser.
      </p>
      <p role="status">
        Memory: {persistenceStatus.state === 'idle' ? 'saved' : persistenceStatus.state}
      </p>
      {persistenceStatus.error && (
        <div role="alert">
          {persistenceStatus.error.message}
          <button type="button" onClick={() => void persistence.flush().catch(() => {})}>
            Retry saving memory
          </button>
        </div>
      )}
      <details className="aic-context-inspector">
        <summary>Support activity ({actions.length})</summary>
        <pre>{JSON.stringify(actions, null, 2)}</pre>
      </details>
    </div>
  );
}
function Example() {
  const [persistence, setPersistence] = useState<AIPersistentMemory | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let active: AIPersistentMemory | undefined;
    void createPersistentAIMemory({
      adapter: createWebStorageMemoryAdapter(
        window.localStorage,
        'ai-components-playground:support:v1',
      ),
      maxActions: 100,
    })
      .then(async (controller) => {
        active = controller;
        if (cancelled) await controller.dispose();
        else setPersistence(controller);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
      void active?.dispose().catch(() => {});
    };
  }, []);
  if (error) return <p role="alert">Could not open support memory: {error}</p>;
  if (!persistence) return <p>Opening support memory…</p>;
  return (
    <AIProvider memory={persistence.memory} memoryScope={SUPPORT_SCOPE}>
      <SupportCase persistence={persistence} />
    </AIProvider>
  );
}
export default {
  label: 'Support workflow',
  eyebrow: '14 / WORKFLOW',
  title: 'A customer request, with follow-through',
  icon: '↗',
  Component: Example,
} satisfies ComponentExample;
