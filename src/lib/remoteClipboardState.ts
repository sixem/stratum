// A copied remote selection is valid only while Windows still holds that write.
export function isRemoteClipboardCurrent(savedSequence: number, currentSequence: number) {
  return savedSequence !== 0 && currentSequence !== 0 && savedSequence === currentSequence;
}
