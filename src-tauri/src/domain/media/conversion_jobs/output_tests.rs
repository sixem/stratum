// Pause the transaction between encoding and publication to model filesystem races.
use super::{video, Fixture};
use crate::domain::media::conversion_jobs::output::ConversionOutput;
use std::fs;

#[test]
fn a_replaced_input_survives_a_pending_replace() {
    let fixture = Fixture::new();
    let input = fixture.0.join("original.mkv");
    let output = fixture.0.join("original.mp4");
    let old = fixture.0.join("previous.mkv");
    fs::write(&input, b"before").unwrap();
    let stage = ConversionOutput::prepare(&video(&input, &output, "mp4", true, true)).unwrap();
    fs::write(&stage.payload, b"encoded").unwrap();
    fs::rename(&input, &old).unwrap();
    fs::write(&input, b"latest").unwrap();
    assert!(stage
        .commit()
        .unwrap_err()
        .contains("changed during conversion"));
    assert_eq!(fs::read(&input).unwrap(), b"latest");
    assert_eq!(fs::read(&old).unwrap(), b"before");
    assert!(!output.exists());
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
}

#[test]
fn a_destination_created_during_encoding_is_never_overwritten() {
    let fixture = Fixture::new();
    let input = fixture.0.join("original.mkv");
    let output = fixture.0.join("original.mp4");
    fs::write(&input, b"before").unwrap();
    let stage = ConversionOutput::prepare(&video(&input, &output, "mp4", true, true)).unwrap();
    fs::write(&stage.payload, b"encoded").unwrap();
    fs::write(&output, b"new file").unwrap();
    assert!(stage.commit().is_err());
    assert_eq!(fs::read(&input).unwrap(), b"before");
    assert_eq!(fs::read(&output).unwrap(), b"new file");
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
}

#[test]
fn a_new_directory_replacing_the_target_survives_rollback() {
    let fixture = Fixture::new();
    let input = fixture.0.join("original.mov");
    let output = fixture.0.join("original.mp4");
    fs::write(&input, b"source").unwrap();
    fs::write(&output, b"former").unwrap();
    let stage = ConversionOutput::prepare(&video(&input, &output, "mp4", true, true)).unwrap();
    fs::write(&stage.payload, b"encoded").unwrap();
    fs::rename(&output, fixture.0.join("previous.mp4")).unwrap();
    fs::create_dir(&output).unwrap();
    fs::write(output.join("new child"), b"mine").unwrap();
    assert!(stage.commit().is_err());
    assert_eq!(fs::read(&input).unwrap(), b"source");
    assert_eq!(fs::read(output.join("new child")).unwrap(), b"mine");
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 3);
}

#[test]
fn two_jobs_have_distinct_output_files_and_can_publish_only_once() {
    let fixture = Fixture::new();
    let input = fixture.0.join("original.mkv");
    let output = fixture.0.join("original.mp4");
    fs::write(&input, b"input").unwrap();
    let item = video(&input, &output, "mp4", true, false);
    let first = ConversionOutput::prepare(&item).unwrap();
    let second = ConversionOutput::prepare(&item).unwrap();
    assert_ne!(first.payload, second.payload);
    fs::write(&first.payload, b"first").unwrap();
    fs::write(&second.payload, b"second").unwrap();
    assert_eq!(first.commit().unwrap(), None);
    assert!(second.commit().is_err());
    assert_eq!(fs::read(&output).unwrap(), b"first");
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
}

#[cfg(windows)]
#[test]
fn cleanup_of_a_locked_backup_reports_its_location_and_leaves_the_published_file() {
    use crate::domain::filesystem::staging::StageDirectory;
    use crate::domain::media::conversion_jobs::output::cleanup_backups;
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

    let fixture = Fixture::new();
    let input = fixture.0.join("original.mov");
    let output = fixture.0.join("original.mp4");
    let stage = StageDirectory::beside(&input, "conversion-backup").unwrap();
    let backup = stage.path.join("original");
    fs::write(&backup, b"original").unwrap();
    fs::write(&output, b"converted").unwrap();
    let lock = fs::File::options()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&backup)
        .unwrap();
    let warning = cleanup_backups(&output, vec![(input, stage)]).expect("cleanup warning");
    drop(lock);
    assert!(warning.contains(backup.to_str().unwrap()));
    assert_eq!(fs::read(&output).unwrap(), b"converted");
    assert_eq!(fs::read(&backup).unwrap(), b"original");
}
