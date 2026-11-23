/**
 * How much of the map a screen shows: how many map units tall the view is on a screen W × H (CSS
 * pixels). Close on a phone, so the sprouts read; further out on a laptop or a TV, to see the way ahead.
 */
export function viewUnits(W: number, H: number) {
  let u = Math.min(580, Math.max(400, H * 0.9));
  // a narrow screen still sees a stop either side
  if ((W / H) * u < 460) u = (460 * H) / W;
  return u;
}
