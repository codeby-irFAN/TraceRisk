import { useEffect, useRef, useState } from 'react';
import { api, place } from './api';
const today = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
const empty = () => ({ query: '', startDate: today(), endDate: today() });
function Place({ value, onChange, label }) {
  const [options, setOptions] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  async function find() {
    if (value.query.trim().length < 2) return;
    const current = ++request.current;
    setBusy(true);
    setError('');
    try {
      const data = await api(
        `/locations?destination=${encodeURIComponent(value.query)}`,
      );
      if (current !== request.current) return;
      setOptions(data.locations || []);
      if (!data.locations?.length)
        setError(
          'Try the landmark name and city, for example Hawa Mahal, Jaipur.',
        );
    } catch (e) {
      if (current === request.current) setError(e.message);
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  return (
    <div className="place-field">
      <label>
        {label}
        <div className="inline">
          <input
            aria-label={label}
            required
            value={value.query}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !value.locationId && !value.savedId) {
                e.preventDefault();
                find();
              }
            }}
            onChange={(e) => {
              request.current += 1;
              setBusy(false);
              setError('');
              onChange({
                ...value,
                query: e.target.value,
                locationId: null,
                savedId: null,
              });
              setOptions([]);
            }}
            placeholder="City or landmark, e.g. Hawa Mahal, Jaipur"
          />
          <button
            type="button"
            onClick={find}
            disabled={busy || value.query.length < 2}
          >
            {busy ? 'Finding…' : 'Find place'}
          </button>
        </div>
      </label>
      {!value.locationId && !value.savedId && (
        <small className="muted">
          Type a place, choose Find place, then select a match below.
        </small>
      )}
      {(value.locationId || value.savedId) && (
        <small className="confirmed">
          ✓ {value.confirmedLabel || 'Place confirmed'}
        </small>
      )}
      {options.length > 0 && (
        <div className="place-options">
          {options.map((o) => (
            <button
              type="button"
              key={o.id}
              onClick={() => {
                onChange({
                  ...value,
                  query: value.query,
                  locationId: o.id,
                  confirmedLabel: place(o),
                });
                setOptions([]);
              }}
            >
              {place(o)} · {o.country || 'India'}
            </button>
          ))}
        </div>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
export default function TripComposer({ initial, onSave, onClose, monitoring }) {
  const [draft, setDraft] = useState(
    initial
      ? {
          ...initial,
          origin: initial.origin
            ? {
                query: initial.originQuery,
                savedId: initial.originId,
                confirmedLabel: place(initial.origin),
              }
            : null,
          stops: initial.stops.map((s) => ({
            ...s,
            savedId: s.id,
            confirmedLabel: place(s.location),
          })),
        }
      : {
          title: '',
          client: '',
          origin: null,
          stops: [empty()],
          preferences: {
            mode: 'car',
            children: false,
            limitedMobility: false,
            respiratory: false,
          },
          watch: { enabled: true, frequencyHours: 6, alertLevel: 'all' },
        },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const dialog = useRef(null);
  const saving = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current.querySelector('input')?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape' && !saving.current) close.current();
      if (event.key !== 'Tab') return;
      const controls = [
        ...dialog.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const change = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const stop = (i, value) =>
    change(
      'stops',
      draft.stops.map((s, j) => (i === j ? value : s)),
    );
  async function submit(e) {
    e.preventDefault();
    setError('');
    const unconfirmed =
      draft.origin && !draft.origin.locationId && !draft.origin.savedId
        ? 'Starting from'
        : draft.stops.findIndex((s) => !s.locationId && !s.savedId);
    if (unconfirmed === 'Starting from' || unconfirmed >= 0) {
      setError(
        `Confirm ${unconfirmed === 'Starting from' ? 'your starting place' : `the destination for stop ${unconfirmed + 1}`}: choose Find place, then select a match.`,
      );
      return;
    }
    for (let i = 0; i < draft.stops.length; i++) {
      const s = draft.stops[i];
      if (
        s.endDate < s.startDate ||
        (i && s.startDate < draft.stops[i - 1].endDate)
      ) {
        setError(
          `Check stop ${i + 1}: dates must follow the previous stop and departure cannot be before arrival.`,
        );
        return;
      }
    }
    saving.current = true;
    setBusy(true);
    try {
      await onSave(draft);
    } catch (e) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="trip-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Plan a trip"
      >
        <div className="section-head">
          <div>
            <p className="eyebrow">YOUR NEXT JOURNEY</p>
            <h2>{initial ? 'Edit itinerary' : 'Plan a trip'}</h2>
          </div>
          <button
            disabled={busy}
            onClick={onClose}
            aria-label="Close trip form"
          >
            ✕
          </button>
        </div>
        <form onSubmit={submit}>
          <p className="muted">
            Add a city or landmark and your dates. Save your trip, then choose a
            quick or thorough check.
          </p>
          <div className="two-col">
            <label>
              Trip name
              <input
                value={draft.title}
                onChange={(e) => change('title', e.target.value)}
                placeholder="A week in the mountains"
                maxLength={80}
              />
            </label>
            <label>
              Client / group (optional)
              <input
                value={draft.client}
                onChange={(e) => change('client', e.target.value)}
                maxLength={80}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(draft.origin)}
              onChange={(e) =>
                change('origin', e.target.checked ? { query: '' } : null)
              }
            />
            Include an origin for route checks
          </label>
          {draft.origin && (
            <Place
              label="Starting from"
              value={draft.origin}
              onChange={(v) => change('origin', v)}
            />
          )}
          {draft.stops.map((s, i) => (
            <div className="stop-editor" key={i}>
              <div className="section-head">
                <strong>Stop {i + 1}</strong>
                {draft.stops.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      change(
                        'stops',
                        draft.stops.filter((_, j) => i !== j),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
              <Place
                label="Destination"
                value={s}
                onChange={(v) => stop(i, v)}
              />
              <div className="two-col">
                <label>
                  Arrival
                  <input
                    required
                    type="date"
                    value={s.startDate}
                    onChange={(e) =>
                      stop(i, {
                        ...s,
                        startDate: e.target.value,
                        endDate:
                          s.endDate < e.target.value
                            ? e.target.value
                            : s.endDate,
                      })
                    }
                  />
                </label>
                <label>
                  Departure
                  <input
                    required
                    type="date"
                    min={s.startDate}
                    value={s.endDate}
                    onChange={(e) => stop(i, { ...s, endDate: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
          {draft.stops.length < 6 && (
            <button
              type="button"
              onClick={() =>
                change('stops', [
                  ...draft.stops,
                  {
                    ...empty(),
                    startDate: draft.stops.at(-1).endDate,
                    endDate: draft.stops.at(-1).endDate,
                  },
                ])
              }
            >
              ＋ Add another stop
            </button>
          )}
          <div className="two-col">
            <label>
              Travel mode
              <select
                value={draft.preferences.mode}
                onChange={(e) =>
                  change('preferences', {
                    ...draft.preferences,
                    mode: e.target.value,
                  })
                }
              >
                {['car', 'bus', 'motorcycle', 'train', 'flight'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            {monitoring && (
              <label>
                Watch frequency
                <select
                  value={draft.watch.frequencyHours}
                  onChange={(e) =>
                    change('watch', {
                      ...draft.watch,
                      frequencyHours: Number(e.target.value),
                    })
                  }
                >
                  {[1, 3, 6, 12, 24].map((h) => (
                    <option key={h} value={h}>
                      Every {h} hours
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <details>
            <summary>Traveller needs (optional)</summary>
            <fieldset>
              <legend>Make the advice relevant to you</legend>
              {[
                ['children', 'Travelling with children'],
                ['limitedMobility', 'Limited mobility'],
                ['respiratory', 'Sensitive to air quality'],
              ].map(([k, l]) => (
                <label className="check" key={k}>
                  <input
                    type="checkbox"
                    checked={draft.preferences[k]}
                    onChange={(e) =>
                      change('preferences', {
                        ...draft.preferences,
                        [k]: e.target.checked,
                      })
                    }
                  />
                  {l}
                </label>
              ))}
            </fieldset>
          </details>
          {monitoring && (
            <label className="check">
              <input
                type="checkbox"
                checked={draft.watch.enabled}
                onChange={(e) =>
                  change('watch', { ...draft.watch, enabled: e.target.checked })
                }
              />
              Watch this trip for changes
            </label>
          )}
          <p className="muted">
            {monitoring
              ? 'Alerts appear in your workspace. Checks run while the server is available, until your trip ends. You can also check manually at any time.'
              : 'Your itinerary will be saved to your account. Automatic checks are unavailable; you can check manually whenever you need an update.'}
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="inline form-actions">
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save itinerary'}
            </button>
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
