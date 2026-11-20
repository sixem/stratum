// Third-party extensions populate nested menus and paint custom items in response
// to messages delivered to the popup's owner window.
use windows::{
    core::Interface,
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, S_OK, WPARAM},
        UI::{
            Shell::{
                DefSubclassProc, IContextMenu, IContextMenu2, IContextMenu3, RemoveWindowSubclass,
                SetWindowSubclass,
            },
            WindowsAndMessaging::{WM_DRAWITEM, WM_INITMENUPOPUP, WM_MEASUREITEM, WM_MENUCHAR},
        },
    },
};

enum Handler {
    Version3(IContextMenu3),
    Version2(IContextMenu2),
}

impl Handler {
    fn forward(&self, msg: u32, wp: WPARAM, lp: LPARAM) -> Option<LRESULT> {
        match msg {
            WM_DRAWITEM | WM_MEASUREITEM if wp.0 != 0 => return None, // A control, rather than a menu item.
            WM_INITMENUPOPUP | WM_DRAWITEM | WM_MEASUREITEM | WM_MENUCHAR => {}
            _ => return None,
        }
        match self {
            Self::Version3(handler) => {
                let mut result = LRESULT(0);
                // S_FALSE means the extension declined the message. Preserve it
                // rather than treating every successful HRESULT as handled.
                let status = unsafe {
                    (handler.vtable().HandleMenuMsg2)(handler.as_raw(), msg, wp, lp, &mut result)
                };
                (status == S_OK).then_some(result)
            }
            Self::Version2(handler) if msg != WM_MENUCHAR => {
                let status =
                    unsafe { (handler.vtable().HandleMenuMsg)(handler.as_raw(), msg, wp, lp) };
                (status == S_OK).then_some(LRESULT(isize::from(matches!(
                    msg,
                    WM_DRAWITEM | WM_MEASUREITEM
                ))))
            }
            _ => None,
        }
    }
}

unsafe extern "system" fn menu_proc(
    owner: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    let handler = unsafe { &*(data as *const Handler) };
    handler
        .forward(msg, wp, lp)
        .unwrap_or_else(|| unsafe { DefSubclassProc(owner, msg, wp, lp) })
}

struct MenuMessages<'a> {
    owner: HWND,
    handler: &'a Handler,
}

// Keep the handler at a stable address for the full native modal loop, including
// menus which are opened by keyboard after the initial popup is already visible.
pub(super) fn with_menu_messages<T>(
    owner: HWND,
    context: &IContextMenu,
    show: impl FnOnce() -> T,
) -> Result<T, String> {
    let handler = if let Ok(v3) = context.cast::<IContextMenu3>() {
        Handler::Version3(v3)
    } else if let Ok(v2) = context.cast::<IContextMenu2>() {
        Handler::Version2(v2)
    } else {
        return Ok(show());
    };
    let address = &handler as *const Handler as usize;
    unsafe { SetWindowSubclass(owner, Some(menu_proc), address, address) }
        .ok()
        .map_err(|e| format!("Windows could not attach the menu handler: {e}"))?;
    let _subscription = MenuMessages {
        owner,
        handler: &handler,
    };
    Ok(show())
}

impl Drop for MenuMessages<'_> {
    fn drop(&mut self) {
        let _ = unsafe {
            RemoveWindowSubclass(
                self.owner,
                Some(menu_proc),
                self.handler as *const Handler as usize,
            )
        };
    }
}
