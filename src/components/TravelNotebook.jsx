import { ArrowUpRight, Bookmark, Check, Compass, Trash2 } from 'lucide-react';
import { CHECKLIST } from '../planning.js';
import { prettyDate } from '../utils.js';

export default function TravelNotebook({
  plans,
  onRestore,
  onRemove,
  checklist,
  onToggle,
  persistent,
  loading,
}) {
  const completed = CHECKLIST.filter((item) => checklist[item.id]).length;
  return (
    <aside className="travel-notebook" aria-label="Travel notebook">
      <section id="saved-plans" className="notebook-card">
        <div className="notebook-heading">
          <span className="panel-kicker">YOUR NOTEBOOK</span>
          <Bookmark size={17} />
        </div>
        <h2>A few plans worth keeping.</h2>
        <p className="notebook-description">
          {persistent
            ? 'Trip details saved in this browser. No account needed.'
            : 'Browser storage is unavailable. Plans stay for this visit.'}
        </p>
        {plans.length ? (
          <ul className="saved-plans">
            {plans.map((plan) => (
              <li key={plan.id}>
                <button
                  className="saved-plan"
                  type="button"
                  disabled={loading}
                  onClick={() => onRestore(plan)}
                  aria-label={`Use saved plan for ${plan.destination}`}
                >
                  <span>
                    <strong>{plan.destination}</strong>
                    <small>
                      {prettyDate(plan.startDate)} — {prettyDate(plan.endDate)}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
                <button
                  className="icon-button remove-plan"
                  type="button"
                  onClick={() => onRemove(plan.id)}
                  aria-label={`Remove saved plan for ${plan.destination}`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="notebook-empty">
            <Compass size={30} strokeWidth={1.3} />
            <strong>Your next trip starts here.</strong>
            <span>
              Save a plan below the date fields to return to it later.
            </span>
          </div>
        )}
        <span className="notebook-footnote">
          Saved plans contain trip details, not safety assessments.
        </span>
      </section>
      <section className="checklist-card" aria-labelledby="checklist-title">
        <div className="notebook-heading">
          <span className="panel-kicker">BEFORE YOU SET OFF</span>
          <span className="checklist-count">
            {completed}/{CHECKLIST.length}
          </span>
        </div>
        <h3 id="checklist-title">The little essentials.</h3>
        <div className="packing-checklist">
          {CHECKLIST.map((item) => (
            <label
              key={item.id}
              className={checklist[item.id] ? 'is-checked' : ''}
            >
              <input
                type="checkbox"
                checked={Boolean(checklist[item.id])}
                onChange={() => onToggle(item.id)}
              />
              <span className="check-box" aria-hidden="true">
                {checklist[item.id] && <Check size={12} />}
              </span>
              <span>{item.label}</span>
            </label>
          ))}
        </div>
        <p>
          Personal reminders for this trip. Changing the place or dates resets
          them; checking them does not change the scan.
        </p>
      </section>
    </aside>
  );
}
