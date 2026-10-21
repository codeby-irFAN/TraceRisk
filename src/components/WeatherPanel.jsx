import { CloudRain, ExternalLink, Info } from 'lucide-react';

export default function WeatherPanel({ weather }) {
  const forecast = Array.isArray(weather.dailyForecast)
    ? weather.dailyForecast
    : [];
  const riverFlow = Array.isArray(weather.riverFlow) ? weather.riverFlow : [];
  const locationLabel = weather.location
    ? [weather.location.name, weather.location.admin1, weather.location.country]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(', ')
    : 'Location not resolved';
  return (
    <section className="weather-panel result-reveal">
      <div className="weather-panel-head">
        <div className="weather-icon">
          <CloudRain size={22} />
        </div>
        <div className="weather-title">
          <span className="panel-kicker">WEATHER & NATURAL HAZARDS</span>
          <h3>Forecast for your travel window</h3>
          <p>{locationLabel}</p>
        </div>
        <a
          href="https://open-meteo.com/en/docs"
          target="_blank"
          rel="noreferrer"
          className="weather-attribution"
        >
          Open-Meteo <ExternalLink size={12} />
        </a>
      </div>
      <div className="weather-status-row">
        <span>
          Forecast <strong>{weather.forecastStatus || 'unknown'}</strong>
        </span>
        <span>
          Flood model <strong>{weather.floodStatus || 'unknown'}</strong>
        </span>
        <span>
          Potential signals <strong>{weather.weatherSignals ?? 0}</strong>
        </span>
        <span>
          Trip days with forecast{' '}
          <strong>{weather.forecastDaysMatched ?? 0}</strong>
        </span>
      </div>
      {weather.forecastWindow && (
        <p className="weather-window-note">
          Forecast window: {weather.forecastWindow.start} –{' '}
          {weather.forecastWindow.end}. Values are model output, not official
          alerts.
        </p>
      )}
      <div className="weather-subheading">DAILY FORECAST</div>
      {forecast.length ? (
        <div className="weather-daily-grid">
          {forecast.map((day) => (
            <article className="weather-day-card" key={day.date}>
              <div className="weather-day-date">
                {new Date(`${day.date}T12:00:00`).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </div>
              <div className="weather-day-condition">
                {day.condition || 'Conditions unavailable'}
              </div>
              <div className="weather-day-temperatures">
                <strong>{day.maxC == null ? '—' : `${day.maxC}°`}</strong>
                <span>Low {day.minC == null ? '—' : `${day.minC}°`} C</span>
              </div>
              <div className="weather-day-metrics">
                <Metric
                  label="Rain"
                  value={
                    day.precipitationMm == null
                      ? '—'
                      : `${day.precipitationMm} mm`
                  }
                />
                <Metric
                  label="Rain chance"
                  value={
                    day.precipitationProbabilityPct == null
                      ? '—'
                      : `${day.precipitationProbabilityPct}%`
                  }
                />
                <Metric
                  label="Max wind"
                  value={
                    day.maxWindKmh == null ? '—' : `${day.maxWindKmh} km/h`
                  }
                />
                <Metric
                  label="Gusts"
                  value={
                    day.maxGustKmh == null ? '—' : `${day.maxGustKmh} km/h`
                  }
                />
                <Metric
                  label="Snow"
                  value={day.snowfallCm == null ? '—' : `${day.snowfallCm} cm`}
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="weather-empty-note">
          {weather.forecastStatus === 'outside_forecast_window'
            ? 'The selected travel dates are outside the standard daily forecast horizon.'
            : weather.forecastStatus === 'unavailable'
              ? 'Daily forecast data could not be retrieved.'
              : 'No daily forecast records matched these dates.'}
        </p>
      )}
      {riverFlow.length > 0 && (
        <>
          <div className="weather-subheading">MODELLED RIVER DISCHARGE</div>
          <div className="river-flow-grid">
            {riverFlow.map((day) => {
              const value = day.discharge ?? day.mean ?? day.max;
              return (
                <div className="river-flow-item" key={day.date}>
                  <span>{day.date}</span>
                  <strong>
                    {value == null ? '—' : `${Number(value).toFixed(1)} m³/s`}
                  </strong>
                </div>
              );
            })}
          </div>
          <p className="weather-empty-note">
            Nearest-grid river discharge is an early model signal, not an
            official flood warning and may not represent the exact route or
            local river.
          </p>
        </>
      )}
      {weather.warnings?.length > 0 && (
        <div className="weather-warning-list">
          {weather.warnings.map((warning, index) => (
            <p key={`${index}-${warning}`}>
              <Info size={13} /> {warning}
            </p>
          ))}
        </div>
      )}
      <p className="weather-footnote">
        Forecast signals are model-derived, not official meteorological
        warnings. Check current IMD alerts before travel. Weather data by{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{' '}
        under CC BY 4.0.
      </p>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
