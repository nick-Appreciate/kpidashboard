'use client';

import { useEffect, useRef } from 'react';
import type { Property } from './sampleListings';

interface Props {
  properties: Property[];
  /** Height CSS string (e.g. "400px" or "60vh"). */
  height?: string;
}

/**
 * Interactive Leaflet map showing one marker per property. Uses OSM tiles so
 * no Google Maps API key is needed. Loaded dynamically so Leaflet's window-
 * dependent modules don't break SSR.
 */
export default function PropertyMap({ properties, height = '480px' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!ref.current || properties.length === 0) return;

    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      // Inject Leaflet's own stylesheet once per page. Doing it here keeps the
      // main bundle lean — only pays when the map is actually rendered.
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.setAttribute('data-leaflet', '1');
        document.head.appendChild(link);
      }

      if (cancelled || !ref.current) return;

      // Tear down any previous instance if this component is hot-reloaded
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const bounds = L.latLngBounds(properties.map(p => [p.latitude, p.longitude]));
      const map = L.map(ref.current, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      }).fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      for (const property of properties) {
        const unitCount = property.units.length;
        const rentLabel =
          property.minRent === property.maxRent
            ? `$${property.minRent.toLocaleString()}`
            : `$${property.minRent.toLocaleString()}–$${property.maxRent.toLocaleString()}`;

        // Custom divIcon with the price so markers are readable at a glance
        const icon = L.divIcon({
          className: 'apm-marker',
          html: `<div class="apm-marker-pin">${rentLabel}</div>`,
          iconSize: [0, 0], // CSS handles sizing
        });

        const marker = L.marker([property.latitude, property.longitude], { icon }).addTo(map);
        const firstUnitId = property.units[0].id;
        const photoUrl = property.photos[0] || '';

        const popupHtml = `
          <div class="apm-popup">
            ${photoUrl ? `<img src="${photoUrl}" alt="" class="apm-popup-img" />` : ''}
            <div class="apm-popup-body">
              <p class="apm-popup-addr">${property.address}</p>
              <p class="apm-popup-meta">${property.city}, ${property.state} · ${rentLabel}/mo</p>
              <p class="apm-popup-meta-sub">${unitCount} unit${unitCount > 1 ? 's' : ''} available</p>
              <a href="/preview/listings/${firstUnitId}" class="apm-popup-link">View property →</a>
            </div>
          </div>
        `;
        marker.bindPopup(popupHtml, { maxWidth: 260 });
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [properties]);

  return (
    <>
      <div
        ref={ref}
        style={{ height, width: '100%' }}
        className="rounded-2xl overflow-hidden border border-black/5 bg-[#F1F0EC]"
      />
      <style jsx global>{`
        .apm-marker-pin {
          display: inline-block;
          padding: 4px 10px;
          background: #0a0a0a;
          color: #fff;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
          border: 2px solid #fff;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
          transform: translate(-50%, -50%);
          font-family:
            var(--font-inter),
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            sans-serif;
        }
        .apm-marker-pin:hover {
          background: #06b6d4;
          cursor: pointer;
        }
        .apm-popup {
          width: 240px;
        }
        .apm-popup-img {
          width: 100%;
          height: 130px;
          object-fit: cover;
          border-radius: 8px 8px 0 0;
          display: block;
        }
        .apm-popup-body {
          padding: 10px 12px 12px;
        }
        .apm-popup-addr {
          font-weight: 600;
          color: #0a0a0a;
          font-size: 14px;
          margin: 0 0 2px;
        }
        .apm-popup-meta {
          color: rgba(10, 10, 10, 0.65);
          font-size: 12px;
          margin: 0;
        }
        .apm-popup-meta-sub {
          color: rgba(10, 10, 10, 0.5);
          font-size: 11px;
          margin: 0 0 8px;
        }
        .apm-popup-link {
          color: #06b6d4;
          font-size: 13px;
          font-weight: 500;
          text-decoration: none;
        }
        .apm-popup-link:hover {
          text-decoration: underline;
        }
        .leaflet-popup-content-wrapper {
          padding: 0;
          border-radius: 12px;
          overflow: hidden;
        }
        .leaflet-popup-content {
          margin: 0;
        }
      `}</style>
    </>
  );
}
