'use client';

import { useEffect, useRef } from 'react';
import type { Property } from '../../lib/listings';
import { getDictionary, getListingPath, type Locale } from '../../lib/i18n';

/** Great-circle distance in miles between two lat/lng pairs. */
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // earth radius, miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Best-effort browser geolocation. Resolves to null on denial, timeout, or unsupported. */
function getUserLocation(): Promise<[number, number] | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve([pos.coords.latitude, pos.coords.longitude]),
      () => resolve(null),
      { timeout: 5000, maximumAge: 300_000, enableHighAccuracy: false },
    );
  });
}

interface Props {
  properties: Property[];
  locale: Locale;
  /** Height CSS string (e.g. "400px" or "60vh"). */
  height?: string;
}

/**
 * Interactive Leaflet map showing one marker per property. Uses OSM tiles so
 * no Google Maps API key is needed. Loaded dynamically so Leaflet's window-
 * dependent modules don't break SSR.
 */
export default function PropertyMap({ properties, locale, height = '480px' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!ref.current || properties.length === 0) return;
    const t = getDictionary(locale).map;

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

      // Best-effort geolocation — if the browser shares the user's position
      // we zoom to the nearby subset of properties instead of the full portfolio.
      // Denied / unsupported / timeout → quietly fall back to the full fit.
      const userLoc = await getUserLocation();

      if (cancelled || !ref.current) return;

      // Tear down any previous instance if this component is hot-reloaded
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const NEARBY_RADIUS_MILES = 150;
      const nearbyProps = userLoc
        ? properties.filter(
            p => haversineMiles(userLoc[0], userLoc[1], p.latitude, p.longitude) <= NEARBY_RADIUS_MILES,
          )
        : [];

      const focusProps = nearbyProps.length > 0 ? nearbyProps : properties;
      const bounds = L.latLngBounds(focusProps.map(p => [p.latitude, p.longitude]));
      if (userLoc && nearbyProps.length > 0) {
        bounds.extend([userLoc[0], userLoc[1]]);
      }

      const map = L.map(ref.current, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      }).fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      mapRef.current = map;

      // Small "you are here" dot so users see why the zoom landed where it did.
      if (userLoc && nearbyProps.length > 0) {
        const youIcon = L.divIcon({
          className: 'apm-you-are-here',
          html: '<span class="apm-you-dot"><span class="apm-you-pulse"></span></span>',
          iconSize: [0, 0],
        });
        L.marker([userLoc[0], userLoc[1]], { icon: youIcon, interactive: false }).addTo(map);
      }

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
              <p class="apm-popup-meta">${property.city}, ${property.state} · ${rentLabel}${t.perMonth}</p>
              <p class="apm-popup-meta-sub">${t.popupUnit(unitCount)}</p>
              <a href="${getListingPath(locale, firstUnitId)}" class="apm-popup-link">${t.popupViewProperty}</a>
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
  }, [properties, locale]);

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
        .apm-you-dot {
          position: absolute;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #06b6d4;
          border: 3px solid #fff;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.5);
        }
        .apm-you-pulse {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: rgba(6, 182, 212, 0.4);
          transform: translate(-50%, -50%);
          animation: apm-you-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        @keyframes apm-you-ping {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0.6;
          }
          80%,
          100% {
            transform: translate(-50%, -50%) scale(2.8);
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}
