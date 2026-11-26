// Preview capabilities pair an opaque URL token with an already-open media file.
use std::collections::HashMap;
use std::fs::File;
use std::path::Path;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

use super::content_types::content_type_for_path;

const TOKEN_BYTES: usize = 16;
const MAX_GRANTS: usize = 16;
// A grant supports repeated range requests and normal breaks in long playback.
const GRANT_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Default)]
pub(crate) struct PreviewGrants {
    registry: Arc<Mutex<Registry>>,
}

#[derive(Default)]
struct Registry {
    owners: HashMap<String, Owner>,
    entries: HashMap<String, Grant>,
    expiry_worker_running: bool,
}

struct Owner {
    window: String,
    generation: Arc<()>,
}

pub(crate) struct PreviewRequest {
    owner: String,
    generation: Arc<()>,
}

struct Grant {
    owner: String,
    source: Arc<PreviewSource>,
    expires_at: Instant,
}

impl Drop for Grant {
    fn drop(&mut self) {
        // Release, expiry and window teardown all wake queued readers.
        self.source.read_slot.close();
    }
}

pub(super) struct PreviewSource {
    pub(super) content_type: &'static str,
    pub(super) file: Option<File>,
    pub(super) remote: Option<RemoteSource>,
    pub(super) read_slot: Arc<Semaphore>,
}

#[derive(Clone)]
pub(crate) struct RemoteSource {
    pub remotes: crate::services::remotes::Remotes,
    pub profile_id: String,
    pub session_id: u32,
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

impl PreviewSource {
    fn new(file: File, content_type: &'static str) -> Self {
        Self {
            file: Some(file),
            remote: None,
            content_type,
            read_slot: Arc::new(Semaphore::new(1)),
        }
    }
}

impl PreviewGrants {
    pub(crate) fn begin(&self, webview: &str, window: &str) -> Result<PreviewRequest, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "Preview is unavailable.")?;
        let owner = registry
            .owners
            .entry(webview.to_owned())
            .or_insert_with(|| Owner {
                window: window.to_owned(),
                generation: Arc::new(()),
            });
        Ok(PreviewRequest {
            owner: webview.to_owned(),
            generation: owner.generation.clone(),
        })
    }

    pub(crate) fn create(&self, request: PreviewRequest, path: &Path) -> Result<String, String> {
        if !is_preview_file_path(path) {
            return Err("Preview requires an absolute file path.".into());
        }
        let content_type =
            content_type_for_path(path).ok_or("This file type cannot be previewed.")?;

        let file =
            File::open(path).map_err(|error| format!("Could not open preview file: {error}"))?;
        let metadata = file
            .metadata()
            .map_err(|error| format!("Could not inspect preview file: {error}"))?;
        if !metadata.is_file() {
            return Err("Preview requires a regular file.".into());
        }

        self.insert(request, PreviewSource::new(file, content_type))
    }

    pub(crate) fn create_remote(
        &self,
        request: PreviewRequest,
        source: RemoteSource,
    ) -> Result<String, String> {
        let content_type = content_type_for_path(Path::new(&source.path))
            .ok_or("This file type cannot be previewed.")?;
        self.insert(
            request,
            PreviewSource {
                file: None,
                remote: Some(source),
                content_type,
                read_slot: Arc::new(Semaphore::new(1)),
            },
        )
    }

    fn insert(&self, request: PreviewRequest, source: PreviewSource) -> Result<String, String> {
        let mut random = [0; TOKEN_BYTES];
        getrandom::fill(&mut random).map_err(|_| "Could not authorize this preview.")?;
        let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "Preview is unavailable.")?;
        // A reload or window close may have revoked the owner during a slow file open.
        if !registry
            .owners
            .get(&request.owner)
            .is_some_and(|owner| Arc::ptr_eq(&owner.generation, &request.generation))
        {
            return Err("The preview has closed.".into());
        }
        let entries = &mut registry.entries;
        let now = Instant::now();
        entries.retain(|_, grant| grant.expires_at > now);
        if entries.len() >= MAX_GRANTS || entries.contains_key(&token) {
            return Err("Could not authorize another preview.".into());
        }
        entries.insert(
            token.clone(),
            Grant {
                owner: request.owner,
                source: Arc::new(source),
                expires_at: now + GRANT_LIFETIME,
            },
        );
        if !registry.expiry_worker_running {
            registry.expiry_worker_running = true;
            tauri::async_runtime::spawn(expire_grants(Arc::downgrade(&self.registry)));
        }
        Ok(token)
    }

    pub(super) fn resolve(&self, owner: &str, url_path: &str) -> Option<Arc<PreviewSource>> {
        let token = url_path.strip_prefix('/')?;
        if token.len() != TOKEN_BYTES * 2
            || !token
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return None;
        }
        let mut registry = self.registry.lock().ok()?;
        let entries = &mut registry.entries;
        let now = Instant::now();
        entries.retain(|_, grant| grant.expires_at > now);
        let grant = entries.get(token)?;
        (grant.owner == owner).then(|| Arc::clone(&grant.source))
    }

    pub(crate) fn release(&self, owner: &str, token: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            let now = Instant::now();
            registry.entries.retain(|candidate, grant| {
                grant.expires_at > now && !(candidate == token && grant.owner == owner)
            });
        }
    }

    pub(super) fn revoke_webview(&self, webview: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.owners.remove(webview);
            registry.entries.retain(|_, grant| grant.owner != webview);
        }
    }

    pub(super) fn revoke_window(&self, window: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            let Registry {
                owners, entries, ..
            } = &mut *registry;
            owners.retain(|_, owner| owner.window != window);
            entries.retain(|_, grant| owners.contains_key(&grant.owner));
        }
    }
}

async fn expire_grants(registry: Weak<Mutex<Registry>>) {
    loop {
        let next_expiry = {
            let Some(registry) = registry.upgrade() else {
                return;
            };
            let Ok(mut registry) = registry.lock() else {
                return;
            };
            let now = Instant::now();
            registry.entries.retain(|_, grant| grant.expires_at > now);
            let next_expiry = registry
                .entries
                .values()
                .map(|grant| grant.expires_at)
                .min();
            if next_expiry.is_none() {
                registry.expiry_worker_running = false;
            }
            next_expiry
        };
        let Some(next_expiry) = next_expiry else {
            return;
        };
        // All grants have the same lifetime, so later grants cannot advance this deadline.
        tokio::time::sleep_until(next_expiry.into()).await;
    }
}

fn is_preview_file_path(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        let mut components = path.components();
        // Exclude Windows device namespaces and alternate streams before opening.
        if !matches!(
            components.next(),
            Some(Component::Prefix(prefix)) if matches!(
                prefix.kind(),
                Prefix::Disk(_) | Prefix::VerbatimDisk(_) | Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _)
            )
        ) {
            return false;
        }
        if components.any(|component| component.as_os_str().to_string_lossy().contains(':')) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiry_worker_releases_an_idle_grant_and_exits() -> std::io::Result<()> {
        let fixture = super::super::tests::PreviewFixture::new("idle-expiry")?;
        let source = Arc::new(PreviewSource::new(File::open(&fixture.path)?, "video/mp4"));
        let source_ref = Arc::downgrade(&source);
        let registry = Arc::new(Mutex::new(Registry::default()));
        tauri::async_runtime::block_on(async {
            {
                let mut registry = registry.lock().unwrap();
                registry.expiry_worker_running = true;
                registry.entries.insert(
                    "test-token".into(),
                    Grant {
                        owner: "main".into(),
                        source,
                        expires_at: Instant::now() + Duration::from_millis(40),
                    },
                );
            }
            tokio::time::timeout(
                Duration::from_secs(5),
                expire_grants(Arc::downgrade(&registry)),
            )
            .await
            .expect("the worker should finish after the last grant expires");
        });
        assert!(source_ref.upgrade().is_none());
        let registry = registry.lock().unwrap();
        assert!(registry.entries.is_empty());
        assert!(!registry.expiry_worker_running);
        Ok(())
    }

    #[test]
    fn expired_grants_can_neither_be_read_nor_keep_a_slot() -> std::io::Result<()> {
        let grants = PreviewGrants::default();
        let fixture = super::super::tests::PreviewFixture::new("expiry")?;
        for _ in 0..MAX_GRANTS {
            grants
                .create(grants.begin("main", "main").unwrap(), &fixture.path)
                .unwrap();
        }
        assert!(grants
            .create(grants.begin("main", "main").unwrap(), &fixture.path)
            .is_err());
        {
            let mut registry = grants.registry.lock().unwrap();
            for grant in registry.entries.values_mut() {
                grant.expires_at = Instant::now();
            }
        }
        let token = grants
            .create(grants.begin("main", "main").unwrap(), &fixture.path)
            .unwrap();
        grants
            .registry
            .lock()
            .unwrap()
            .entries
            .get_mut(&token)
            .unwrap()
            .expires_at = Instant::now();
        assert!(grants.resolve("main", &format!("/{token}")).is_none());
        assert!(grants.registry.lock().unwrap().entries.is_empty());
        Ok(())
    }

    #[test]
    fn teardown_revokes_all_owned_grants_and_rejects_pending_issuance() -> std::io::Result<()> {
        let grants = PreviewGrants::default();
        let fixture = super::super::tests::PreviewFixture::new("teardown")?;
        let owner = || grants.begin("media", "main").unwrap();
        let old = grants.create(owner(), &fixture.path).unwrap();
        let pending = owner();
        grants.revoke_webview("media");
        assert!(grants.resolve("media", &format!("/{old}")).is_none());
        let token = grants.create(owner(), &fixture.path).unwrap();
        assert!(grants.create(pending, &fixture.path).is_err());
        assert!(grants.resolve("media", &format!("/{token}")).is_some());
        let closing = owner();
        grants.revoke_window("main");
        assert!(grants.create(closing, &fixture.path).is_err());
        assert!(grants.resolve("media", &format!("/{token}")).is_none());
        Ok(())
    }
}
