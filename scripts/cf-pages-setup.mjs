/**
 * 用 Cloudflare API 建 Pages 项目（Git 连接版）。
 *
 * 为什么不用 `wrangler pages project create`：那个命令只能建「直传」项目，
 * 而**直传项目事后无法再连 Git 仓库** —— 那就拿不到「push 自动重建」，
 * 也就不算「用 Cloudflare 镜像 GitHub 仓库」。
 * Git 源只能在 Dashboard 或 API 里配，所以这里走 API。
 *
 * 令牌从 wrangler 的 OAuth 配置里读（即 `wrangler login` 拿到的那个），
 * **不打印、不落盘**。
 *
 * 用法：
 *   node scripts/cf-pages-setup.mjs inspect                  # 看现有项目的 source 结构
 *   node scripts/cf-pages-setup.mjs create <owner> <repo> <项目名> [生产分支]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), '.config'),
  'xdg.config',
  '.wrangler',
  'config',
  'default.toml',
);

/** 从 wrangler 配置里取 OAuth 令牌（只取用，不输出）。 */
function readToken() {
  if (!fs.existsSync(CONFIG)) throw new Error(`找不到 wrangler 配置：${CONFIG}（先跑 npx wrangler login）`);
  const text = fs.readFileSync(CONFIG, 'utf8');
  const oauth = /oauth_token\s*=\s*"([^"]+)"/.exec(text);
  if (oauth) return oauth[1];
  const apiToken = /api_token\s*=\s*"([^"]+)"/.exec(text);
  if (apiToken) return apiToken[1];
  throw new Error('配置里没有 oauth_token / api_token');
}

const token = readToken();

async function api(method, url, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { ok: res.ok, status: res.status, json };
}

const [command, ownerArg, repoArg, nameArg, branchArg] = process.argv.slice(2);
const BRANCH = branchArg ?? 'main';

const accounts = await api('GET', '/accounts');
if (!accounts.ok) throw new Error(`取账号失败：${accounts.status} ${JSON.stringify(accounts.json.errors)}`);
const account = accounts.json.result[0];
const accountId = account.id;
console.log(`账号：${account.name}（${accountId}）`);

if (command === 'inspect') {
  const list = await api('GET', `/accounts/${accountId}/pages/projects`);
  if (!list.ok) throw new Error(`取项目列表失败：${list.status}`);
  for (const project of list.json.result) {
    const source = project.source ?? null;
    console.log(`\n项目 ${project.name}`);
    console.log(`  域名        ${project.domains?.join(', ')}`);
    console.log(`  生产分支    ${project.production_branch}`);
    console.log(`  source.type ${source?.type ?? '（无，直传项目）'}`);
    if (source?.config) {
      const c = source.config;
      console.log(
        `  source.config owner=${c.owner} repo=${c.repo_name} branch=${c.production_branch} ` +
          `deployments_enabled=${c.deployments_enabled} preview=${c.preview_deployment_setting} ` +
          `installation=${c.github_installation_id ? '有' : '无（由 Cloudflare 侧关联）'}`,
      );
    }
  }
  process.exit(0);
}

if (command === 'create') {
  if (!ownerArg || !repoArg || !nameArg) {
    throw new Error('用法：create <owner> <repo> <项目名> [生产分支]');
  }
  const body = {
    name: nameArg,
    production_branch: BRANCH,
    // 显式写构建配置，不依赖「框架自动识别」——识别结果会随 Cloudflare 侧变化，
    // 而这三项就是仓库 README 里承诺的那三条命令/目录。
    build_config: {
      build_command: 'npm run build',
      destination_dir: 'dist',
      root_dir: '',
      build_caching: true,
    },
    source: {
      type: 'github',
      config: {
        owner: ownerArg,
        repo_name: repoArg,
        production_branch: BRANCH,
        deployments_enabled: true,
        production_deployments_enabled: true,
        preview_deployment_setting: 'all',
        pr_comments_enabled: false,
      },
    },
  };
  const created = await api('POST', `/accounts/${accountId}/pages/projects`, body);
  if (!created.ok) {
    console.error(`创建失败（HTTP ${created.status}）：`);
    console.error(JSON.stringify(created.json.errors ?? created.json, null, 2));
    process.exit(1);
  }
  const p = created.json.result;
  console.log(`已创建 Pages 项目：${p.name}`);
  console.log(`  域名        ${p.domains?.join(', ')}`);
  console.log(`  生产分支    ${p.production_branch}`);
  console.log(`  Git 源      ${p.source?.config?.owner}/${p.source?.config?.repo_name}`);
  console.log('\nCloudflare 应该会立刻从仓库触发一次构建；稍后可用下方命令看部署：');
  console.log(`  npx wrangler pages deployment list --project-name ${p.name}`);
  process.exit(0);
}

console.log('用法：node scripts/cf-pages-setup.mjs inspect | create <owner> <repo> <项目名> [分支]');
