"use client";

import { useState } from "react";

// Password field with a show/hide toggle, styled by app/login/login.css.
export function PasswordInput({
  id,
  name,
  placeholder,
  autoComplete,
  value,
  onChange,
  autoFocus = false,
}: {
  id: string;
  name: string;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="bp-password">
      <input
        className="bp-input bp-password__input"
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="bp-password__toggle"
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <svg
            className="bp-eye bp-eye--hide"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2M6.6 6.7C4 8.4 2.3 11 1.5 12c0 0 4 7.5 10.5 7.5 2 0 3.7-.5 5.1-1.3M17.5 17.4c2.4-1.7 4-4.4 5-5.4 0 0-1.6-3-4.9-5.3M12 4.5c.6 0 1.2.05 1.8.15"></path>
          </svg>
        ) : (
          <svg
            className="bp-eye bp-eye--show"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1.5 12s4-7.5 10.5-7.5S22.5 12 22.5 12s-4 7.5-10.5 7.5S1.5 12 1.5 12Z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        )}
      </button>
    </span>
  );
}
