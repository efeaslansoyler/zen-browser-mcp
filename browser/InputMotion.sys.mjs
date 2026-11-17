// Reproducible opt-in pacing. These change real input events, not only the visual cursor.
export function seededRandom(seed = 1) {
  let value = Number(seed) >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}
export function mousePath(from, to, { movement = "instant", duration_ms, steps, seed = 1 } = {}) {
  if (!["instant", "smooth", "human"].includes(movement)) throw new Error("Invalid movement mode.");
  if (movement === "instant") return [{ x: to[0], y: to[1], delay: 0 }];
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const duration = duration_ms ?? Math.min(900, Math.max(160, distance * 1.1));
  if (!Number.isFinite(duration) || duration < 0 || duration > 5000) throw new Error("duration_ms must be 0..5000.");
  const count = steps ?? Math.max(2, Math.ceil(duration / 16));
  if (!Number.isInteger(count) || count < 1 || count > 300) throw new Error("steps must be 1..300.");
  const random = seededRandom(seed);
  const bend = movement === "human" ? (random() - 0.5) * Math.min(120, distance * 0.4) : 0;
  const normal = distance ? [-(to[1] - from[1]) / distance, (to[0] - from[0]) / distance] : [0, 0];
  const points = [];
  for (let i = 1; i <= count; i++) {
    const t = i / count,
      eased = t * t * (3 - 2 * t),
      curve = Math.sin(Math.PI * eased) * bend;
    points.push({
      x: from[0] + (to[0] - from[0]) * eased + normal[0] * curve,
      y: from[1] + (to[1] - from[1]) * eased + normal[1] * curve,
      delay: Math.round((duration * i) / count) - Math.round((duration * (i - 1)) / count),
    });
  }
  points[points.length - 1].x = to[0];
  points[points.length - 1].y = to[1];
  return points;
}
export function typingPlan(text, { typing = "instant", delay_ms = 65, seed = 1 } = {}) {
  if (!["instant", "human"].includes(typing)) throw new Error("Invalid typing mode.");
  if (!Number.isFinite(delay_ms) || delay_ms < 0 || delay_ms > 1000) throw new Error("delay_ms must be 0..1000.");
  if (typing === "instant") return (text.match(/[^\n]{1,16}|\n/gu) || []).map((text) => ({ text, delay: 0 }));
  const random = seededRandom(seed);
  return [...text].map((text) => ({
    text,
    delay: Math.round(delay_ms * (0.65 + random() * 0.7) + (/\s|[,.!?;]/u.test(text) ? random() * delay_ms * 2 : 0)),
  }));
}
