import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { place } from './api';
export default function RouteMap({ trip, snapshot = trip.latest }) {
  const node = useRef(null);
  useEffect(() => {
    if (!node.current) return;
    const map = L.map(node.current, { scrollWheelZoom: false }).setView(
      [23, 79],
      5,
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
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
        link.textContent = source.title || 'Original source';
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
      marker(trip.origin, `Origin: ${place(trip.origin)}`, '#28594a');
    trip.stops.forEach((s, i) =>
      marker(
        s.location,
        `Stop ${i + 1}: ${place(s.location)} · ${s.startDate} to ${s.endDate}. This marks the destination, not an incident.`,
        '#28594a',
      ),
    );
    const route = snapshot?.route;
    route?.routes?.forEach((r) => {
      const selected = r.id === route.selectedRouteId;
      L.polyline(
        r.coordinates.map(([x, y]) => [y, x]),
        {
          color: selected ? '#28594a' : '#8d978f',
          weight: selected ? 5 : 3,
          dashArray: selected ? undefined : '6 8',
        },
      ).addTo(map);
    });
    snapshot?.reports?.forEach((r) =>
      r.result.issues?.forEach((i) => {
        const c = i.verification?.coordinates;
        if (c)
          marker(
            c,
            `${i.title} · ${r.startDate} to ${r.endDate}. ${i.evidence} Last checked: ${r.result.checkedAt || snapshot.checkedAt}. ${c.basis || 'Source-supported location'}. Verify the affected stretch before departure.`,
            '#b35435',
            r.result.sources.filter((s) => i.sourceIds?.includes(s.id)),
          );
      }),
    );
    if (bounds.length)
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(node.current);
    return () => {
      resize.disconnect();
      map.remove();
    };
  }, [trip.id, snapshot]);
  return (
    <>
      <div
        ref={node}
        className="route-map"
        aria-label="Interactive trip route map"
      />
      <p className="muted">
        Green markers: itinerary stops. Terracotta markers: source-supported
        event locations. Broader regional reports appear below. Forecasts apply
        around the checked location.
      </p>
      {snapshot?.route?.notes?.map((n) => (
        <p className="muted" key={n}>
          {n}
        </p>
      ))}
    </>
  );
}
