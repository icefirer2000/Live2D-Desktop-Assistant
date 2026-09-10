const BASE = { width: 1920, height: 1080 };
function responsiveScale(display) {
  const area = display?.workAreaSize || display?.workArea || BASE;
  // Electron's workArea is already in DIP: do not multiply by scaleFactor again.
  return Math.round(Math.max(.55, Math.min(1.35, area.width / BASE.width, area.height / BASE.height)) * 1000) / 1000;
}
module.exports = { responsiveScale };
