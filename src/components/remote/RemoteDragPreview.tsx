// Follow an in-app SFTP drag with an item preview and the current drop action.
import { createPortal } from "react-dom";
import { FileTypeIcon } from "@/components/icons/fileIcons";
import { getExtension, getFileKind } from "@/lib/fileKind";
import { useRemoteDrag } from "@/modules/remoteDrag";
import "./remoteDragPreview.scss";

export function RemoteDragPreview() {
  const preview = useRemoteDrag((state) => state.preview);
  if (!preview) return null;
  const nearRight = preview.x + 260 > window.innerWidth;
  const nearBottom = preview.y + 75 > window.innerHeight;
  return createPortal(
    <div className="remote-drag-preview" aria-hidden="true" style={{
      left: preview.x + (nearRight ? -12 : 16),
      top: preview.y + (nearBottom ? -12 : 16),
      transform: `translate(${nearRight ? "-100%" : "0"}, ${nearBottom ? "-100%" : "0"})`,
    }}>
      <FileTypeIcon isDir={preview.isDir} fileKind={getFileKind(preview.name)} extension={getExtension(preview.name)} />
      <span className="remote-drag-preview-content">
        <span className="remote-drag-preview-name">{preview.count === 1 ? preview.name : `${preview.count} items`}</span>
        <span className="remote-drag-preview-action" data-action={preview.action}>
          {preview.action === "copy" ? "+ Copy" : preview.action === "move" ? "Move" : "Can't drop here"}
        </span>
      </span>
    </div>,
    document.body,
  );
}
