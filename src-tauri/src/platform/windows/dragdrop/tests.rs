// Exercise the native drop path using the temporary file list an archive app provides.
use super::{extract_drop_paths_for_transfer, DropStage, StageSlots};
use crate::domain::filesystem::{transfer_entries, TransferMode, TransferOptions};
use crate::platform::{drag::prepare_drag, windows::com::StaComGuard};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

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

    let data = prepare_drag(vec![member.to_str().unwrap().to_owned()])
        .unwrap()
        .data_object()
        .unwrap();
    let received = extract_drop_paths_for_transfer(&data, false, &slots).unwrap();
    let stage = received.stage.unwrap();
    let stage_path = stage.path().to_owned();
    drop(data);
    drop(source);
    assert!(!member.exists());

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
