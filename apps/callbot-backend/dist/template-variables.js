/**
 * Template variables that can be used in instruction templates.
 * These are dynamically replaced with customer/agent data at runtime.
 */
export const TEMPLATE_VARIABLES = [
    { key: '{CUSTOMER_NAME}', description: 'First name' },
    { key: '{CUSTOMER_SURNAME}', description: 'Last name' },
    { key: '{CUSTOMER_FIN}', description: 'ID number' },
    { key: '{CUSTOMER_CONTRACT_NO}', description: 'Contract number' },
    { key: '{CUSTOMER_DEBT_AMOUNT}', description: 'Total debt' },
    { key: '{OVERDUE_DAYS}', description: 'Days overdue' },
    { key: '{LAST_PAYMENT_DATE}', description: 'Last payment date' },
    { key: '{LAST_PAYMENT_AMOUNT}', description: 'Last payment amount' },
    { key: '{TOTAL_PAID_90D}', description: 'Total paid in last 90 days' },
    { key: '{KEPT_PROMISES_90D}', description: 'Promises kept' },
    { key: '{BROKEN_PROMISES_90D}', description: 'Promises broken' },
    { key: '{SOURCE_ORGANIZATION}', description: 'Original debt holder' },
    { key: '{COLLECTOR_ORGANIZATION}', description: 'Collecting agency' },
    { key: '{DYNAMIC_CONTEXT}', description: 'Free-form per-call context (e.g. from the external call-trigger API)' },
];
