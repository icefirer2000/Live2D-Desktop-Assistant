function clampBounds(bounds, area) {
  const width = Math.min(Math.max(1, Math.round(bounds.width)), area.width);
  const height = Math.min(Math.max(1, Math.round(bounds.height)), area.height);
  return { width, height, x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, bounds.x))), y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, bounds.y))) };
}
function bubbleBounds(anchor, size, offset, area, scale = 1) {
  return clampBounds({ width: size.width * scale, height: size.height * scale,
    x: anchor.x - size.width * scale / 2 + offset.x * scale,
    y: anchor.y - size.height * scale - 12 * scale + offset.y * scale }, area);
}
module.exports = { clampBounds, bubbleBounds };
