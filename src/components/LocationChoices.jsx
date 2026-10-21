import { MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';

export default function LocationChoices({
  locations,
  selected,
  onSelect,
  disabled,
}) {
  const choicesRef = useRef(null);
  useEffect(() => {
    choicesRef.current?.querySelector('input')?.focus();
  }, [locations]);
  if (!locations.length) return null;
  return (
    <fieldset ref={choicesRef} className="location-choices" disabled={disabled}>
      <legend>Confirm your destination</legend>
      <p>
        Choose the city and state you mean. Search results and weather will use
        this location.
      </p>
      {locations.map((place) => (
        <label
          className={`location-choice ${selected?.id === place.id ? 'is-selected' : ''}`}
          key={place.id}
        >
          <input
            type="radio"
            name="confirmed-location"
            value={place.id}
            checked={selected?.id === place.id}
            onChange={() => onSelect(place)}
          />
          <MapPin size={16} aria-hidden="true" />
          <span>{place.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
