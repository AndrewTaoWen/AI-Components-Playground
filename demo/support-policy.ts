import {
  defineAIContext,
  defineAIPolicy,
  fromAction,
  fromMemory,
  type AIMemoryStore,
} from '@ai-components/react';
export const SUPPORT_SCOPE = 'support-case';
export type Customer = { name: string; company: string; issue: string; revision: number };
export type Followups = { revision: number; tasks: string[] };
export type SupportStep = { text: string; customerRevision: number; targetRevision: number };
export type SupportReceipt = { revision: number; previous: Followups };
export function currentFollowups(store: AIMemoryStore): Followups {
  const value = store.getSnapshot().scopes[SUPPORT_SCOPE]?.followups;
  if (!value) return { revision: 1, tasks: [] };
  const data = value as Followups;
  if (
    !Number.isSafeInteger(data.revision) ||
    !Array.isArray(data.tasks) ||
    data.tasks.some((text) => typeof text !== 'string')
  )
    throw new Error('Invalid saved support tasks.');
  return data;
}
export function currentCustomer(store: AIMemoryStore): Customer | null {
  return (store.getSnapshot().scopes[SUPPORT_SCOPE]?.customer as Customer | undefined) ?? null;
}
export const supportReplyConfig = {
  helpMeWrite: true,
  autocomplete: false,
  recipe: defineAIContext({
    name: 'support.reply',
    purpose: 'Draft a reply for the explicitly accepted customer and request.',
    borrow: { customer: fromMemory('customer'), acceptedCustomer: fromAction('customer.accepted') },
    instructions:
      'Use the supplied customer, company, and issue. Do not invent resolutions, refund promises, or dates.',
    anticipate: () => 'The support agent reviews the draft before deciding what to send.',
  }),
  remember: { key: 'reply', action: 'reply.accepted', source: 'support-reply' },
};
export const supportFollowupPolicy = defineAIPolicy<SupportStep>({
  name: 'support.customer-followup',
  purpose: 'Suggest missing follow-up tasks grounded in an accepted customer request.',
  actionType: 'support.followup',
  borrow: {
    customer: fromMemory('customer'),
    acceptedCustomer: fromAction('customer.accepted'),
    acceptedReply: {
      description: 'Accepted reply for the current accepted customer',
      select(view) {
        const customer = view.history('customer.accepted').at(-1);
        const reply = view.history('reply.accepted').at(-1);
        return customer && reply && reply.id > customer.id ? reply : undefined;
      },
    },
    followups: fromMemory('followups'),
  },
  predict({ borrowed }) {
    const customer = borrowed.customer as Customer | undefined;
    const accepted = borrowed.acceptedCustomer as { id: number } | undefined;
    if (!customer || !accepted) return [];
    const target = (borrowed.followups as Followups | undefined) ?? { revision: 1, tasks: [] };
    const reply = borrowed.acceptedReply as { id: number } | undefined;
    const relevant = /invoice|billing|charge/i.test(customer.issue)
      ? `Check invoice details for ${customer.name}`
      : /access|login|account/i.test(customer.issue)
        ? `Verify account access for ${customer.name}`
        : `Review the request from ${customer.name}`;
    const additions = [relevant, `Follow up with ${customer.name} at ${customer.company}`].filter(
      (text) => !target.tasks.includes(text),
    );
    if (!additions.length) return [];
    return [
      {
        id: `customer-${accepted.id}:reply-${reply?.id ?? 0}:tasks-${target.revision}`,
        title: `Follow up with ${customer.name}`,
        description:
          'These tasks follow from the accepted request. Choose what belongs in the support checklist.',
        evidence: [
          {
            label: `${customer.name} · ${customer.company}`,
            reference: `accepted action ${accepted.id}`,
            revision: customer.revision,
          },
          { label: customer.issue },
          { label: 'Support checklist', revision: target.revision },
        ],
        steps: additions.map((text, index) => ({
          id: `followup-${index}`,
          label: text,
          payload: { text, customerRevision: customer.revision, targetRevision: target.revision },
        })),
      },
    ];
  },
});
