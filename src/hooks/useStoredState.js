import { useEffect, useState } from 'react';

export default function useStoredState(key, fallback, validate) {
  const [value, setValue] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(key));
      return validate(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  const [persistent, setPersistent] = useState(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      setPersistent(true);
    } catch {
      setPersistent(false);
    }
  }, [key, value]);
  return [value, setValue, persistent];
}
