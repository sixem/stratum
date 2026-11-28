// No path, drop attributes, or entry handlers are attached to a retained slot.
export function PendingRemoval({ name, grid }: { name: string; grid?: boolean }) {
  return <div className={grid ? "thumb-card" : "row"} data-pending-removal="true" data-selectable="false" aria-disabled="true">
    <span>{name}</span><small>Pending removal</small>
  </div>;
}
