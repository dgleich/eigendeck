//! Perf bench for the server-side PDF downscale pipeline. Runs the
//! same image-crate code path as `db_downscale_asset_cache` in
//! storage.rs, but against synthetic PNGs at representative sizes
//! (matching what 1920² PDF page renders produce).
//!
//! Run with:
//!   cd src-tauri && cargo test --release --test bench_downscale -- --nocapture
//!
//! `--release` matters — the image crate's decode + resize is
//! ~5-10× slower in debug due to bounds checks + no SIMD inlining.

use image::{ImageBuffer, Rgba, RgbaImage};
use std::time::Instant;

/// Build a synthetic RGBA image at (w, h). The content is a gradient
/// with diagonal stripes — non-uniform enough that PNG compression
/// produces a realistic file size (similar to what a PDF page render
/// looks like in entropy).
fn synthetic_image(w: u32, h: u32) -> RgbaImage {
    ImageBuffer::from_fn(w, h, |x, y| {
        let r = ((x * 255 / w) ^ (y * 7)) as u8;
        let g = ((y * 255 / h) ^ (x * 11)) as u8;
        let b = (((x + y) * 13) % 256) as u8;
        // Mostly opaque, a few transparent diagonal stripes to make the
        // alpha channel non-trivial.
        let a = if (x + y) % 40 < 3 { 0 } else { 255 };
        Rgba([r, g, b, a])
    })
}

fn encode_png(img: &RgbaImage) -> Vec<u8> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;
    let mut out = Vec::new();
    let encoder = PngEncoder::new_with_quality(
        &mut out,
        CompressionType::Default,
        FilterType::NoFilter,
    );
    encoder
        .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgba8)
        .expect("encode");
    out
}

/// One full pipeline run mirroring db_downscale_asset_cache:
/// decode source PNG → resize to (target_w, target_h) preserving
/// aspect → re-encode PNG. Returns per-step timings (decode, resize,
/// encode) and output size.
fn run_pipeline(src_png: &[u8], target_w: u32, target_h: u32) -> (u128, u128, u128, usize) {
    let t0 = Instant::now();
    let img = image::load_from_memory_with_format(src_png, image::ImageFormat::Png)
        .expect("decode");
    let decode_us = t0.elapsed().as_micros();

    let t1 = Instant::now();
    let resized = img.resize(target_w, target_h, image::imageops::FilterType::Triangle);
    let resize_us = t1.elapsed().as_micros();

    let t2 = Instant::now();
    let out_png = encode_png(&resized.to_rgba8());
    let encode_us = t2.elapsed().as_micros();

    (decode_us, resize_us, encode_us, out_png.len())
}

#[test]
#[ignore = "run with `cargo test --release --test bench_downscale -- --ignored --nocapture` for perf numbers"]
fn bench_downscale_pipeline() {
    // Source sizes representative of what 1920² PDF renders produce.
    // Sample five points covering the typical band.
    let source_sizes = [
        (1920u32, 1920u32, "1920² (FULL tier)"),
        (1280, 1280, "1280² (typical promoted)"),
        (1024, 1024, "1024² (small-element promoted)"),
        (512, 512,   "512²  (sub-tier)"),
        (256, 256,   "256²  (sidebar thumb)"),
    ];
    let target_w = 256u32;
    let target_h = 256u32;
    let iterations = 3;

    println!();
    println!("=== PDF downscale pipeline (image crate, Triangle filter) ===");
    println!("Target: {}×{} (sidebar-thumb tier)", target_w, target_h);
    println!("Iterations: {} per source (median reported)", iterations);
    println!();
    println!("{:<28} {:>10} {:>10} {:>10} {:>10} {:>12}",
        "source", "src KB", "decode", "resize", "encode", "TOTAL");
    println!("{}", "-".repeat(85));

    for &(w, h, label) in &source_sizes {
        // Build source image + PNG once (encoding cost not counted).
        let src_img = synthetic_image(w, h);
        let src_png = encode_png(&src_img);

        // Run N iterations; take the median.
        let mut runs: Vec<(u128, u128, u128, usize)> = (0..iterations)
            .map(|_| run_pipeline(&src_png, target_w, target_h))
            .collect();
        runs.sort_by_key(|r| r.0 + r.1 + r.2);  // sort by total
        let (decode, resize, encode, out_size) = runs[iterations / 2];

        println!(
            "{:<28} {:>9} {:>9.1}ms {:>9.1}ms {:>9.1}ms {:>10.1}ms",
            label,
            src_png.len() / 1024,
            decode as f64 / 1000.0,
            resize as f64 / 1000.0,
            encode as f64 / 1000.0,
            (decode + resize + encode) as f64 / 1000.0,
        );
        // Sanity: target output is small.
        assert!(out_size > 100, "encoded output should be non-trivial");
    }
    println!();
    println!("(Output PNG is ~{}×{} — small, fast encode)", target_w, target_h);
}
