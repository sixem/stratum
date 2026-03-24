// Transfer execution for copy and move operations.
// The executor walks a manifest built during planning so it never has to
// rediscover reparse-point behavior in the hot copy loop.
use super::common::{
    build_copy_decision_sets, check_transfer_control, emit_transfer_progress, inspect_path,
    path_exists, path_is_same_or_within, remove_path_by_kind, same_drive,
    should_overwrite_copy_destination, should_skip_copy_destination, CopyDecisionSets,
    CopyExecution, TransferEntryKind,
};
use super::manifest::{
    build_copy_destination, build_manifest_root, build_transfer_destination, requested_roots,
    validate_destination, TransferManifestEntry, TransferManifestRoot,
};
#[cfg(target_os = "windows")]
use super::native_windows::copy_file_entry_native;
use crate::domain::filesystem::{
    CopyOptions, CopyReport, TransferControlCallback, TransferMode, TransferOptions,
    TransferProgressCallback, TransferProgressUpdate, TransferReport,
};
use std::fs;
use std::io::ErrorKind;
#[cfg(not(target_os = "windows"))]
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, PartialEq, Eq)]
enum ManifestEntryOutcome {
    Copied,
    Skipped,
}

fn emit_root_completion(
    on_progress: &mut Option<&mut TransferProgressCallback>,
    processed: usize,
    total: usize,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: None,
            current_bytes: None,
            current_total_bytes: None,
            progress_percent: None,
            status_text: None,
            rate_text: None,
        },
    );
}

fn emit_directory_progress(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: Some(entry.source.to_string_lossy().to_string()),
            current_bytes: None,
            current_total_bytes: None,
            progress_percent: None,
            status_text: None,
            rate_text: None,
        },
    );
}

fn emit_file_start(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: Some(entry.source.to_string_lossy().to_string()),
            current_bytes: Some(0),
            current_total_bytes: Some(entry.bytes_total),
            progress_percent: None,
            status_text: None,
            rate_text: None,
        },
    );
}

fn emit_file_bytes(
    processed: usize,
    total: usize,
    current_bytes: u64,
    current_total_bytes: u64,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: None,
            current_bytes: Some(current_bytes),
            current_total_bytes: Some(current_total_bytes),
            progress_percent: None,
            status_text: None,
            rate_text: None,
        },
    );
}

fn existing_entry_kind(path: &Path) -> Result<Option<TransferEntryKind>, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => inspect_path(path).map(|inspection| Some(inspection.kind)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn ensure_parent_directory(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn copy_file_entry_fallback(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    ensure_parent_directory(&entry.destination)?;
    let mut reader = fs::File::open(&entry.source).map_err(|err| err.to_string())?;
    let mut writer = fs::File::create(&entry.destination).map_err(|err| err.to_string())?;
    let mut copied = 0u64;
    let mut buffer = vec![0u8; super::common::COPY_CHUNK_SIZE];

    loop {
        check_transfer_control(on_control)?;
        let bytes = reader.read(&mut buffer).map_err(|err| err.to_string())?;
        if bytes == 0 {
            break;
        }
        writer
            .write_all(&buffer[..bytes])
            .map_err(|err| err.to_string())?;
        copied = copied.saturating_add(bytes as u64);
        emit_file_bytes(processed, total, copied, entry.bytes_total, on_progress);
    }

    if let Ok(metadata) = fs::metadata(&entry.source) {
        let _ = fs::set_permissions(&entry.destination, metadata.permissions());
    }

    Ok(())
}

fn copy_manifest_file_entry(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    check_transfer_control(on_control)?;
    emit_file_start(entry, processed, total, on_progress);

    let copy_result = {
        #[cfg(target_os = "windows")]
        {
            ensure_parent_directory(&entry.destination)?;
            copy_file_entry_native(
                &entry.source,
                &entry.destination,
                entry.kind,
                processed,
                total,
                entry.bytes_total,
                on_progress,
                on_control,
            )
        }

        #[cfg(not(target_os = "windows"))]
        {
            copy_file_entry_fallback(entry, processed, total, on_progress, on_control)
        }
    };

    if let Err(error) = copy_result {
        if path_exists(&entry.destination) {
            let _ = remove_path_by_kind(&entry.destination, entry.kind);
        }
        return Err(error);
    }

    emit_file_bytes(
        processed,
        total,
        entry.bytes_total,
        entry.bytes_total,
        on_progress,
    );
    Ok(())
}

fn create_manifest_directory(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) -> Result<(), String> {
    emit_directory_progress(entry, processed, total, on_progress);
    fs::create_dir_all(&entry.destination).map_err(|err| err.to_string())
}

fn remove_manifest_source(root: &TransferManifestRoot) -> Result<(), String> {
    for entry in root.entries.iter().rev() {
        if !path_exists(&entry.source) {
            continue;
        }
        remove_path_by_kind(&entry.source, entry.kind)?;
    }
    Ok(())
}

fn remove_existing_destination_root(
    destination: &Path,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    let Some(kind) = existing_entry_kind(destination)? else {
        return Ok(());
    };

    if kind == TransferEntryKind::Directory {
        let manifest = build_manifest_root(destination, destination, on_control)?;
        return remove_manifest_source(&manifest);
    }

    remove_path_by_kind(destination, kind)
}

fn execute_copy_manifest_entry_with_decisions(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    decisions: &CopyDecisionSets,
) -> Result<ManifestEntryOutcome, String> {
    check_transfer_control(on_control)?;

    match entry.kind {
        TransferEntryKind::Directory => match existing_entry_kind(&entry.destination)? {
            Some(TransferEntryKind::Directory) => Ok(ManifestEntryOutcome::Copied),
            Some(_) => {
                if should_skip_copy_destination(&entry.destination, decisions) {
                    Ok(ManifestEntryOutcome::Skipped)
                } else if should_overwrite_copy_destination(&entry.destination, decisions) {
                    remove_existing_destination_root(&entry.destination, on_control)?;
                    create_manifest_directory(entry, processed, total, on_progress)?;
                    Ok(ManifestEntryOutcome::Copied)
                } else {
                    Err("destination already exists".to_string())
                }
            }
            None => {
                create_manifest_directory(entry, processed, total, on_progress)?;
                Ok(ManifestEntryOutcome::Copied)
            }
        },
        _ => {
            if existing_entry_kind(&entry.destination)?.is_some() {
                if should_skip_copy_destination(&entry.destination, decisions) {
                    return Ok(ManifestEntryOutcome::Skipped);
                }
                if should_overwrite_copy_destination(&entry.destination, decisions) {
                    remove_existing_destination_root(&entry.destination, on_control)?;
                } else {
                    return Err("destination already exists".to_string());
                }
            }

            copy_manifest_file_entry(entry, processed, total, on_progress, on_control)?;
            Ok(ManifestEntryOutcome::Copied)
        }
    }
}

fn execute_copy_manifest_root(
    root: &TransferManifestRoot,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    decisions: &CopyDecisionSets,
) -> Result<CopyExecution, String> {
    let mut skipped = 0usize;
    let mut skipped_prefixes = Vec::<PathBuf>::new();
    let mut copied_root = true;

    for entry in &root.entries {
        if skipped_prefixes
            .iter()
            .any(|prefix| path_is_same_or_within(&entry.source, prefix))
        {
            continue;
        }

        match execute_copy_manifest_entry_with_decisions(
            entry,
            processed,
            total,
            on_progress,
            on_control,
            decisions,
        )? {
            ManifestEntryOutcome::Copied => {}
            ManifestEntryOutcome::Skipped => {
                skipped = skipped.saturating_add(1);
                if entry.kind.is_traversable_directory() {
                    skipped_prefixes.push(entry.source.clone());
                }
                if entry.source == root.source {
                    copied_root = false;
                }
            }
        }
    }

    Ok(CopyExecution {
        copied_root,
        skipped,
    })
}

fn execute_transfer_manifest_root(
    root: &TransferManifestRoot,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    for entry in &root.entries {
        check_transfer_control(on_control)?;
        match entry.kind {
            TransferEntryKind::Directory => {
                create_manifest_directory(entry, processed, total, on_progress)?;
            }
            _ => {
                copy_manifest_file_entry(entry, processed, total, on_progress, on_control)?;
            }
        }
    }
    Ok(())
}

fn execute_transfer_root(
    root: &TransferManifestRoot,
    overwrite: bool,
    should_move: bool,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<bool, String> {
    check_transfer_control(on_control)?;

    if existing_entry_kind(&root.destination)?.is_some() {
        if !overwrite {
            return Err("destination already exists".to_string());
        }
        remove_existing_destination_root(&root.destination, on_control)?;
    }

    if should_move && same_drive(&root.source, &root.destination) {
        ensure_parent_directory(&root.destination)?;
        if fs::rename(&root.source, &root.destination).is_ok() {
            return Ok(true);
        }
    }

    execute_transfer_manifest_root(root, processed, total, on_progress, on_control)?;
    if should_move {
        check_transfer_control(on_control)?;
        remove_manifest_source(root)?;
        return Ok(true);
    }

    Ok(false)
}

fn build_copy_manifest_for_path(
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

fn build_transfer_manifest_for_path(
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

pub fn copy_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<CopyOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<CopyReport, String> {
    let target_path = validate_destination(&destination)?;
    let decisions = build_copy_decision_sets(options.as_ref());

    let mut report = CopyReport {
        copied: 0,
        skipped: 0,
        failures: Vec::new(),
    };

    let requested = paths
        .into_iter()
        .filter_map(|path| {
            let trimmed = path.trim().to_string();
            if trimmed.is_empty() {
                report.skipped = report.skipped.saturating_add(1);
                None
            } else {
                Some(trimmed)
            }
        })
        .collect::<Vec<_>>();
    let total = requested_roots(&requested);

    for (index, raw_path) in requested.into_iter().enumerate() {
        check_transfer_control(&mut on_control)?;
        let processed = index;
        let completed = index + 1;

        let manifest = match build_copy_manifest_for_path(&raw_path, &target_path, &mut on_control)
        {
            Ok(manifest) => manifest,
            Err(error) => {
                report.failures.push(format!("{}: {}", raw_path, error));
                emit_root_completion(&mut on_progress, completed, total);
                continue;
            }
        };

        match execute_copy_manifest_root(
            &manifest,
            processed,
            total,
            &mut on_progress,
            &mut on_control,
            &decisions,
        ) {
            Ok(outcome) => {
                if outcome.copied_root {
                    report.copied = report.copied.saturating_add(1);
                }
                report.skipped = report.skipped.saturating_add(outcome.skipped);
            }
            Err(error) => report.failures.push(format!("{}: {}", raw_path, error)),
        }

        emit_root_completion(&mut on_progress, completed, total);
    }

    Ok(report)
}

// Transfers entries into a destination folder with optional overwrite.
// Auto mode moves within the same drive and copies across drives.
pub fn transfer_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<TransferOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<TransferReport, String> {
    let target_path = validate_destination(&destination)?;
    let mode = options
        .as_ref()
        .and_then(|value| value.mode)
        .unwrap_or(TransferMode::Auto);
    let overwrite = options
        .as_ref()
        .and_then(|value| value.overwrite)
        .unwrap_or(false);

    let mut report = TransferReport {
        copied: 0,
        moved: 0,
        skipped: 0,
        failures: Vec::new(),
    };

    let requested = paths
        .into_iter()
        .filter_map(|path| {
            let trimmed = path.trim().to_string();
            if trimmed.is_empty() {
                report.skipped = report.skipped.saturating_add(1);
                None
            } else {
                Some(trimmed)
            }
        })
        .collect::<Vec<_>>();
    let total = requested_roots(&requested);

    for (index, raw_path) in requested.into_iter().enumerate() {
        check_transfer_control(&mut on_control)?;
        let processed = index;
        let completed = index + 1;

        let manifest =
            match build_transfer_manifest_for_path(&raw_path, &target_path, &mut on_control) {
                Ok(manifest) => manifest,
                Err(error) => {
                    report.failures.push(format!("{}: {}", raw_path, error));
                    emit_root_completion(&mut on_progress, completed, total);
                    continue;
                }
            };

        let should_move = match mode {
            TransferMode::Copy => false,
            TransferMode::Move => true,
            TransferMode::Auto => same_drive(&manifest.source, &target_path),
        };

        match execute_transfer_root(
            &manifest,
            overwrite,
            should_move,
            processed,
            total,
            &mut on_progress,
            &mut on_control,
        ) {
            Ok(true) => report.moved = report.moved.saturating_add(1),
            Ok(false) => report.copied = report.copied.saturating_add(1),
            Err(error) => report.failures.push(format!("{}: {}", raw_path, error)),
        }

        emit_root_completion(&mut on_progress, completed, total);
    }

    Ok(report)
}
