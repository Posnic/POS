/* A signed extension's presentation runs in an opaque-origin frame. The
 * parent owns authentication, URLs and command transport; no session token,
 * Node API or privileged DOM reference is sent to the extension. */
(function (host) {
  "use strict";
  var methods = new Set([
    "bootstrap",
    "closeWorkspace",
    "state",
    "catalogue",
    "command",
    "recover",
    "receipt",
    "sales",
    "salesReport",
    "exportReport",
  ]);
  function mount(options) {
    var container = options.container,
      view = options.view;
    if (
      !container ||
      typeof options.request !== "function" ||
      !/^[a-z][a-z0-9.-]{2,99}$/.test(options.extensionId || "") ||
      !view ||
      ["html", "css", "script"].some(function (key) {
        return typeof view[key] !== "string" || view[key].length > 1024 * 1024;
      })
    )
      throw new Error("Invalid extension page");
    var frame = document.createElement("iframe");
    var channel = new MessageChannel(),
      port = channel.port1;
    var closed = false,
      pending = new Set();
    var nonce = crypto.randomUUID().replace(/-/g, "");
    frame.title = options.title || "Extension";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.style.cssText = "width:100%;min-height:420px;border:0;display:block";
    function resizeFrame() {
      if (!closed) {
        frame.style.minHeight = options.presentation === "compact" ? "0" : "420px";
        frame.style.height = (options.presentation === "compact" ? Math.min(480, window.innerHeight * 0.78) : Math.max(420, window.innerHeight - frame.getBoundingClientRect().top - 12)) + "px";
      }
    }
    window.addEventListener("resize", resizeFrame);
    function reply(value) {
      if (!closed) port.postMessage(value);
    }
    port.onmessage = async function (event) {
      var message = event.data;
      if (
        closed ||
        !message ||
        typeof message !== "object" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(message.id || "") ||
        pending.has(message.id)
      )
        return;
      try {
        if (
          !methods.has(message.method) ||
          pending.size >= 8 ||
          new TextEncoder().encode(JSON.stringify(message)).length > 65536
        )
          throw new Error("Unsupported extension request");
        pending.add(message.id);
        var result = await options.request(message.method, message.input || {});
        reply({ id: message.id, ok: true, result: result });
      } catch (error) {
        reply({
          id: message.id,
          ok: false,
          error: {
            code:
              typeof error.code === "string"
                ? error.code
                : "EXTENSION_REQUEST_FAILED",
            message: String(
              error.message || "The request could not be completed.",
            ).slice(0, 500),
          },
        });
      } finally {
        pending.delete(message.id);
      }
    };
    port.start();
    frame.addEventListener(
      "load",
      function () {
        if (!closed)
          frame.contentWindow.postMessage(
            {
              type: "posnic-extension-connect",
              extensionId: options.extensionId,
            },
            "*",
            [channel.port2],
          );
      },
      { once: true },
    );
    var policy =
      "default-src 'none'; script-src 'nonce-" +
      nonce +
      "'; style-src 'nonce-" +
      nonce +
      "'; img-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    frame.srcdoc =
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="' +
      policy.replace(/"/g, "&quot;") +
      '">' +
      '<style nonce="' +
      nonce +
      '">' +
      view.css.replace(/<\/style/gi, "<\\/style") +
      '</style></head><body' + (options.presentation === 'compact' ? ' class="compact-checkout"' : '') + '>' +
      view.html +
      '<script nonce="' +
      nonce +
      '">' +
      view.script.replace(/<\/script/gi, "<\\/script") +
      "</script></body></html>";
    container.replaceChildren(frame);
    resizeFrame();
    return {
      frame: frame,
      destroy: function () {
        closed = true;
        window.removeEventListener("resize", resizeFrame);
        port.close();
        channel.port2.close();
        pending.clear();
        frame.remove();
      },
    };
  }
  host.PosnicExtensionFrame = { mount: mount };
})(window);
