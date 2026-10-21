import { CalendarDays } from 'lucide-react';

export default function DateField({ label, value, min, onChange, disabled }) {
  return (
    <div className="date-field">
      <CalendarDays size={16} />
      <div>
        <span>{label}</span>
        <input
          disabled={disabled}
          aria-label={
            label === 'FROM' ? 'Travel start date' : 'Travel end date'
          }
          type="date"
          min={min}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        />
      </div>
    </div>
  );
}
