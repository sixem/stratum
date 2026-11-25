// Materialize a FileGroupDescriptor selection in a private directory. Original
// descriptor positions are also the lindex values for requesting FileContents.
use super::{file_contents_format, file_descriptor_format, with_medium, DropDataError};
use crate::platform::windows::{
    dragdrop::{
        stage_slots::StageSlots,
        staging::{copy_stream, DropStage, ReceivedFiles, StagingBudget, MAX_DEPTH, MAX_ITEMS},
    },
    file_names::plain_component,
};
use std::{
    collections::HashMap,
    fs::{self, File},
    io,
    mem::{offset_of, size_of},
    path::{Path, PathBuf},
};
use windows::Win32::{
    Foundation::HGLOBAL,
    Storage::FileSystem::FILE_ATTRIBUTE_DIRECTORY,
    System::{
        Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL, TYMED_ISTREAM},
        Memory::{GlobalLock, GlobalSize, GlobalUnlock},
    },
    UI::Shell::{FD_ATTRIBUTES, FD_FILESIZE, FILEDESCRIPTORW, FILEGROUPDESCRIPTORW},
};

struct Descriptor {
    index: i32,
    name: String,
    directory: bool,
    size: Option<u64>,
}

impl Descriptor {
    fn components(&self) -> impl Iterator<Item = &str> {
        let name = if self.directory {
            self.name.trim_end_matches(['\\', '/'])
        } else {
            self.name.as_str()
        };
        name.split(['\\', '/'])
    }
}

pub(super) fn materialize(
    data: &IDataObject,
    slots: &StageSlots,
) -> Result<Option<ReceivedFiles>, DropDataError> {
    let descriptor_format = FORMATETC {
        cfFormat: file_descriptor_format(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
        ..Default::default()
    };
    let Some(descriptors) = with_medium(data, &descriptor_format, |medium| {
        with_bytes(unsafe { medium.u.hGlobal }, read_descriptors)
    })
    .transpose()?
    else {
        return Ok(None);
    };
    let stage = DropStage::new(slots)?;
    let budget = StagingBudget::for_directory(stage.path())?;
    materialize_selection(stage, descriptors, budget, |item, file, budget| {
        write_contents(data, item, file, budget)
    })
    .map(Some)
}

fn with_bytes<T>(
    handle: HGLOBAL,
    read: impl FnOnce(&[u8]) -> Result<T, DropDataError>,
) -> Result<T, DropDataError> {
    if handle.is_invalid() {
        return Err(DropDataError::InvalidSource);
    }
    let size = unsafe { GlobalSize(handle) };
    if size == 0 {
        return read(&[]);
    }
    if size > isize::MAX as usize {
        return Err(DropDataError::InvalidSource);
    }
    let ptr = unsafe { GlobalLock(handle) }.cast::<u8>();
    if ptr.is_null() {
        return Err(DropDataError::InvalidSource);
    }
    let result = read(unsafe { std::slice::from_raw_parts(ptr, size) });
    unsafe {
        let _ = GlobalUnlock(handle);
    }
    result
}

fn read_descriptors(bytes: &[u8]) -> Result<Vec<Descriptor>, DropDataError> {
    let count = u32::from_ne_bytes(
        bytes
            .first_chunk()
            .copied()
            .ok_or(DropDataError::InvalidSource)?,
    ) as usize;
    if count > MAX_ITEMS {
        return Err(DropDataError::TooManyItems);
    }
    let records = bytes
        .get(offset_of!(FILEGROUPDESCRIPTORW, fgd)..)
        .ok_or(DropDataError::InvalidSource)?;
    if count > records.len() / size_of::<FILEDESCRIPTORW>() {
        return Err(DropDataError::InvalidSource);
    }
    let mut items = Vec::with_capacity(count);
    for (index, record) in records
        .chunks_exact(size_of::<FILEDESCRIPTORW>())
        .take(count)
        .enumerate()
    {
        let descriptor = unsafe { record.as_ptr().cast::<FILEDESCRIPTORW>().read_unaligned() };
        let wide = descriptor.cFileName;
        let len = wide
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(wide.len());
        if len == 0 {
            continue;
        }
        items.push(Descriptor {
            index: index as i32,
            name: String::from_utf16(&wide[..len]).map_err(|_| DropDataError::InvalidSource)?,
            directory: descriptor.dwFlags & FD_ATTRIBUTES.0 as u32 != 0
                && descriptor.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0,
            size: (descriptor.dwFlags & FD_FILESIZE.0 as u32 != 0).then_some(
                (u64::from(descriptor.nFileSizeHigh) << 32) | u64::from(descriptor.nFileSizeLow),
            ),
        });
    }
    if items.is_empty() {
        return Err(DropDataError::InvalidSource);
    }
    Ok(items)
}

fn materialize_selection(
    stage: DropStage,
    items: Vec<Descriptor>,
    mut budget: StagingBudget,
    mut write: impl FnMut(&Descriptor, &mut File, &mut StagingBudget) -> Result<(), DropDataError>,
) -> Result<ReceivedFiles, DropDataError> {
    // Validate names and known sizes before creating any files. Unknown sizes
    // are charged as their contents arrive, just like known sizes.
    let mut declared_bytes_left = budget.remaining_bytes();
    for item in &items {
        for (index, component) in item.components().enumerate() {
            if index >= MAX_DEPTH {
                return Err(DropDataError::TooDeep);
            }
            if !plain_component(component) {
                return Err(DropDataError::InvalidSource);
            }
        }
        if let Some(size) = item.size.filter(|_| !item.directory) {
            declared_bytes_left = declared_bytes_left
                .checked_sub(size)
                .ok_or(DropDataError::InsufficientSpace)?;
        }
    }

    let mut directories = HashMap::<PathBuf, PathBuf>::new();
    let mut suffixes = HashMap::new();
    let mut roots = Vec::new();
    for item in items {
        let mut original = PathBuf::new();
        let mut destination = stage.path().to_owned();
        let mut components = item.components().peekable();
        while let Some(name) = components.next() {
            original.push(name);
            let is_root = destination == stage.path();
            if item.directory || components.peek().is_some() {
                if let Some(existing) = directories.get(&original) {
                    destination = existing.clone();
                    continue;
                }
                budget.reserve_entry()?;
                (destination, ()) = create_unique(&mut suffixes, &destination, name, |path| {
                    fs::create_dir(path)
                })
                .map_err(DropDataError::from_staging_io)?;
                directories.insert(original.clone(), destination.clone());
            } else {
                budget.reserve_entry()?;
                let (path, mut file) = create_unique(&mut suffixes, &destination, name, |path| {
                    File::create_new(path)
                })
                .map_err(DropDataError::from_staging_io)?;
                if item.size != Some(0) {
                    write(&item, &mut file, &mut budget)?;
                }
                destination = path;
            }
            if is_root {
                roots.push(
                    destination
                        .to_str()
                        .ok_or(DropDataError::StagingFailed)?
                        .to_owned(),
                );
            }
        }
    }
    if roots.is_empty() {
        return Err(DropDataError::InvalidSource);
    }
    Ok(ReceivedFiles::staged(roots, stage))
}

// Reserve with CREATE_NEW. The destination filesystem applies its own case and
// Unicode comparison rules, and two descriptors can never overwrite one another.
fn create_unique<T>(
    suffixes: &mut HashMap<PathBuf, u32>,
    directory: &Path,
    name: &str,
    create: impl Fn(&Path) -> io::Result<T>,
) -> io::Result<(PathBuf, T)> {
    let original = directory.join(name);
    match create(&original) {
        Ok(value) => return Ok((original, value)),
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {}
        Err(err) => return Err(err),
    }
    let stem = original
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let extension = original.extension().and_then(|s| s.to_str());
    let next = suffixes
        .entry(directory.join(name.to_lowercase()))
        .or_insert(2);
    loop {
        let candidate = directory.join(match extension {
            Some(ext) => format!("{stem} ({next}).{ext}"),
            None => format!("{stem} ({next})"),
        });
        *next = next
            .checked_add(1)
            .ok_or_else(|| io::Error::other("Too many duplicate file names"))?;
        match create(&candidate) {
            Ok(value) => return Ok((candidate, value)),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {}
            Err(err) => return Err(err),
        }
    }
}

fn write_contents(
    data: &IDataObject,
    item: &Descriptor,
    file: &mut File,
    budget: &mut StagingBudget,
) -> Result<(), DropDataError> {
    let mut format = FORMATETC {
        cfFormat: file_contents_format(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: item.index,
        tymed: TYMED_ISTREAM.0 as u32,
        ..Default::default()
    };
    // A failure reading a supplied stream invalidates the whole staging tree.
    // Try another format only if the source did not supply the stream.
    if let Some(result) = with_medium(data, &format, |medium| {
        let stream = unsafe { (&*medium.u.pstm).as_ref() }.ok_or(DropDataError::InvalidSource)?;
        copy_stream(stream, item.size, file, budget)
    }) {
        return result;
    }
    format.tymed = TYMED_HGLOBAL.0 as u32;
    with_medium(data, &format, |medium| {
        with_bytes(unsafe { medium.u.hGlobal }, |bytes| {
            // GlobalSize can include allocator padding past the descriptor's file size.
            let length = match item.size {
                Some(size) => usize::try_from(size).map_err(|_| DropDataError::InvalidSource)?,
                None => bytes.len(),
            };
            let contents = bytes.get(..length).ok_or(DropDataError::InvalidSource)?;
            budget.write(file, contents)
        })
    })
    .ok_or(DropDataError::InvalidSource)?
}

#[cfg(test)]
mod tests;
