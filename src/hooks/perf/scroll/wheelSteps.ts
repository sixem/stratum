// Respond to the first wheel tick, then group high-resolution scroll deltas.
const GESTURE_GAP_MS = 200;

export function createWheelStepper() {
  let lastAt = -Infinity;
  let lastBinding: string | null = null;
  let remainder = 0;

  return (event: WheelEvent, binding: string) => {
    const units = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 3
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 1 : 100;
    const startsGesture = binding !== lastBinding || event.timeStamp - lastAt > GESTURE_GAP_MS;
    lastAt = event.timeStamp;
    lastBinding = binding;
    remainder = (startsGesture ? 0 : remainder) + Math.abs(event.deltaY) / units;

    const steps = Math.floor(remainder);
    if (steps) {
      remainder -= steps;
      return steps;
    }
    if (!startsGesture) return 0;
    remainder = 0;
    return 1;
  };
}
