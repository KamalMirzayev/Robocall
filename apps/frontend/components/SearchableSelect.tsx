'use client';

import { useState, useRef, useEffect, useMemo } from 'react';

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  loading = false,
  placeholder = '',
  disabled = false,
  className = '',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Sync search with external value changes (e.g. when user picks from dropdown)
  useEffect(() => {
    setSearch(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, search]);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIndex(-1);
  }, [filtered.length]);

  // Close on click outside
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

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightIndex < 0 || !listRef.current) return;
    const items = listRef.current.children;
    if (highlightIndex < items.length) {
      (items[highlightIndex] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightIndex]);

  const selectOption = (opt: string) => {
    onChange(opt);
    setSearch(opt);
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
        return;
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < filtered.length) {
          selectOption(filtered[highlightIndex]);
        } else if (filtered.length > 0) {
          selectOption(filtered[0]);
        } else {
          // Allow free-text value if nothing matches
          onChange(search);
          setOpen(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={search}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
            setHighlightIndex(-1);
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white pr-8 disabled:opacity-50"
        />
        {loading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
        {!loading && (
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setOpen((prev) => !prev);
                inputRef.current?.focus();
              }
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto bg-slate-700 border border-slate-600 rounded shadow-lg"
        >
          {loading && filtered.length === 0 && (
            <li className="px-3 py-2 text-gray-400 text-sm">{placeholder ? 'Loading...' : 'Loading...'}</li>
          )}
          {!loading && filtered.length === 0 && (
            <li className="px-3 py-2 text-gray-400 text-sm">No results</li>
          )}
          {filtered.map((opt, idx) => (
            <li
              key={opt}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur before click
                selectOption(opt);
              }}
              onMouseEnter={() => setHighlightIndex(idx)}
              className={`px-3 py-2 cursor-pointer text-sm text-white ${
                idx === highlightIndex
                  ? 'bg-blue-600 text-[#fff]'
                  : 'hover:bg-slate-600'
              }`}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
