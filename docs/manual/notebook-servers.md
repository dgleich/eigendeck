# Jupyter servers

## The rule

A notebook element in your deck says only **which kernel it needs**
(`python3`, `julia-1.10`, `ir`, ...). The **server URL** and the
**authentication token** live in a per-machine registry — Settings
→ Jupyter servers — and never travel with the deck file.

When the deck renders, eigendeck walks your registry top-to-bottom
and picks the first server whose advertised kernels include the
one the element asked for. Multiple servers offering the same
kernel? Reorder them in Settings to change which one wins.

The topbar shows a single **status pill** that aggregates how the
servers your open deck needs are doing — green if they're all
reachable and recent, yellow if any haven't been seen in a while,
red if some kernel can't be matched at all. Click the pill for
the per-server breakdown and a "Refresh all" button.

## Why this design

Two real problems with the obvious alternative ("store the URL and
token in the deck"):

**URLs aren't portable.** `http://localhost:8888` on your desktop
and `http://localhost:8888` on your laptop are *different machines*.
A deck that hard-codes the URL only works on whichever machine you
wrote it on. The registry indirection lets you keep matching
`label: "Main"` entries on both machines with the right local URL,
and the deck just asks for `python3`.

**Tokens shouldn't be in deck files.** Decks get committed to git,
emailed to collaborators, posted to talk websites. Auth artifacts
in any of those places is a leak — at best it's noise (the
recipient can't reach your `localhost:8888` anyway), at worst it's
a real security issue if your Jupyter server is exposed (running
with `--ServerApp.ip=0.0.0.0`). The registry keeps tokens on the
machine they belong to, full stop.

You can also have multiple machines where the *same* kernel
("`python3`") means different environments. Maybe your laptop runs
Pyodide-flavored CPython and your desktop runs Anaconda with CUDA.
The registry makes that explicit — you pick the server, the deck
just asks for a kernel.

## Workflow

### One-time setup per machine

1. **Open Settings → Jupyter servers.** (Cmd+, on macOS.)
2. **Add server.** Type a label that's meaningful to *you* (`Desktop
   main`, `GPU box`, `conference tunnel`). Paste the base URL
   (e.g. `http://localhost:8888`) and the token (from the terminal
   where you launched Jupyter — or leave empty if you ran with
   `--ServerApp.token=''`).
3. **Test connection.** Confirms the URL + token are valid and
   populates the entry with the kernels the server advertises.
4. **Reorder** if you have multiple servers offering the same
   kernel. The first match wins.

Settings are local-only. Re-do these once on each machine you
present from.

### Starting a token-less Jupyter server

If you don't want to copy a token every session, run with auth
disabled. This is safe **only on localhost** — never on a server
exposed to the network.

```
jupyter server --no-browser --port=8888 \
  --ServerApp.token='' \
  --ServerApp.allow_origin='*' \
  --ServerApp.disable_check_xsrf=True
```

Then in Settings, add a server with that URL and an empty token
field. Connection works without any further copy-pasting.

### Reading the status pill

| Color | Meaning |
|---|---|
| 🟢 green | Every kernel the open deck needs is matched to a server reachable within the last 30 minutes |
| 🟡 yellow | All kernels matched, but at least one server is stale (>30 min since last successful contact). Click "Refresh all" to recheck. |
| 🔴 red | At least one kernel the deck needs has *no matching server* in the registry. Open Settings to add one. |
| (hidden) | Either you're in PresentMode, or the open deck has no notebook elements at all. |

Before a talk: open the deck, glance at the pill — green is the
go signal. Click for the breakdown if you want to confirm which
servers are matched to which kernels.

### Adding a new machine

You sit down at a fresh laptop, install eigendeck, open your
existing deck. Status pill shows red — there are no registered
servers yet. Open Settings → Jupyter servers, add the laptop's
local Jupyter, test, and you're back to green. The deck file
itself didn't change.

### Working through an SSH tunnel

```
# In a terminal, set up the tunnel:
ssh -L 9999:cluster:8888 you@cluster
```

In Settings on your laptop:
- Label: "Cluster via SSH"
- URL: `http://localhost:9999`
- Token: whatever the cluster's Jupyter prints

Run a Jupyter on the cluster the same way you'd run one locally.
The label and notes fields are for *you* — eigendeck only cares
about the URL, token, and kernel list.

## Migration from older decks

Decks saved before this design carried `baseUrl` and `token` on
notebook elements directly. Opening such a deck migrates the
fields automatically: the URL + token are harvested into your
local registry (labeled `Migrated <host:port>`), and the deck's
copy of those fields is stripped on the next save. You don't have
to do anything. Tokens that were previously in a deck file you
already published are still leaked — rotate them on the Jupyter
server side.

## Common pitfalls

- **Adding a server and not testing it.** Without a "Test
  connection" pass, the registry has no `availableKernels` list,
  so the matcher will skip the entry. Always test after adding.
- **Stale entries hiding a real problem.** A server that was
  reachable hours ago shows yellow until you refresh. Yellow
  before a talk is not green — click "Refresh all" in the pill
  dropdown so you know.
- **Multiple servers offering the same kernel, wrong one wins.**
  First-in-the-list wins. Reorder in Settings → Jupyter servers.
- **Trying to put a token on the element via JSON edits.** The
  field doesn't exist on the schema anymore. Add the server to
  the registry instead.

## See also

- `docs/manual/text-sizes.md` — the other deck-level vs
  per-machine settings story.
- `DESIGN_DECISIONS.md` "Preferences cascade" — the formal model
  the deck-level kernel cascade uses (kernel name only; server
  selection is a separate registry lookup, decoupled from the
  cascade).
- `LLM-EDITING.md` — schema reference for `NotebookElement.kernel`
  and `PrefSchema.jupyterServers`.
