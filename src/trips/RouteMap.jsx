import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { place } from './api';
export const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL ||
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
export default function RouteMap({ trip, snapshot = trip.latest }) {
  const node = useRef(null),
    [backgroundFailed, setBackgroundFailed] = useState(false);
  useEffect(() => {
    if (!node.current) return;
    setBackgroundFailed(false);
    const map = L.map(node.current, { scrollWheelZoom: false }).setView(
      [23, 79],
      5,
    );
    const tiles = L.tileLayer(TILE_URL, {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution:
        import.meta.env.VITE_MAP_ATTRIBUTION ||
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · © <a href="https://carto.com/attributions">CARTO</a>',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(map);
    let failures = 0;
    tiles.on('tileerror', () => {
      if (++failures >= 2 && map.hasLayer(tiles)) {
        map.removeLayer(tiles);
        setBackgroundFailed(true);
      }
    });
    const bounds = [];
    function marker(location, text, color, sources = []) {
      if (
        !Number.isFinite(location?.latitude) ||
        !Number.isFinite(location?.longitude)
      )
        return;
      const point = [location.latitude, location.longitude];
      bounds.push(point);
      const content = document.createElement('div');
      content.textContent = text;
      sources.forEach((source) => {
        const link = document.createElement('a');
        link.href = source.url;
        link.textContent = source.title || 'Original report';
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.style.display = 'block';
        content.append(link);
      });
      L.circleMarker(point, {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.85,
      })
        .bindPopup(content)
        .addTo(map);
    }
    if (trip.origin)
      marker(trip.origin, `Starting point: ${place(trip.origin)}`, '#28594a');
    trip.stops.forEach((s, i) =>
      marker(
        s.location,
        `Stop ${i + 1}: ${place(s.location)}. ${s.startDate} to ${s.endDate}.`,
        '#28594a',
      ),
    );
    snapshot?.route?.routes?.forEach((r) =>
      L.polyline(
        r.coordinates.map(([x, y]) => [y, x]),
        {
          color:
            r.id === snapshot.route.selectedRouteId ? '#28594a' : '#8d978f',
          weight: r.id === snapshot.route.selectedRouteId ? 5 : 3,
        },
      ).addTo(map),
    );
    snapshot?.reports?.forEach((r) =>
      r.result.issues?.forEach((i) => {
        const c = i.verification?.coordinates;
        if (c)
          marker(
            c,
            `${i.title}. ${i.travelerImpact || i.summary || i.evidence} Dates checked: ${r.startDate} to ${r.endDate}. Last checked: ${snapshot.checkedAt}. Confirm the affected area before leaving.`,
            '#b35435',
            r.result.sources.filter((s) => i.sourceIds?.includes(s.id)),
          );
      }),
    );
    if (bounds.length)
      map.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: trip.stops.length === 1 && !trip.origin ? 13 : 10,
      });
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(node.current);
    return () => {
      resize.disconnect();
      map.remove();
    };
  }, [trip.id, snapshot]);
  return (
    <>
      {backgroundFailed && (
        <p className="notice" role="status">
          The map background could not load. Your stops and available route are
          still shown.{' '}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place(trip.stops[0]?.location))}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Maps
          </a>
        </p>
      )}
      <div
        ref={node}
        className="route-map"
        aria-label="Interactive trip route map"
      />
      <p className="muted">
        Green: your stops. Orange: reported events. Nearby updates without an
        exact location are listed below.
      </p>
      {snapshot?.route?.status === 'unavailable' && (
        <p className="muted">
          Road directions are temporarily unavailable. You can still review
          updates for each stop.
        </p>
      )}
      <details>
        <summary>About this route</summary>
        <p>
          Journey times are estimates and do not include live traffic. Only
          events with a supported location appear as orange markers.
        </p>
        {snapshot?.route?.notes?.map((n) => (
          <p className="muted" key={n}>
            {n}
          </p>
        ))}
      </details>
    </>
  );
}
