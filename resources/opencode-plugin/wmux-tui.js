// wmux-plugin-version: 1
// wmux OpenCode CLI-side (TUI) plugin — the half that runs in the TUI process,
// so a pane is attributable even when the server is remote or shared (#310).
// Installed by `wmux opencode-tui` to <config>/plugins/wmux-cli/tui.js.
// No-ops entirely outside wmux (WMUX !== '1').
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createRoot } from "solid-js";
import { callWmux, createSessionReporter, makeLogger, resolveDebugLog, resolveNodeRuntime } from "./core.js";

export default Plugin.define({
  id: "wmux.cli",
  setup(ctx) {
    // Resolved before the WMUX gate so "the plugin loaded but did nothing" is
    // itself a visible log line — otherwise the commonest failure is silence.
    const log = makeLogger(resolveDebugLog(process.env.WMUX_PLUGIN_DEBUG));
    const surface = process.env.WMUX_SURFACE_ID;
    if (process.env.WMUX !== "1" || !surface) {
      log("init: inactive", { WMUX: process.env.WMUX, surface });
      return;
    }

    const runtime = resolveNodeRuntime();
    log("init", {
      surface,
      runtime: runtime.file,
      cli: process.env.WMUX_CLI,
      pid: process.pid,
    });

    const send = (argv) => callWmux(runtime, argv, log);
    const reporter = createSessionReporter({ surface, callWmux: send, log });

    // A viewed session is a store read, so the reporter follows navigation
    // reactively — no polling, and no lag behind the tab the user is on. The
    // view can change while a report is in flight; `report-session` is
    // last-writer-wins on main's side, so the newest call settles it.
    const stopRoute = createRoot((dispose) => {
      createEffect(() => {
        try {
          const route = ctx && ctx.ui && ctx.ui.router ? ctx.ui.router.current() : null;
          reporter.observe(route, (id) => {
            try {
              return ctx.data && ctx.data.session && typeof ctx.data.session.root === "function"
                ? ctx.data.session.root(id)
                : id;
            } catch {
              return id;
            }
          });
        } catch (err) {
          log("route: threw", (err && err.message) || String(err));
        }
      });
      return dispose;
    });

    // Distinct event types only, once each. The prompt log's TUI-side capture
    // (issue #310 phase 2) needs to know which client-side event announces a
    // submitted prompt; this is the one-pass diagnostic that answers it.
    let stopEvents = () => {};
    try {
      if (ctx && ctx.data && typeof ctx.data.listen === "function") {
        const seen = new Set();
        stopEvents = ctx.data.listen((payload) => {
          const type = payload && payload.details && payload.details.type;
          if (type && !seen.has(type)) {
            seen.add(type);
            log("event", type);
          }
        }) || (() => {});
      }
    } catch (err) {
      log("events: hook failed", (err && err.message) || String(err));
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reporter.dispose();
      try { stopEvents(); } catch {}
      try { stopRoute(); } catch {}
    };
    // Both exits: v2 disposes plugins on a clean shutdown, but `opencode run`
    // has been seen to neither exit nor dispose cleanly (#290), so the exit
    // hook is the backstop the server half also carries.
    process.once("exit", release);
    return release;
  },
});
