/**
 * 本地 GitHub 通路代理（CONNECT 隧道）。
 *
 * 为什么需要它：这台机器解析到的 `github.com` 是 `20.205.243.166`，
 * 而那个地址的 443 是**黑洞**（curl 5/5 超时、git 3/3 失败）；
 * 换成 `140.82.112.4` / `20.27.177.113` 立刻 200。
 * 也就是「域名->IP」这一步被污染了，而别的地址是通的。
 *
 * 这个东西只做一件事：把到 `github.com:443` 的 TCP 连接改接到一个可用 IP，
 * 其余域名照常解析；不做 TLS 终止、不看内容（TLS 端到端仍然是 git/gh 直连 GitHub，
 * 证书校验照旧生效）。
 *
 * 用它（不改系统配置，关掉进程即失效）：
 *
 * ```powershell
 * node scripts/local-github-proxy.mjs 8787          # 前台运行，或放后台
 * $env:HTTPS_PROXY='http://127.0.0.1:8787'          # gh 认这个变量
 * git -c http.proxy=http://127.0.0.1:8787 push      # git 用它
 * ```
 *
 * 前置检查：`curl.exe -x http://127.0.0.1:8787 -sS -o NUL -w "%{http_code}" https://github.com`
 * 应输出 200。
 */
import net from 'node:net';

const PORT = Number(process.argv[2] ?? 8787);
const CONNECT_TIMEOUT_MS = 4000;

/** 被污染的域名 → 候选 IP（按顺序试，谁先连上就用谁）。 */
const PINNED = new Map([
  ['github.com', ['20.27.177.113', '140.82.112.4', '140.82.113.4']],
  ['codeload.github.com', ['20.27.177.113', '140.82.112.4']],
  ['api.github.com', ['20.27.177.113', '140.82.112.5']],
  ['objects.githubusercontent.com', ['185.199.108.133', '185.199.109.133']],
  ['raw.githubusercontent.com', ['185.199.108.133', '185.199.109.133']],
]);

/** 依次尝试候选 IP，返回第一个连上的 socket。 */
function connectPinned(host, port, candidates, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let index = 0;
    const attempt = () => {
      if (index >= candidates.length) {
        reject(new Error(`所有候选 IP 都连不上：${candidates.join(', ')}`));
        return;
      }
      const ip = candidates[index++];
      const socket = net.connect({ host: ip, port });
      const timer = setTimeout(() => {
        socket.destroy();
        attempt();
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        clearTimeout(overall);
        resolve({ socket, ip });
      });
      socket.once('error', () => {
        clearTimeout(timer);
        attempt();
      });
    };
    // 兜底：整体别超过候选数 × 超时
    const overall = setTimeout(() => reject(new Error('连接超时')), timeoutMs * candidates.length + 1000);
    attempt();
  });
}

const server = net.createServer((client) => {
  client.once('error', () => client.destroy());
  let buffer = '';

  const onData = (chunk) => {
    buffer += chunk.toString('latin1');
    const headerEnd = buffer.indexOf('\r\n\r\n');
    const lineEnd = buffer.indexOf('\r\n');
    if (lineEnd === -1) return;

    const [method, target] = buffer.slice(0, lineEnd).split(' ');
    if (method !== 'CONNECT') {
      // 这个代理只为 HTTPS 隧道服务：别的请求明确拒绝，不要悄悄放行
      client.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n');
      return;
    }
    client.removeListener('data', onData);
    if (headerEnd !== -1) buffer = buffer.slice(headerEnd + 4);

    const [host, portText] = target.split(':');
    const port = Number(portText ?? 443);
    const candidates = PINNED.get(host);

    const upstream = candidates
      ? connectPinned(host, port, candidates)
      : new Promise((resolve, reject) => {
          const socket = net.connect({ host, port });
          socket.once('connect', () => resolve({ socket, ip: host }));
          socket.once('error', reject);
        });

    upstream
      .then(({ socket, ip }) => {
        console.log(`CONNECT ${host}:${port} → ${ip}`);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (buffer) socket.write(buffer);
        socket.pipe(client);
        client.pipe(socket);
        const close = () => {
          socket.destroy();
          client.destroy();
        };
        socket.on('error', close);
        client.on('error', close);
        socket.on('close', () => client.destroy());
      })
      .catch((error) => {
        console.log(`CONNECT ${host}:${port} 失败：${error.message}`);
        client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      });
  };

  client.on('data', onData);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`GitHub 通路代理已启动：http://127.0.0.1:${PORT}`);
  console.log(`钉住的域名：${[...PINNED.keys()].join(', ')}`);
});
