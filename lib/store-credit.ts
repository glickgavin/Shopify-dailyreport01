/**
 * Store credit allocation via the r_order Shopify OAuth app.
 *
 * We already have a scoped Shopify GraphQL client at lib/shopify.ts that uses
 * client_credentials against the r_order app; this module wraps it with the
 * store-credit-specific queries and the "find customer by email → open a
 * store credit account → credit it" workflow.
 *
 * All monetary values are in cents to match the ledger's storage; the Shopify
 * mutation wants a decimal string, so we convert once at the boundary.
 */

import { shopifyGraphQL } from './shopify';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type StoreCreditAllocationResult =
  | { ok: true;  creditReference: string; shopifyCustomerId: string; email: string }
  | { ok: false; reason: 'customer_not_found' | 'no_account' | 'mutation_failed'; detail: string; email: string };

interface CustomerByEmailResp {
  customers: {
    edges: Array<{
      node: {
        id: string;
        email: string | null;
        storeCreditAccounts: {
          edges: Array<{ node: { id: string; balance: { amount: string; currencyCode: string } } }>;
        };
      };
    }>;
  };
}

interface StoreCreditAccountCreditResp {
  storeCreditAccountCredit: {
    storeCreditAccountTransaction: { id: string; balanceAfterTransaction: { amount: string; currencyCode: string } } | null;
    userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
  };
}

/* ------------------------------------------------------------------ */
/*  Queries / Mutations                                               */
/* ------------------------------------------------------------------ */

const CUSTOMER_BY_EMAIL = `
  query CustomerByEmail($q: String!) {
    customers(first: 1, query: $q) {
      edges {
        node {
          id
          email
          storeCreditAccounts(first: 5) {
            edges { node { id balance { amount currencyCode } } }
          }
        }
      }
    }
  }
`;

const STORE_CREDIT_ACCOUNT_CREDIT = `
  mutation StoreCreditAccountCredit($id: ID!, $input: StoreCreditAccountCreditInput!) {
    storeCreditAccountCredit(id: $id, creditInput: $input) {
      storeCreditAccountTransaction {
        id
        balanceAfterTransaction { amount currencyCode }
      }
      userErrors { field message code }
    }
  }
`;

/* ------------------------------------------------------------------ */
/*  Main entrypoint                                                   */
/* ------------------------------------------------------------------ */

/**
 * Allocate store credit in Shopify for the given email + amount.
 * Returns a discriminated union — never throws; the caller records the
 * outcome to the ledger regardless of success or failure.
 */
export async function allocateStoreCredit(params: {
  email: string;
  amountCents: number;
  currency?: string;
}): Promise<StoreCreditAllocationResult> {
  const { email, amountCents } = params;
  const currency = params.currency ?? 'USD';

  let customerResp: CustomerByEmailResp;
  try {
    customerResp = await shopifyGraphQL<CustomerByEmailResp>(CUSTOMER_BY_EMAIL, {
      q: `email:"${email.replace(/"/g, '\\"')}"`,
    });
  } catch (err) {
    return { ok: false, reason: 'mutation_failed', detail: `customer lookup: ${(err as Error).message}`, email };
  }

  const customerNode = customerResp.customers.edges[0]?.node;
  if (!customerNode) {
    return { ok: false, reason: 'customer_not_found', detail: 'no Shopify customer with this email', email };
  }

  const accounts = customerNode.storeCreditAccounts.edges.map(e => e.node);
  const account = accounts.find(a => a.balance.currencyCode === currency) ?? accounts[0];
  if (!account) {
    return { ok: false, reason: 'no_account', detail: `customer ${customerNode.id} has no store credit account`, email };
  }

  const amountDecimal = (amountCents / 100).toFixed(2);

  let creditResp: StoreCreditAccountCreditResp;
  try {
    creditResp = await shopifyGraphQL<StoreCreditAccountCreditResp>(STORE_CREDIT_ACCOUNT_CREDIT, {
      id: account.id,
      input: { creditAmount: { amount: amountDecimal, currencyCode: currency } },
    });
  } catch (err) {
    return { ok: false, reason: 'mutation_failed', detail: `credit mutation: ${(err as Error).message}`, email };
  }

  const errors = creditResp.storeCreditAccountCredit?.userErrors ?? [];
  if (errors.length > 0) {
    return { ok: false, reason: 'mutation_failed', detail: errors.map(e => e.message).join('; '), email };
  }

  const tx = creditResp.storeCreditAccountCredit?.storeCreditAccountTransaction;
  if (!tx) {
    return { ok: false, reason: 'mutation_failed', detail: 'mutation returned no transaction', email };
  }

  return { ok: true, creditReference: tx.id, shopifyCustomerId: customerNode.id, email };
}

/**
 * Resolve which email to actually use per business rule:
 * custom_field_email if valid, else payer_email.
 */
export function resolveCreditEmail(row: {
  custom_field_email: string | null;
  payer_email: string | null;
}): string | null {
  const cf = row.custom_field_email?.trim();
  if (cf && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(cf)) return cf.toLowerCase();
  const p = row.payer_email?.trim();
  if (p) return p.toLowerCase();
  return null;
}
