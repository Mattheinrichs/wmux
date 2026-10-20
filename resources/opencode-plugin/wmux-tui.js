// wmux-plugin-version: 4
// wmux OpenCode CLI-side (TUI) plugin — the half that runs in the TUI process,
// so a pane is attributable even when the server is remote or shared (#310).
// Installed by `wmux opencode-tui` to <config>/plugins/wmux-cli/tui.js.
// No-ops entirely outside wmux (WMUX !== '1').
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createRoot } from "solid-js";
import { callWmux, createActivityReporter, createBlockedReporter, createPromptReporter, createSessionReporter, eventSessionID, isHostedSession, makeLogger, resolveDebugLog, resolveNodeRuntime, tabSessionIds } from "./core.js";

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

    const send = (argv, done) => callWmux(runtime, argv, log, process.env, process.platform, done);
    const reporter = createSessionReporter({ surface, callWmux: send, log });
    const prompts = createPromptReporter({ callWmux: send, log });
    const blockedState = createBlockedReporter({ surface, callWmux: send, log });
    const activity = createActivityReporter({ surface, callWmux: send, log });
    let currentSession = null;

    /** The root a session belongs to — a viewed subagent is not the pane's run. */
    const rootOf = (id) => {
      try {
        return ctx.data && ctx.data.session && typeof ctx.data.session.root === "function"
          ? ctx.data.session.root(id)
          : id;
      } catch {
        return id;
      }
    };

    // A viewed session is a store read, so the reporter follows navigation
    // reactively — no polling, and no lag behind the tab the user is on. The
    // view can change while a report is in flight; `report-session` is
    // last-writer-wins on main's side, so the newest call settles it.
    const stopRoute = createRoot((dispose) => {
      createEffect(() => {
        try {
          const route = ctx && ctx.ui && ctx.ui.router ? ctx.ui.router.current() : null;
          currentSession = route && route.type === "session" && typeof route.sessionID === "string" ? route.sessionID : null;
          reporter.observe(route, rootOf);
        } catch (err) {
          log("route: threw", (err && err.message) || String(err));
        }
      });
      return dispose;
    });

    // The event stream is the connected server's, which with a shared or
    // remote server also carries other panes' sessions. Only the session this
    // TUI is viewing, or one open in a tab, belongs to this pane.
    const hostedNow = (sessionID) => {
      let tabs = [];
      try {
        if (ctx && ctx.ui && ctx.ui.tabs && typeof ctx.ui.tabs.list === "function") {
          tabs = tabSessionIds(ctx.ui.tabs.list());
        }
      } catch {}
      return isHostedSession(sessionID, { current: currentSession, tabs });
    };

    // Prompt admission (#310 phase 2): `session.inbox.enqueued` is the
    // client-side announcement, and its `user` item carries the text the server
    // half would have read from `session.prompt` (#304). Synthetic, compaction
    // and move items are excluded by the core.
    let stopInbox = () => {};
    try {
      if (ctx && ctx.data && typeof ctx.data.on === "function") {
        stopInbox = ctx.data.on("session.inbox.enqueued", (evt) => {
          try {
            const payload = evt && evt.data;
            prompts.observe(payload, hostedNow(payload && payload.sessionID));
          } catch (err) {
            log("inbox: threw", (err && err.message) || String(err));
          }
        }) || (() => {});
      }
    } catch (err) {
      log("inbox: subscribe failed", (err && err.message) || String(err));
    }

    // Blocked state (#310 phase 3a): the v2 forms and permissions that the
    // server half reports as question/permission asks. Scoped to hosted
    // sessions like prompts; tool and streaming events are deliberately absent
    // — they are not "the human dealt with it" (#189).
    const stopBlocked = [];
    for (const type of [
      "permission.asked",
      "permission.replied",
      "form.created",
      "form.replied",
      "form.cancelled",
      "session.execution.interrupted",
      "session.execution.failed",
    ]) {
      try {
        if (ctx && ctx.data && typeof ctx.data.on === "function") {
          const stop = ctx.data.on(type, (evt) => {
            try {
              const data = evt && evt.data;
              blockedState.observe(type, data, hostedNow(eventSessionID(type, data)));
            } catch (err) {
              log(`blocked: ${type} threw`, (err && err.message) || String(err));
            }
          });
          if (typeof stop === "function") stopBlocked.push(stop);
        }
      } catch (err) {
        log(`blocked: ${type} subscribe failed`, (err && err.message) || String(err));
      }
    }

    // Working/idle (#310 phase 3b): absolute `--run-depth` values from the
    // execution events. An end always clears its session id, even after the
    // view moved — hosting only gates a start.
    const stopActivity = [];
    for (const type of [
      "session.execution.started",
      "session.execution.succeeded",
      "session.execution.failed",
      "session.execution.interrupted",
    ]) {
      try {
        if (ctx && ctx.data && typeof ctx.data.on === "function") {
          const stop = ctx.data.on(type, (evt) => {
            try {
              const data = evt && evt.data;
              activity.observe(type, data, hostedNow(rootOf(eventSessionID(type, data))));
            } catch (err) {
              log(`activity: ${type} threw`, (err && err.message) || String(err));
            }
          });
          if (typeof stop === "function") stopActivity.push(stop);
        }
      } catch (err) {
        log(`activity: ${type} subscribe failed`, (err && err.message) || String(err));
      }
    }

    // Distinct event types only, once each — the diagnostic that answered
    // which event announces a prompt.
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
      try { stopInbox(); } catch {}
      for (const stop of stopBlocked) { try { stop(); } catch {} }
      for (const stop of stopActivity) { try { stop(); } catch {} }
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
