/** Haversine distance in km between two lat/lng points (degrees). */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Approximate centroids for demo suburbs (synthetic addresses are "<no> <suburb>"). */
export const SUBURB_COORDS: Record<string, [number, number]> = {
  sandton: [-26.1076, 28.0567], randburg: [-26.0936, 27.9975], soweto: [-26.2678, 27.8585], alexandra: [-26.1036, 28.0975], roodepoort: [-26.1625, 27.8725], midrand: [-25.9992, 28.1263], fourways: [-26.0166, 28.0082], diepsloot: [-25.9333, 27.9833],
  umhlanga: [-29.7278, 31.0855], 'durban north': [-29.7833, 31.0333], phoenix: [-29.7, 31.0167], chatsworth: [-29.9167, 30.8833], ballito: [-29.5389, 31.2144], pinetown: [-29.8167, 30.85], kwamashu: [-29.75, 30.9833], verulam: [-29.65, 31.05],
};

export function coordsFromAddress(address: string | null | undefined): [number, number] | null {
  if (!address) return null;
  const a = address.toLowerCase();
  for (const [k, v] of Object.entries(SUBURB_COORDS)) if (a.includes(k)) return v;
  return null;
}

/** Travel estimate: urban average 32 km/h plus 6 minutes to park. */
export function travelMinutes(km: number): number {
  return Math.round((km / 32) * 60 + 6);
}
