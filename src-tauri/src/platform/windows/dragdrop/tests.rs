// Exercise the native drop path using the temporary file list an archive app provides.
use super::{extract_hdrop_paths, staging::prepare_hdrop_paths, DropStage, StageSlots};
use crate::domain::filesystem::{transfer_entries, TransferMode, TransferOptions};
use crate::platform::{drag::prepare_drag, windows::com::StaComGuard};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use windows::core::HSTRING;
use windows::Win32::Storage::FileSystem::{DeleteFileW, RemoveDirectoryW};

#[test]
#[ignore = "copies a disposable file larger than 1 GiB twice"]
fn a_large_temporary_drop_survives_source_cleanup_and_copies_to_the_destination() {
    const TAIL_OFFSET: u64 = 1024 * 1024 * 1024;
    let _apartment = StaComGuard::new().unwrap();
    let slots = StageSlots::default();
    let source = DropStage::new(&slots).unwrap();
    let member = source.path().join("archive-member.bin");
    let mut file = File::create(&member).unwrap();
    file.seek(SeekFrom::Start(TAIL_OFFSET)).unwrap();
    file.write_all(b"end").unwrap();
    drop(file);
    let member = extract_with_7zip_if_requested(member, source.path());

    let data = prepare_drag(vec![member.to_str().unwrap().to_owned()])
        .unwrap()
        .data_object()
        .unwrap();
    let started = Instant::now();
    let prepared = prepare_hdrop_paths(extract_hdrop_paths(&data), &slots).unwrap();
    let acquired_in = started.elapsed();
    drop(data);
    // Use the provider's Win32 deletion path while Stratum still holds the file.
    unsafe { DeleteFileW(&HSTRING::from(member.as_os_str())) }.unwrap();
    assert!(File::open(&member).is_err());
    let directory = member.parent().unwrap();
    unsafe { RemoveDirectoryW(&HSTRING::from(directory.as_os_str())) }.unwrap();
    let started = Instant::now();
    let received = std::thread::spawn(move || prepared.materialize())
        .join()
        .unwrap()
        .unwrap();
    eprintln!(
        "Acquired drop in {acquired_in:?}. Staged contents in {:?} on the worker.",
        started.elapsed()
    );
    let stage = received.stage.unwrap();
    let stage_path = stage.path().to_owned();
    assert!(!member.exists());
    drop(source);

    let destination = DropStage::new(&slots).unwrap();
    let report = transfer_entries(
        received.paths,
        destination.path().to_str().unwrap().to_owned(),
        Some(TransferOptions {
            mode: Some(TransferMode::Copy),
            ..Default::default()
        }),
        None,
        None,
    )
    .unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(report.copied, 1);
    drop(stage);
    assert!(!stage_path.exists());

    let mut file = File::open(destination.path().join("archive-member.bin")).unwrap();
    assert_eq!(file.metadata().unwrap().len(), TAIL_OFFSET + 3);
    file.seek(SeekFrom::Start(TAIL_OFFSET)).unwrap();
    let mut tail = [0; 3];
    file.read_exact(&mut tail).unwrap();
    assert_eq!(&tail, b"end");
}

fn extract_with_7zip_if_requested(member: PathBuf, directory: &Path) -> PathBuf {
    // This optional setup times Stratum's intake using an actual 7-Zip member.
    let Some(executable) = std::env::var_os("STRATUM_TEST_7ZIP") else {
        return member;
    };
    let started = Instant::now();
    let archive = directory.join("fixture.7z");
    let extracted = directory.join("extracted");
    let name = member.file_name().unwrap();
    let mut output = std::ffi::OsString::from("-o");
    output.push(&extracted);
    for args in [
        ["a".as_ref(), "-mx=1".as_ref(), archive.as_os_str(), name],
        ["x".as_ref(), "-y".as_ref(), archive.as_os_str(), &output],
    ] {
        let result = Command::new(&executable)
            .args(args)
            .current_dir(directory)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    eprintln!(
        "Created and extracted the fixture with 7-Zip in {:?}.",
        started.elapsed()
    );
    extracted.join(name)
}
