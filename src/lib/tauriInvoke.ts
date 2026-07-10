// Thin wrapper around Tauri's `invoke` that lazy-imports the core module, no-ops
// off Tauri, and swallows errors — collapses the repeated
// `import('@tauri-apps/api/core').then(({invoke}) => invoke(...)).catch(()=>{})`
// boilerplate (esp. the native-toolbar bridge effects in App.tsx).
export async function invokeSafe<T = void>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}
