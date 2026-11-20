// Exercise the installed Windows Shell without sending mouse or keyboard input.
use super::*;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use windows::{
    core::{w, PSTR},
    Win32::{
        Foundation::{LPARAM, WPARAM},
        System::Ole::{OleInitialize, OleUninitialize},
        UI::{
            Shell::GCS_VERBW,
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, GetMenuItemID, GetMenuStringW, GetSubMenu,
                SendMessageW, MF_BYPOSITION, WM_INITMENUPOPUP, WS_EX_TOOLWINDOW, WS_POPUP,
            },
        },
    },
};

struct Fixture {
    dir: PathBuf,
    owner: HWND,
}

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = loop {
            let dir = std::env::temp_dir().join(format!(
                "stratum-shell-menu-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&dir) {
                Ok(()) => break dir,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => panic!("create menu fixture: {e}"),
            }
        };
        unsafe {
            OleInitialize(None).unwrap();
        }
        let owner = unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("STATIC"),
                None,
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        };
        Self { dir, owner }
    }

    fn file(&self, name: &str) -> String {
        let path = self.dir.join(name);
        fs::write(&path, b"Stratum menu test\n").unwrap();
        path.to_str().unwrap().to_string()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.owner);
            OleUninitialize();
        }
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn commands(menu: HMENU) -> impl Iterator<Item = (i32, u32, String)> {
    (0..unsafe { GetMenuItemCount(Some(menu)) }).map(move |position| {
        let mut buffer = [0; 512];
        let len =
            unsafe { GetMenuStringW(menu, position as u32, Some(&mut buffer), MF_BYPOSITION) };
        let name = String::from_utf16_lossy(&buffer[..len as usize]).replace('&', "");
        (position, unsafe { GetMenuItemID(menu, position) }, name)
    })
}

fn canonical_verb(context: &IContextMenu, command: u32) -> Option<String> {
    if !(FIRST_COMMAND..=LAST_COMMAND).contains(&command) {
        return None;
    }
    let mut name = [0u16; 256];
    unsafe {
        context.GetCommandString(
            (command - FIRST_COMMAND) as usize,
            GCS_VERBW,
            None,
            PSTR(name.as_mut_ptr().cast()),
            name.len() as u32,
        )
    }
    .ok()?;
    let len = name.iter().position(|c| *c == 0)?;
    Some(String::from_utf16_lossy(&name[..len]))
}

#[test]
fn file_selection_and_folder_background_supply_real_shell_commands() {
    let f = Fixture::new();
    let files = [f.file("one.txt"), f.file("two.txt")];
    for selection in [&files[..1], &files[..]] {
        let menu = ShellMenu::build(f.owner, selection, None, false, false).unwrap();
        let verbs: Vec<_> = commands(menu.popup.0)
            .filter_map(|(_, id, _)| canonical_verb(&menu.context, id))
            .collect();
        assert!(verbs.iter().any(|v| v == "cut"), "{verbs:?}");
        assert!(verbs.iter().any(|v| v == "copy"), "{verbs:?}");
    }
    let background = ShellMenu::build(f.owner, &[], f.dir.to_str(), false, false).unwrap();
    assert!(commands(background.popup.0).count() > 0);
    fs::create_dir(f.dir.join("child")).unwrap();
    let nested = f.file("child/nested.txt");
    assert!(selection::context_menu(f.owner, &[files[0].clone(), nested], None).is_err());
}

#[test]
fn gallery_is_opt_in_and_dispatches_outside_the_shell_command_range() {
    let f = Fixture::new();
    let files = [f.file("one.jpg"), f.file("two.jpg")];
    for selection in [&files[..1], &files[..]] {
        let native = ShellMenu::build(f.owner, selection, None, false, false).unwrap();
        assert!(!commands(native.popup.0).any(|(_, id, _)| id == GALLERY_COMMAND));

        let gallery = ShellMenu::build(f.owner, selection, None, false, true).unwrap();
        let (_, id, name) = commands(gallery.popup.0).last().unwrap();
        assert_eq!((id, name.as_str()), (GALLERY_COMMAND, "Open in gallery"));
        assert!(canonical_verb(&gallery.context, id).is_none());
        assert!(gallery.invoke(f.owner, id, POINT::default(), None).is_err());
        assert_eq!(
            gallery
                .dispatch(f.owner, id, POINT::default(), None)
                .unwrap(),
            ShellMenuOutcome::Gallery
        );
        assert_eq!(
            gallery
                .dispatch(f.owner, 0, POINT::default(), None)
                .unwrap(),
            ShellMenuOutcome::Dismissed
        );
        assert!(native
            .dispatch(f.owner, id, POINT::default(), None)
            .is_err());
    }
    let background = ShellMenu::build(f.owner, &[], f.dir.to_str(), false, true).unwrap();
    assert!(!commands(background.popup.0).any(|(_, id, _)| id == GALLERY_COMMAND));
    assert!(ShellMenu::build(f.owner, &[], None, false, true).is_err());
}

#[test]
#[ignore = "requires an isolated StratumMenuTest desktop for the native popup"]
fn private_desktop_popup_reaches_native_menu_loop_and_dismisses() {
    use std::cell::Cell;
    use windows::Win32::{
        Foundation::{LRESULT, RECT},
        System::Threading::{GetStartupInfoW, STARTUPINFOW},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                EndMenu, GetWindowRect, IsWindowVisible, PostMessageW, WM_APP, WM_ENTERMENULOOP,
            },
        },
    };
    const DISMISS: u32 = WM_APP + 0x23;
    unsafe extern "system" fn observe(
        hwnd: HWND,
        msg: u32,
        w: WPARAM,
        l: LPARAM,
        _: usize,
        data: usize,
    ) -> LRESULT {
        if msg == WM_ENTERMENULOOP {
            unsafe {
                (&*(data as *const Cell<bool>)).set(true);
                let _ = PostMessageW(Some(hwnd), DISMISS, WPARAM(0), LPARAM(0));
            }
        }
        if msg == DISMISS {
            unsafe {
                let _ = EndMenu();
            }
            return LRESULT(0);
        }
        unsafe { DefSubclassProc(hwnd, msg, w, l) }
    }
    let mut startup = STARTUPINFOW::default();
    unsafe {
        GetStartupInfoW(&mut startup);
    }
    assert!(
        !startup.lpDesktop.is_null()
            && unsafe { startup.lpDesktop.to_string() }
                .unwrap()
                .starts_with("winsta0\\StratumMenuTest")
    );
    let f = Fixture::new();
    let menu = ShellMenu::build(f.owner, &[f.file("menu.txt")], None, false, false).unwrap();
    let opened = Cell::new(false);
    assert!(unsafe {
        SetWindowSubclass(
            f.owner,
            Some(observe),
            1,
            &opened as *const Cell<bool> as usize,
        )
    }
    .as_bool());
    let point = POINT { x: 64, y: 64 };
    position_owner(f.owner, point).unwrap();
    let mut bounds = RECT::default();
    unsafe { GetWindowRect(f.owner, &mut bounds) }.unwrap();
    assert!(unsafe { IsWindowVisible(f.owner) }.as_bool());
    assert_eq!((bounds.left, bounds.top), (point.x, point.y));
    assert_eq!((bounds.right, bounds.bottom), (point.x, point.y));
    let result = menu.track(f.owner, point);
    unsafe {
        let _ = RemoveWindowSubclass(f.owner, Some(observe), 1);
    }
    assert_eq!(result.unwrap(), 0, "dismissing must not choose a command");
    assert!(
        opened.get(),
        "the hidden proxy never received a real native menu"
    );
}

#[test]
#[ignore = "requires the installed 7-Zip Shell extension; invokes it on a disposable file"]
fn seven_zip_submenu_creates_archive_from_disposable_selection() {
    let f = Fixture::new();
    let path = f.file("stratum-menu-fixture.txt");
    let menu = ShellMenu::build(f.owner, &[path], None, false, false).unwrap();
    let root = menu.popup.0;
    let labels: Vec<_> = commands(root).map(|(_, _, s)| s).collect();
    let command = messages::with_menu_messages(f.owner, &menu.context, || {
        // Opening a cascade sends this message to the owner. Exercise the
        // production forwarding callback so lazy 7-Zip menus populate, too.
        unsafe {
            SendMessageW(
                f.owner,
                WM_INITMENUPOPUP,
                Some(WPARAM(root.0 as usize)),
                Some(LPARAM(0)),
            );
        }
        let (position, _, _) = commands(root)
            .find(|(_, _, s)| s == "7-Zip")
            .unwrap_or_else(|| panic!("available root items: {labels:?}"));
        let submenu = unsafe { GetSubMenu(root, position) };
        assert!(!submenu.is_invalid());
        unsafe {
            SendMessageW(
                f.owner,
                WM_INITMENUPOPUP,
                Some(WPARAM(submenu.0 as usize)),
                Some(LPARAM(position as isize)),
            );
        }
        let matches: Vec<_> = commands(submenu)
            .filter(|(_, _, s)| {
                let lower = s.to_lowercase();
                lower.contains("stratum-menu-fixture.7z") && !lower.contains("mail")
            })
            .collect();
        assert_eq!(
            matches.len(),
            1,
            "7-Zip commands: {:?}",
            commands(submenu).collect::<Vec<_>>()
        );
        matches[0].1
    })
    .unwrap();
    menu.invoke(f.owner, command, POINT::default(), Some(&f.dir))
        .unwrap();
    let archive = f.dir.join("stratum-menu-fixture.7z");
    let end = Instant::now() + Duration::from_secs(15);
    let exe = PathBuf::from(std::env::var_os("ProgramFiles").unwrap()).join("7-Zip/7z.exe");
    loop {
        if archive.is_file() {
            let output = std::process::Command::new(&exe)
                .args(["x", "-so"])
                .arg(&archive)
                .output()
                .unwrap();
            if output.status.success() && output.stdout == b"Stratum menu test\n" {
                break;
            }
        }
        assert!(
            Instant::now() < end,
            "the Shell command did not produce an archive with the fixture bytes"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
#[ignore = "probes installed background verbs on a disposable folder"]
fn background_creates_folder() {
    let f = Fixture::new();
    let menu = ShellMenu::build(f.owner, &[], f.dir.to_str(), false, false).unwrap();
    let root = menu.popup.0;
    let command = messages::with_menu_messages(f.owner, &menu.context, || {
        let init = |menu: HMENU, position: i32| unsafe {
            SendMessageW(
                f.owner,
                WM_INITMENUPOPUP,
                Some(WPARAM(menu.0 as usize)),
                Some(LPARAM(position as isize)),
            )
        };
        init(root, 0);
        // Menu captions are localized. The Windows New folder handler exposes
        // a canonical verb after its dynamic submenu has been initialized.
        commands(root).find_map(|(position, _, _)| {
            let submenu = unsafe { GetSubMenu(root, position) };
            if submenu.is_invalid() {
                return None;
            }
            init(submenu, position);
            commands(submenu)
                .find(|(_, id, _)| {
                    canonical_verb(&menu.context, *id).as_deref() == Some("NewFolder")
                })
                .map(|(_, id, _)| id)
        })
    })
    .unwrap()
    .expect("Windows did not expose the NewFolder verb");
    menu.invoke(f.owner, command, POINT::default(), Some(&f.dir))
        .unwrap();
    assert!(fs::read_dir(&f.dir)
        .unwrap()
        .any(|entry| entry.unwrap().path().is_dir()));
}
