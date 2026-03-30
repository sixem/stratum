// Manifest root builders for copy and transfer entrypoints.
// These helpers normalize raw CLI/UI paths into validated execution units
// before the hot copy loop starts mutating the filesystem.
use super::super::common::path_is_same_or_within;
use super::super::manifest::{
    build_copy_destination, build_manifest_root, build_transfer_destination, TransferManifestRoot,
};
use crate::domain::filesystem::TransferControlCallback;
use std::path::{Path, PathBuf};

pub(super) fn build_copy_manifest_for_path(
    raw_path: &str,
    target_path: &Path,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<TransferManifestRoot, String> {
    let source = PathBuf::from(raw_path);
    let destination = build_copy_destination(&source, target_path)
        .ok_or_else(|| "Unable to resolve source name".to_string())?;
    let manifest = build_manifest_root(&source, &destination, on_control)?;
    if manifest.kind.is_traversable_directory()
        && path_is_same_or_within(&manifest.destination, &manifest.source)
    {
        return Err("destination is inside source".to_string());
    }
    Ok(manifest)
}

pub(super) fn build_transfer_manifest_for_path(
    raw_path: &str,
    target_path: &Path,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<TransferManifestRoot, String> {
    let source = PathBuf::from(raw_path);
    let destination = build_transfer_destination(&source, target_path)
        .ok_or_else(|| "Unable to resolve source name".to_string())?;
    let manifest = build_manifest_root(&source, &destination, on_control)?;
    if manifest.kind.is_traversable_directory()
        && path_is_same_or_within(&manifest.destination, &manifest.source)
    {
        return Err("destination is inside source".to_string());
    }
    Ok(manifest)
}
