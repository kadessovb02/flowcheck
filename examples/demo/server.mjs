import http from 'node:http';

const port = Number(process.env.PORT ?? 4173);
const broken = process.env.FLOWCHECK_DEMO_BROKEN === '1';
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FlowCheck demo</title>
  <style>
    :root { font: 16px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; color: #18181b; background: #fafafa; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { width: min(440px, calc(100% - 32px)); padding: 32px; border: 1px solid #e4e4e7; border-radius: 16px; background: white; box-shadow: 0 12px 40px #18181b0d; }
    h1 { margin: 0 0 8px; letter-spacing: -.03em; }
    p { color: #71717a; }
    label { display: block; margin: 18px 0 6px; font-size: 13px; font-weight: 650; }
    input, button { width: 100%; height: 44px; border-radius: 9px; font: inherit; }
    input { padding: 0 12px; border: 1px solid #d4d4d8; }
    button { margin-top: 22px; border: 0; color: white; background: #18181b; font-weight: 700; cursor: pointer; }
    #result { margin-top: 20px; padding: 14px; border-radius: 9px; color: #166534; background: #f0fdf4; }
  </style>
</head>
<body>
  <main>
    <h1>FlowCheck demo</h1>
    <p>Create a workspace to verify the local runner end to end.</p>
    <form id="workspace-form">
      <label for="email">Work email</label>
      <input id="email" type="email" autocomplete="email" required>
      <label for="company">Company name</label>
      <input id="company" required>
      <button type="submit">Create workspace</button>
    </form>
    <div id="result" role="status" hidden></div>
  </main>
  <script>
    document.querySelector('#workspace-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const company = document.querySelector('#company').value;
      const result = document.querySelector('#result');
      if (${broken}) {
        result.textContent = 'Workspace creation failed. Please try again.';
        result.style.color = '#991b1b';
        result.style.background = '#fef2f2';
        result.hidden = false;
        return;
      }
      result.textContent = 'Workspace ' + company + ' is ready';
      result.hidden = false;
      history.pushState({}, '', '/welcome');
    });
  </script>
</body>
</html>`;

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  if (request.url !== '/' && request.url !== '/welcome') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});

server.listen(port, '127.0.0.1', () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.stdout.write(`Demo: ${origin}\n`);
  process.send?.({ origin });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
