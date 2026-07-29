import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/*
 * A themed dropdown.
 *
 * A native <select> can be styled shut but not open: the popup list is drawn by
 * the operating system, so it arrives as a white system menu in the middle of a
 * dark gold panel and no CSS reaches it. `option { background }` works on some
 * platforms and is ignored on others, which is worse than not trying. This is a
 * listbox instead, so the open state matches the rest of the panel everywhere.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary line, e.g. what an aspect ratio is good for. */
  hint?: string;
}

export function Select({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const close = useCallback(() => setOpen(false), []);

  // Open upward when the menu would fall off the bottom of the sidebar.
  const openMenu = useCallback(() => {
    const rect = wrap.current?.getBoundingClientRect();
    if (rect) setFlip(window.innerHeight - rect.bottom < 240 && rect.top > 240);
    setActive(selectedIndex);
    setOpen(true);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    // Capture, so a click on another control closes this first.
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);

  const commit = (index: number) => {
    const opt = options[index];
    if (opt) onChange(opt.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
    }
  };

  return (
    <div className="sel" ref={wrap}>
      <button
        type="button"
        className={`sel-trigger ${open ? "sel-trigger-open" : ""}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="sel-value">{selected?.label}</span>
        <ChevronDown className={`sel-chevron size-3.5 ${open ? "sel-chevron-open" : ""}`} />
      </button>

      {open && (
        <ul
          className={`sel-menu studio-scroll ${flip ? "sel-menu-up" : ""}`}
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {options.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`sel-option ${i === active ? "sel-option-active" : ""}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => commit(i)}
              >
                <span className="sel-option-text">
                  <span className="sel-option-label">{o.label}</span>
                  {o.hint && <span className="sel-option-hint">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
