// Host the Windows Shell's actual popup and dispatch the chosen extension verb.
mod messages;
mod selection;

use crate::platform::ShellMenuOutcome;
use std::{mem::size_of, path::Path};
use windows::{
    core::{w, PCSTR, PCWSTR},
    Win32::{
        Foundation::{HWND, POINT},
        UI::{
            Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_SHIFT},
            Shell::{
                IContextMenu, CMF_EXTENDEDVERBS, CMF_ITEMMENU, CMF_NORMAL, CMIC_MASK_CONTROL_DOWN,
                CMIC_MASK_PTINVOKE, CMIC_MASK_SHIFT_DOWN, CMINVOKECOMMANDINFOEX, SEE_MASK_UNICODE,
            },
            WindowsAndMessaging::{
                AppendMenuW, CreatePopupMenu, DestroyMenu, GetAncestor, GetForegroundWindow,
                GetMenuItemCount, SetForegroundWindow, SetWindowPos, TrackPopupMenuEx,
                GA_ROOTOWNER, HMENU, MF_SEPARATOR, MF_STRING, SWP_NOACTIVATE, SWP_NOSIZE,
                SWP_NOZORDER, SWP_SHOWWINDOW, SW_SHOWNORMAL, TPM_RETURNCMD, TPM_RIGHTBUTTON,
            },
        },
    },
};

const FIRST_COMMAND: u32 = 1;
const LAST_COMMAND: u32 = 0x7fff;
const GALLERY_COMMAND: u32 = LAST_COMMAND + 1;

struct Popup(HMENU);

impl Drop for Popup {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyMenu(self.0);
        }
    }
}

struct ShellMenu {
    popup: Popup,
    context: IContextMenu,
    gallery_offered: bool,
}

impl ShellMenu {
    fn build(
        owner: HWND,
        paths: &[String],
        background: Option<&str>,
        extended: bool,
        offer_gallery: bool,
    ) -> Result<Self, String> {
        let context = selection::context_menu(owner, paths, background)?;
        let popup = Popup(unsafe { CreatePopupMenu() }.map_err(|e| e.to_string())?);
        let mut flags = if background.is_some() {
            CMF_NORMAL
        } else {
            CMF_ITEMMENU
        };
        if extended {
            flags |= CMF_EXTENDEDVERBS;
        }
        unsafe { context.QueryContextMenu(popup.0, 0, FIRST_COMMAND, LAST_COMMAND, flags) }
            .ok()
            .map_err(|e| format!("Windows could not populate the context menu: {e}"))?;
        let gallery_offered = offer_gallery && background.is_none() && !paths.is_empty();
        let count = unsafe { GetMenuItemCount(Some(popup.0)) };
        if count < 0 || (count == 0 && !gallery_offered) {
            return Err("Windows returned no commands for this selection.".into());
        }
        if gallery_offered {
            if count > 0 {
                unsafe { AppendMenuW(popup.0, MF_SEPARATOR, 0, PCWSTR::null()) }.map_err(
                    |error| format!("Windows could not extend the context menu: {error}"),
                )?;
            }
            unsafe {
                AppendMenuW(
                    popup.0,
                    MF_STRING,
                    GALLERY_COMMAND as usize,
                    w!("Open in gallery"),
                )
            }
            .map_err(|error| format!("Windows could not add the gallery command: {error}"))?;
        }
        Ok(Self {
            popup,
            context,
            gallery_offered,
        })
    }

    fn track(&self, owner: HWND, point: POINT) -> Result<u32, String> {
        messages::with_menu_messages(owner, &self.context, || unsafe {
            TrackPopupMenuEx(
                self.popup.0,
                (TPM_RIGHTBUTTON | TPM_RETURNCMD).0,
                point.x,
                point.y,
                owner,
                None,
            )
            .0 as u32
        })
    }

    fn invoke(
        &self,
        owner: HWND,
        command: u32,
        point: POINT,
        directory: Option<&Path>,
    ) -> Result<(), String> {
        if !(FIRST_COMMAND..=LAST_COMMAND).contains(&command) {
            return Err("Windows returned an invalid menu command.".into());
        }
        use std::os::windows::ffi::OsStrExt;
        let directory_wide = directory.map(|dir| {
            dir.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        });
        let offset = (command - FIRST_COMMAND) as usize;
        let mut mask = CMIC_MASK_PTINVOKE | SEE_MASK_UNICODE;
        if unsafe { GetKeyState(i32::from(VK_SHIFT.0)) } < 0 {
            mask |= CMIC_MASK_SHIFT_DOWN;
        }
        if unsafe { GetKeyState(i32::from(VK_CONTROL.0)) } < 0 {
            mask |= CMIC_MASK_CONTROL_DOWN;
        }
        let info = CMINVOKECOMMANDINFOEX {
            cbSize: size_of::<CMINVOKECOMMANDINFOEX>() as u32,
            hwnd: owner,
            fMask: mask,
            lpVerb: PCSTR(offset as *const u8),
            lpVerbW: PCWSTR(offset as *const u16),
            lpDirectoryW: directory_wide
                .as_ref()
                .map_or(PCWSTR::null(), |dir| PCWSTR(dir.as_ptr())),
            ptInvoke: point,
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        // Use the offset on the same IContextMenu which supplied the visible
        // command. Extensions are not required to publish a canonical verb name.
        unsafe {
            self.context
                .InvokeCommand((&info as *const CMINVOKECOMMANDINFOEX).cast())
        }
        .map_err(|e| format!("The Windows menu command failed: {e}"))
    }

    fn dispatch(
        &self,
        owner: HWND,
        command: u32,
        point: POINT,
        directory: Option<&Path>,
    ) -> Result<ShellMenuOutcome, String> {
        match command {
            0 => Ok(ShellMenuOutcome::Dismissed),
            // The gallery is a Stratum action. Its ID is outside the range
            // allocated to Shell extensions and is never sent to InvokeCommand.
            GALLERY_COMMAND if self.gallery_offered => Ok(ShellMenuOutcome::Gallery),
            command => {
                self.invoke(owner, command, point, directory)?;
                Ok(ShellMenuOutcome::Invoked)
            }
        }
    }
}

fn position_owner(owner: HWND, point: POINT) -> Result<(), String> {
    // Extension dialogs inherit this monitor. The zero-size tool window can
    // receive activation without drawing over Stratum or taking a taskbar slot.
    unsafe {
        SetWindowPos(
            owner,
            None,
            point.x,
            point.y,
            0,
            0,
            SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSIZE,
        )
    }
    .map_err(|e| format!("Windows could not position the menu: {e}"))
}

pub(crate) fn show(
    owner: HWND,
    source: HWND,
    paths: &[String],
    background_path: Option<&str>,
    point: POINT,
    extended: bool,
    offer_gallery: bool,
) -> Result<ShellMenuOutcome, String> {
    let menu = ShellMenu::build(owner, paths, background_path, extended, offer_gallery)?;
    unsafe {
        // Slow extensions can finish building after the user switched apps.
        let foreground = GetForegroundWindow();
        if foreground != owner
            && (foreground.is_invalid()
                || GetAncestor(foreground, GA_ROOTOWNER) != GetAncestor(source, GA_ROOTOWNER))
        {
            return Ok(ShellMenuOutcome::Dismissed);
        }
        position_owner(owner, point)?;
        if !SetForegroundWindow(owner).as_bool() && GetForegroundWindow() != owner {
            if GetForegroundWindow() != foreground {
                return Ok(ShellMenuOutcome::Dismissed);
            }
            return Err("Windows could not activate the menu. Click Stratum and try again.".into());
        }
    }
    let command = menu.track(owner, point)?;
    let directory = background_path
        .map(Path::new)
        .or_else(|| paths.first().and_then(|path| Path::new(path).parent()));
    menu.dispatch(owner, command, point, directory)
}

#[cfg(test)]
mod tests;
