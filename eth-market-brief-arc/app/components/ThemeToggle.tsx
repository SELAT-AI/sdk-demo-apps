"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [isDay, setIsDay] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("selat-theme");
    const shouldUseDay = savedTheme === "day";

    setIsDay(shouldUseDay);
    document.body.classList.toggle("day", shouldUseDay);
  }, []);

  function toggleTheme() {
    const nextTheme = !isDay;

    setIsDay(nextTheme);
    document.body.classList.toggle("day", nextTheme);
    window.localStorage.setItem("selat-theme", nextTheme ? "day" : "night");
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={isDay ? "Switch to night mode" : "Switch to day mode"}
      aria-pressed={isDay}
      title={isDay ? "Night mode" : "Day mode"}
      onClick={toggleTheme}
    >
      <span className="theme-icon" aria-hidden="true">
        {isDay ? (
          <svg viewBox="0 0 24 24">
            <path d="M21 13.2A7.4 7.4 0 0 1 10.8 3a8.6 8.6 0 1 0 10.2 10.2Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M12 4V2" />
            <path d="M12 22v-2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        )}
      </span>
    </button>
  );
}
