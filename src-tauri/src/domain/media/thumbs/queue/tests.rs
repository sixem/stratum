use std::path::PathBuf;

use super::{ThumbJob, ThumbQueue, ThumbView};
use crate::domain::media::thumbs::{ThumbFormat, ThumbKind, ThumbOptions};

fn job(id: &str) -> ThumbJob {
    ThumbJob {
        id: id.into(),
        path: PathBuf::new(),
        thumb_path: PathBuf::new(),
        key: String::new(),
        signature: String::new(),
        options: ThumbOptions {
            size: 64,
            quality: 80,
            format: ThumbFormat::Webp,
            allow_videos: false,
            allow_svgs: false,
            dark_svg_previews: false,
            cache_mb: 1,
        },
        kind: ThumbKind::Image,
    }
}

#[test]
fn drops_only_jobs_without_a_live_view() {
    let mut queue = ThumbQueue::default();
    let main = queue.open_scope(ThumbView::Main);
    let bottom = queue.open_scope(ThumbView::Bottom);
    let gallery = queue.open_scope(ThumbView::Gallery);

    assert!(queue.enqueue(main, job("main")));
    assert!(queue.enqueue(main, job("shared")));
    assert!(!queue.enqueue(bottom, job("shared")));
    assert!(queue.enqueue(gallery, job("gallery")));

    queue.close_scope(main);
    assert_eq!(queue.items[0].id, "gallery");
    assert_eq!(queue.items[1].id, "shared");
    assert_eq!(queue.items.len(), 2);

    queue.close_scope(bottom);
    assert_eq!(queue.items.len(), 1);
    assert_eq!(queue.items[0].id, "gallery");
}

#[test]
fn stale_requests_and_closes_cannot_replace_a_new_visit() {
    let mut queue = ThumbQueue::default();
    let old = queue.open_scope(ThumbView::Main);
    assert!(queue.enqueue(old, job("revisited")));
    let current = queue.open_scope(ThumbView::Main);

    queue.close_scope(old);
    assert!(!queue.enqueue(old, job("stale")));
    assert!(queue.enqueue(current, job("revisited")));
    assert_eq!(queue.items.len(), 1);
}

#[test]
fn running_job_remains_deduplicated_until_it_finishes() {
    let mut queue = ThumbQueue::default();
    let main = queue.open_scope(ThumbView::Main);
    assert!(queue.enqueue(main, job("running")));
    let running = queue.items.pop_front().unwrap();

    queue.close_scope(main);
    let bottom = queue.open_scope(ThumbView::Bottom);
    assert!(!queue.enqueue(bottom, job("running")));
    assert!(queue.items.is_empty());

    queue.finish(&running);
    assert!(queue.enqueue(bottom, job("running")));
}
