// beforeBundleCommand hook (#146): code-sign the bundled pdfium dylib.
//
// Tauri signs the app bundle and its executables, but it treats libpdfium.dylib as a
// data *resource* and never signs it — so it keeps the vendor (bblanchon) signature,
// which is not our Developer ID and has no secure timestamp. Notarization requires
// EVERY Mach-O in the bundle to be Developer-ID signed + hardened + timestamped, so
// the notarize step failed on libpdfium.dylib only ("The binary is not signed with a
// valid Developer ID certificate" / "…does not include a secure timestamp").
//
// This runs after the dylib is downloaded (cargo build / build.rs) and before Tauri
// bundles + signs the .app, so the signed dylib is copied into the bundle and sealed
// by the app signature. No-op unless we're on macOS WITH a signing identity — so local
// dev builds and the Linux/Windows CI jobs are unaffected.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (process.platform !== 'darwin' || !identity) {
  console.log('[sign-pdfium] skipped (not macOS or no APPLE_SIGNING_IDENTITY)');
  process.exit(0);
}

const dylib = 'src-tauri/resources/pdfium/libpdfium.dylib';
if (!existsSync(dylib)) {
  console.log(`[sign-pdfium] ${dylib} not found — nothing to sign`);
  process.exit(0);
}

console.log(`[sign-pdfium] signing ${dylib} with "${identity}"`);
execFileSync('codesign', [
  '--force',
  '--timestamp',            // secure timestamp (notarization requires it)
  '--options', 'runtime',   // hardened runtime (notarization requires it)
  '--sign', identity,
  dylib,
], { stdio: 'inherit' });

// Fail loudly if the result isn't a valid Developer ID signature.
execFileSync('codesign', ['--verify', '--strict', '--verbose=2', dylib], { stdio: 'inherit' });
console.log('[sign-pdfium] done');
