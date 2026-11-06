'use client';

import { useState, useRef, useEffect } from 'react';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';
import type { Customer } from '@/types/callbot';

interface CustomerSearchSelectProps {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function customerLabel(customer: Customer, fallbackLabel: string): string {
  const fullName = `${customer?.name || ''} ${customer?.surname || ''}`.trim();
  const fallbackName = customer?.sourceFullName || `${fallbackLabel} #${customer?.id}`;
  const phone = customer?.phone || customer?.mobilePhone || '-';
  return `${fullName || fallbackName} (${phone})`;
}

/**
 * Async, server-searched customer picker — unlike SearchableSelect (which filters a
 * pre-loaded options array client-side, fine for small option sets like distinct column
 * values), the customers table has ~33k rows, so this fetches a small matching page from
 * GET /api/customers?search=... as the user types instead of ever loading the full list.
 */
export default function CustomerSearchSelect({
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
}: CustomerSearchSelectProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Customer[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  // When a customer is selected elsewhere (or cleared), show its label instead of stale query text.
  useEffect(() => {
    setQuery(value ? customerLabel(value, t('customers.customerLabel')) : '');
  }, [value, t]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++requestSeq.current;
    debounceRef.current = setTimeout(async () => {
      const result = await callbotApi.getCustomersPage({ page: 1, pageSize: PAGE_SIZE, search: q });
      if (seq !== requestSeq.current) return; // stale response from an earlier keystroke
      setResults(result.data);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    setHighlightIndex(-1);
  }, [results.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || highlightIndex < 0 || !listRef.current) return;
    const items = listRef.current.children;
    if (highlightIndex < items.length) {
      (items[highlightIndex] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightIndex]);

  const selectCustomer = (customer: Customer) => {
    onChange(customer);
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < results.length) {
          selectCustomer(results[highlightIndex]);
        } else if (results.length > 0) {
          selectCustomer(results[0]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const showEmptyHint = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white pr-8 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        {loading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto bg-slate-700 border border-slate-600 rounded-lg shadow-lg"
        >
          {showEmptyHint && (
            <li className="px-3 py-2 text-gray-400 text-sm">{t('initiateCallForm.searchMinChars')}</li>
          )}
          {!showEmptyHint && !loading && query.trim().length >= MIN_QUERY_LENGTH && results.length === 0 && (
            <li className="px-3 py-2 text-gray-400 text-sm">{t('customers.noCustomersFound')}</li>
          )}
          {results.map((customer, idx) => (
            <li
              key={customer.id}
              onMouseDown={(e) => {
                e.preventDefault();
                selectCustomer(customer);
              }}
              onMouseEnter={() => setHighlightIndex(idx)}
              className={`px-3 py-2 cursor-pointer text-sm text-white ${
                idx === highlightIndex ? 'bg-blue-600 text-[#fff]' : 'hover:bg-slate-600'
              }`}
            >
              {customerLabel(customer, t('customers.customerLabel'))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
