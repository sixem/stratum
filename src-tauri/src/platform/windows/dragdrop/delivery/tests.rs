use super::*;
use crate::platform::windows::{dragdrop::DropStage, file_drop::write_dropfiles};
use std::fs;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use windows::core::{implement, Ref, Result as WinResult, BOOL, HRESULT};
use windows::Win32::Foundation::{DV_E_FORMATETC, E_NOTIMPL};
use windows::Win32::System::Com::{
    IAdviseSink, IAgileObject, IAgileObject_Impl, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA,
    FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
};
use windows::Win32::System::Ole::CF_HDROP;
use windows::Win32::UI::Shell::IDataObjectAsyncCapability_Impl;

#[implement(IDataObject, IDataObjectAsyncCapability, IAgileObject)]
struct Provider {
    paths: Vec<String>,
    enabled: AtomicBool,
    active: AtomicBool,
    completed: Arc<AtomicBool>,
}

// The fixture only holds thread-safe data and gives each caller its own medium.
impl IAgileObject_Impl for Provider_Impl {}

impl IDataObject_Impl for Provider_Impl {
    fn GetData(&self, format: *const FORMATETC) -> WinResult<STGMEDIUM> {
        self.QueryGetData(format).ok()?;
        if !self.active.load(Ordering::SeqCst) {
            return Err(E_FAIL.into());
        }
        Ok(STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 {
                hGlobal: write_dropfiles(&self.paths).unwrap(),
            },
            ..Default::default()
        })
    }

    fn QueryGetData(&self, format: *const FORMATETC) -> HRESULT {
        if unsafe { format.as_ref() }.is_some_and(|format| format.cfFormat == CF_HDROP.0) {
            S_OK
        } else {
            DV_E_FORMATETC
        }
    }

    fn GetDataHere(&self, _: *const FORMATETC, _: *mut STGMEDIUM) -> WinResult<()> {
        E_NOTIMPL.ok()
    }
    fn GetCanonicalFormatEtc(&self, _: *const FORMATETC, _: *mut FORMATETC) -> HRESULT {
        E_NOTIMPL
    }
    fn SetData(&self, _: *const FORMATETC, _: *const STGMEDIUM, _: BOOL) -> WinResult<()> {
        E_NOTIMPL.ok()
    }
    fn EnumFormatEtc(&self, _: u32) -> WinResult<IEnumFORMATETC> {
        Err(E_NOTIMPL.into())
    }
    fn DAdvise(&self, _: *const FORMATETC, _: u32, _: Ref<'_, IAdviseSink>) -> WinResult<u32> {
        Err(E_NOTIMPL.into())
    }
    fn DUnadvise(&self, _: u32) -> WinResult<()> {
        E_NOTIMPL.ok()
    }
    fn EnumDAdvise(&self) -> WinResult<IEnumSTATDATA> {
        Err(E_NOTIMPL.into())
    }
}

impl IDataObjectAsyncCapability_Impl for Provider_Impl {
    fn SetAsyncMode(&self, mode: BOOL) -> WinResult<()> {
        self.enabled.store(mode.as_bool(), Ordering::SeqCst);
        Ok(())
    }

    fn GetAsyncMode(&self) -> WinResult<BOOL> {
        Ok(self.enabled.load(Ordering::SeqCst).into())
    }

    fn StartOperation(&self, _: Ref<'_, IBindCtx>) -> WinResult<()> {
        self.active.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn InOperation(&self) -> WinResult<BOOL> {
        Ok(self.active.load(Ordering::SeqCst).into())
    }

    fn EndOperation(&self, status: HRESULT, _: Ref<'_, IBindCtx>, effect: u32) -> WinResult<()> {
        self.completed.store(
            status == S_OK && effect == DROPEFFECT_COPY.0,
            Ordering::SeqCst,
        );
        self.active.store(false, Ordering::SeqCst);
        Ok(())
    }
}

#[test]
fn async_provider_is_read_on_a_worker_and_finished_on_the_drop_apartment() {
    let _apartment = StaComGuard::new().unwrap();
    let slots = Arc::new(StageSlots::default());
    let stage = DropStage::new(&slots).unwrap();
    let path = stage.path().join("async.txt");
    fs::write(&path, b"async data").unwrap();
    let completed = Arc::new(AtomicBool::new(false));
    let provider: IDataObject = Provider {
        paths: vec![path.to_str().unwrap().to_owned()],
        enabled: AtomicBool::default(),
        active: AtomicBool::default(),
        completed: Arc::clone(&completed),
    }
    .into();
    let capability = provider.cast::<IDataObjectAsyncCapability>().unwrap();
    assert!(AsyncDrop::start(&provider, &slots).unwrap().is_none());
    unsafe { capability.SetAsyncMode(true) }.unwrap();
    let operation = AsyncDrop::start(&provider, &slots).unwrap().unwrap();
    assert!(unsafe { capability.InOperation() }.unwrap().as_bool());

    let (operation, received) = std::thread::spawn(move || {
        let received = operation.extract(&slots).unwrap();
        (operation, received)
    })
    .join()
    .unwrap();
    assert_eq!(fs::read(&received.paths[0]).unwrap(), b"async data");
    operation.end(DROPEFFECT_COPY);
    assert!(completed.load(Ordering::SeqCst));
    assert!(!unsafe { capability.InOperation() }.unwrap().as_bool());
}
