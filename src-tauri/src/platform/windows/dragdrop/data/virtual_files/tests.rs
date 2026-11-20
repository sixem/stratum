use super::*;

fn descriptor(index: i32, name: &str, directory: bool) -> Descriptor {
    Descriptor {
        index,
        name: name.into(),
        directory,
        size: None,
    }
}

fn budget(entries: usize, bytes: u64) -> StagingBudget {
    StagingBudget::with_limits(entries, bytes)
}

fn group(names: &[&str]) -> Vec<u8> {
    let mut bytes = (names.len() as u32).to_ne_bytes().to_vec();
    for name in names {
        let mut descriptor = FILEDESCRIPTORW::default();
        let mut wide = [0u16; 260];
        for (unit, dest) in name.encode_utf16().zip(wide.iter_mut()) {
            *dest = unit;
        }
        descriptor.cFileName = wide;
        bytes.extend_from_slice(unsafe {
            std::slice::from_raw_parts(
                std::ptr::from_ref(&descriptor).cast::<u8>(),
                size_of::<FILEDESCRIPTORW>(),
            )
        });
    }
    bytes
}

#[test]
fn descriptor_indices_keep_positions_and_truncated_groups_are_rejected() {
    let mut bytes = group(&["a", "", "b"]);
    let descriptors = read_descriptors(&bytes).unwrap();
    let group: Vec<_> = descriptors
        .iter()
        .map(|d| (d.index, d.name.as_str()))
        .collect();
    assert_eq!(group, [(0, "a"), (2, "b")]);
    bytes.pop();
    assert!(matches!(
        read_descriptors(&bytes),
        Err(DropDataError::InvalidSource)
    ));
    assert!(matches!(
        read_descriptors(&u32::MAX.to_ne_bytes()),
        Err(DropDataError::TooManyItems)
    ));
}

#[test]
fn virtual_tree_keeps_folders_and_reserves_distinct_names_for_case_collisions() {
    let stage = DropStage::new(&StageSlots::default()).unwrap();
    let root = stage.path().to_owned();
    let items = vec![
        descriptor(0, "Report/Data.txt", false),
        descriptor(1, "Report/Empty/", true),
        descriptor(2, "Report", true),
        descriptor(3, "report/data.TXT", false),
        descriptor(4, "Report/DATA.txt", false),
        Descriptor {
            size: Some(0),
            ..descriptor(5, "zero.txt", false)
        },
    ];
    let result = materialize_selection(stage, items, budget(8, 3), |item, file, budget| {
        budget.write(file, &[item.index as u8])
    })
    .unwrap();
    assert_eq!(result.paths.len(), 3);
    assert_eq!(fs::read(root.join("Report/Data.txt")).unwrap(), [0]);
    assert!(root.join("Report/Empty").is_dir());
    assert_eq!(fs::read(root.join("report (2)/data.TXT")).unwrap(), [3]);
    assert_eq!(fs::read(root.join("Report/DATA (2).txt")).unwrap(), [4]);
    assert!(fs::read(root.join("zero.txt")).unwrap().is_empty());
    drop(result);
    assert!(!root.exists());
}

#[test]
fn failed_virtual_content_discards_the_entire_selection() {
    let stage = DropStage::new(&StageSlots::default()).unwrap();
    let root = stage.path().to_owned();
    let items = vec![
        descriptor(0, "first.txt", false),
        descriptor(1, "next.txt", false),
    ];
    let result = materialize_selection(stage, items, budget(2, 20), |item, file, budget| {
        budget.write(file, b"progress")?;
        if item.index != 0 {
            return Err(DropDataError::InvalidSource);
        }
        Ok(())
    });
    assert!(matches!(result, Err(DropDataError::InvalidSource)));
    assert!(!root.exists());
}

#[test]
fn declared_bytes_and_directory_depth_are_checked_before_reading_contents() {
    let stage = DropStage::new(&StageSlots::default()).unwrap();
    let root = stage.path().to_owned();
    let items = vec![
        Descriptor {
            size: Some(3),
            ..descriptor(0, "a.txt", false)
        },
        Descriptor {
            size: Some(3),
            ..descriptor(1, "b.txt", false)
        },
    ];
    let result = materialize_selection(stage, items, budget(3, 5), |_, _, _| {
        panic!("File contents should not be requested beyond the declared budget")
    });
    assert!(matches!(result, Err(DropDataError::TooLarge)));
    assert!(!root.exists());

    let stage = DropStage::new(&StageSlots::default()).unwrap();
    let root = stage.path().to_owned();
    let name = format!("{}file.txt", "folder/".repeat(MAX_DEPTH));
    let result = materialize_selection(
        stage,
        vec![descriptor(0, &name, false)],
        budget(MAX_ITEMS, 5),
        |_, _, _| panic!("File contents should not be requested beyond the depth limit"),
    );
    assert!(matches!(result, Err(DropDataError::TooDeep)));
    assert!(!root.exists());
}

#[test]
fn stage_counts_implicit_directories_and_removes_the_selection_on_rejection() {
    let stage = DropStage::new(&StageSlots::default()).unwrap();
    let root = stage.path().to_owned();
    let items = vec![
        descriptor(0, "One/a.txt", false),
        descriptor(1, "Two/b.txt", false),
    ];
    let result = materialize_selection(stage, items, budget(3, 5), |item, file, budget| {
        assert_eq!(item.index, 0);
        budget.write(file, b"in")
    });
    assert!(matches!(result, Err(DropDataError::TooManyItems)));
    assert!(!root.exists());
}

#[test]
fn size_less_streams_share_the_budget_and_never_write_an_over_budget_chunk() {
    use windows::Win32::UI::Shell::SHCreateMemStream;

    let stage = DropStage::new(&StageSlots::default()).unwrap();
    let root = stage.path().to_owned();
    let items = vec![
        descriptor(0, "first.txt", false),
        descriptor(1, "second.txt", false),
    ];
    let result = materialize_selection(stage, items, budget(2, 5), |item, file, budget| {
        let stream = unsafe { SHCreateMemStream(Some(b"abc")) }.unwrap();
        let result = copy_stream(&stream, item.size, file, budget);
        assert_eq!(
            file.metadata().unwrap().len(),
            if item.index == 0 { 3 } else { 0 }
        );
        result
    });
    assert!(matches!(result, Err(DropDataError::TooLarge)));
    assert!(!root.exists());
}

#[test]
fn ole_virtual_content_uses_original_index_and_excludes_hglobal_padding() {
    use crate::platform::windows::com::StaComGuard;
    use windows::Win32::System::{
        Com::{STGMEDIUM, STGMEDIUM_0},
        Memory::{GlobalAlloc, GMEM_MOVEABLE},
    };
    use windows::Win32::UI::Shell::SHCreateDataObject;

    let _com = StaComGuard::new().unwrap();
    let data: IDataObject =
        unsafe { SHCreateDataObject(None, None, None::<&IDataObject>) }.unwrap();
    let give = |format, index, bytes: &[u8]| unsafe {
        let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).unwrap();
        let ptr = GlobalLock(h).cast::<u8>();
        assert!(!ptr.is_null());
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(h);
        let format = FORMATETC {
            cfFormat: format,
            lindex: index,
            dwAspect: DVASPECT_CONTENT.0,
            tymed: TYMED_HGLOBAL.0 as u32,
            ..Default::default()
        };
        let medium = STGMEDIUM {
            tymed: format.tymed,
            u: STGMEDIUM_0 { hGlobal: h },
            ..Default::default()
        };
        data.SetData(&format, &medium, true).unwrap();
    };
    let mut records = group(&["", "small.txt"]);
    let second = offset_of!(FILEGROUPDESCRIPTORW, fgd) + size_of::<FILEDESCRIPTORW>();
    let flags = second + offset_of!(FILEDESCRIPTORW, dwFlags);
    records[flags..flags + 4].copy_from_slice(&(FD_FILESIZE.0 as u32).to_ne_bytes());
    let size = second + offset_of!(FILEDESCRIPTORW, nFileSizeLow);
    records[size..size + 4].copy_from_slice(&3u32.to_ne_bytes());
    give(file_descriptor_format(), -1, &records);
    give(file_contents_format(), 1, b"ABCpadding");
    let received = materialize(&data, &StageSlots::default()).unwrap().unwrap();
    assert_eq!(fs::read(&received.paths[0]).unwrap(), b"ABC");
}
