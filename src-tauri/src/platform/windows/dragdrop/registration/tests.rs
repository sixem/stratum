use super::*;
use std::rc::Rc;
use windows::core::{implement, w, Ref, Result as WinResult};
use windows::Win32::Foundation::{DRAGDROP_E_NOTREGISTERED, POINTL};
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::{IDropTarget_Impl, DROPEFFECT};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, IsWindowVisible, WS_CHILD, WS_POPUP,
};

struct HiddenWindow(HWND);

impl HiddenWindow {
    fn new(parent: Option<HWND>) -> Self {
        let style = if parent.is_some() { WS_CHILD } else { WS_POPUP };
        let hwnd = unsafe {
            CreateWindowExW(
                Default::default(),
                w!("STATIC"),
                w!(""),
                style,
                0,
                0,
                1,
                1,
                parent,
                None,
                None,
                None,
            )
            .unwrap()
        };
        assert!(!unsafe { IsWindowVisible(hwnd) }.as_bool());
        Self(hwnd)
    }
}

impl Drop for HiddenWindow {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.0);
        }
    }
}

#[implement(IDropTarget)]
struct TestTarget(Rc<Cell<usize>>);

impl Drop for TestTarget {
    fn drop(&mut self) {
        self.0.set(self.0.get() + 1);
    }
}

impl IDropTarget_Impl for TestTarget_Impl {
    fn DragEnter(
        &self,
        _: Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        _: &POINTL,
        _: *mut DROPEFFECT,
    ) -> WinResult<()> {
        Ok(())
    }
    fn DragOver(&self, _: MODIFIERKEYS_FLAGS, _: &POINTL, _: *mut DROPEFFECT) -> WinResult<()> {
        Ok(())
    }
    fn DragLeave(&self) -> WinResult<()> {
        Ok(())
    }
    fn Drop(
        &self,
        _: Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        _: &POINTL,
        _: *mut DROPEFFECT,
    ) -> WinResult<()> {
        Ok(())
    }
}

#[test]
fn hidden_windows_register_late_children_restore_replaced_targets_and_revoke_on_cleanup() {
    // Keep OLE initialized for the final probes even after our registration owner drops.
    let _apartment = WindowTargets::new().unwrap();
    let main = HiddenWindow::new(None);
    let early = HiddenWindow::new(Some(main.0));
    let mut state = WindowTargets::new().unwrap();
    let destroyed = Rc::new(Cell::new(0));
    let count = Cell::new(0);
    let create = || {
        count.set(count.get() + 1);
        TestTarget(destroyed.clone()).into()
    };
    let probe: IDropTarget = TestTarget(Rc::new(Cell::new(0))).into();

    state.update(main.0, false, create).unwrap();
    assert_eq!(count.get(), 2);
    for hwnd in [main.0, early.0] {
        assert_eq!(
            unsafe { RegisterDragDrop(hwnd, &probe) }
                .unwrap_err()
                .code(),
            DRAGDROP_E_ALREADYREGISTERED
        );
    }

    let late = HiddenWindow::new(Some(early.0));
    state.update(main.0, false, create).unwrap();
    state.update(main.0, false, create).unwrap();
    assert_eq!(count.get(), 3);
    assert_eq!(
        unsafe { RegisterDragDrop(late.0, &probe) }
            .unwrap_err()
            .code(),
        DRAGDROP_E_ALREADYREGISTERED
    );

    // The browser can replace an OLE target while keeping the same HWND.
    let browser_released = Rc::new(Cell::new(0));
    let browser_target: IDropTarget = TestTarget(browser_released.clone()).into();
    unsafe {
        RevokeDragDrop(early.0).unwrap();
        RegisterDragDrop(early.0, &browser_target).unwrap();
    }
    drop(browser_target);
    assert_eq!(browser_released.get(), 0);
    state.update(main.0, true, create).unwrap();
    assert_eq!(count.get(), 6);
    assert_eq!(destroyed.get(), 3);
    assert_eq!(browser_released.get(), 1);

    drop(state);
    assert_eq!(destroyed.get(), 6);
    for hwnd in [main.0, early.0, late.0] {
        assert_eq!(
            unsafe { RevokeDragDrop(hwnd) }.unwrap_err().code(),
            DRAGDROP_E_NOTREGISTERED
        );
        unsafe {
            RegisterDragDrop(hwnd, &probe).unwrap();
            RevokeDragDrop(hwnd).unwrap();
        }
    }
}
