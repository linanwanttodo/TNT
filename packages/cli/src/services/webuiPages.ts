/**
 * The bootstrap page the browser lands on before it has a cookie. The token
 * lives in the URL fragment, which never reaches the server, so the page
 * reads it and posts it to /webui-session, which sets the cookie; on success
 * it replaces itself with the real app.
 */
export function bootstrapPage(): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>tnt web ui</title></head>
  <body>
    <p id="bootstrap-error" hidden></p>
    <script>
      (function () {
        var token = location.hash.match(/token=([^&]+)/);
        var error = document.getElementById("bootstrap-error");
        if (!token) {
          error.textContent = "Missing token in URL fragment.";
          error.hidden = false;
          return;
        }
        fetch("/webui-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: decodeURIComponent(token[1]) })
        })
          .then(function (response) {
            if (!response.ok) {
              error.textContent = "Token rejected by the server.";
              error.hidden = false;
              return;
            }
            location.replace("/");
          })
          .catch(function (err) {
            error.textContent = String(err && err.message ? err.message : err);
            error.hidden = false;
          });
      })();
    </script>
  </body>
</html>`;
}

/** The page that explains a missing frontend build. */
export function missingDistPage(searched: string[]): string {
  const paths = searched.map((dir) => `<pre>${dir}</pre>`).join("\n    ");
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>tnt web ui</title></head>
  <body>
    <h1>Web UI frontend is missing</h1>
    <p>The server is running, but no frontend build was found at:</p>
    ${paths}
    <p>In a source checkout, build it from packages/cli with
      <code>npm run build:webui</code>, then start <code>/webui</code> again.</p>
    <p>Or point <code>TNT_WEBUI_DIST</code> at a built frontend directory.</p>
  </body>
</html>`;
}
