import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidenceDirectory = fileURLToPath(new URL('../docs/acceptance/evidence/', import.meta.url));
const captureEvidence = process.env.CONTENT_STUDIO_E2E_SCREENSHOTS === '1';
const sourceImage = await readFile(fileURLToPath(
  new URL('../public/demo-assets/demo-product-source.png', import.meta.url),
));
const resultImage = await readFile(fileURLToPath(
  new URL('../public/demo-assets/demo-product-emerald.png', import.meta.url),
));

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = join(root, safePath);
    const body = await readFile(filePath).catch(() => readFile(join(root, 'index.html')));
    response.statusCode = 200;
    response.setHeader('content-type', mimeType(filePath));
    response.end(body);
  } catch (error) {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : 'server error');
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('E2E_SERVER_ADDRESS_INVALID');
const origin = `http://127.0.0.1:${address.port}`;

let browser;
try {
  log('launch-browser');
  browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', (error) => process.stderr.write(`[image-mvp-e2e] page-error ${error.message}\n`));
  const api = createStatefulApi();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      await api.handle(route, url.pathname);
      return;
    }
    if (url.pathname === '/e2e-source.png' || url.pathname === '/e2e-result.png') {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: url.pathname === '/e2e-source.png' ? sourceImage : resultImage,
      });
      return;
    }
    await route.continue();
  });

  log('login');
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('邮箱').fill('creator@e2e.test');
  await page.getByLabel('密码').fill('E2E-only-password');
  await page.getByRole('button', { name: '继续' }).click();
  await page.getByLabel('节点画布').waitFor();

  log('create-project');
  await page.getByRole('button', { name: '项目' }).click();
  await page.getByRole('button', { name: '新建项目' }).click();
  const projectDialog = page.getByRole('dialog', { name: '新建项目' });
  await projectDialog.getByLabel('项目名称').fill('图片 MVP E2E');
  await projectDialog.getByRole('button', { name: '创建项目' }).click();
  await page.getByText('图片 MVP E2E', { exact: true }).waitFor();

  log('upload-to-canvas');
  await page.getByRole('button', { name: '上传图片素材' }).click();
  const uploadDialog = page.getByRole('dialog', { name: '上传素材' });
  await uploadDialog.getByLabel('商品名称').fill('E2E 商品图');
  await uploadDialog.getByLabel('SKU 编码').fill('E2E-SKU-001');
  await uploadDialog.getByLabel('素材图片').setInputFiles({
    name: 'e2e-source.png',
    mimeType: 'image/png',
    buffer: sourceImage,
  });
  await uploadDialog.getByRole('button', { name: '确认上传并添加到画布' }).click();
  await page.getByRole('status', { name: '画布操作反馈' })
    .filter({ hasText: '已上传并添加到画布' }).waitFor();

  log('submit-first-job');
  await page.getByRole('button', { name: '生成' }).click();
  const generatePanel = page.getByRole('dialog', { name: '生成参数' });
  await generatePanel.getByLabel('创作描述').fill('干净的白色电商主图');
  await generatePanel.getByRole('button', { name: '1', exact: true }).click();
  await page.waitForFunction(() => {
    const panel = globalThis.document.querySelector('[aria-label="生成参数"]');
    const buttons = Array.from(panel?.querySelectorAll('button') ?? []);
    return buttons.some((button) => (
      button.textContent?.trim() === '1' && button.getAttribute('aria-pressed') === 'true'
    )) && buttons.every((button) => (
      button.textContent?.trim() !== '4' || button.getAttribute('aria-pressed') === 'false'
    ));
  });
  await page.waitForFunction(() => {
    const panel = globalThis.document.querySelector('[aria-label="生成参数"]');
    const buttons = Array.from(panel?.querySelectorAll('button') ?? []);
    const one = buttons.find((button) => button.textContent?.trim() === '1');
    const four = buttons.find((button) => button.textContent?.trim() === '4');
    return Boolean(
      one
      && four
      && globalThis.getComputedStyle(one).backgroundColor.includes('47, 111, 237')
      && !globalThis.getComputedStyle(four).backgroundColor.includes('47, 111, 237'),
    );
  });
  await page.waitForFunction(() => {
    const panel = globalThis.document.querySelector('[aria-label="生成参数"]');
    const sourceNode = Array.from(globalThis.document.querySelectorAll('.react-flow__node'))
      .find((node) => node.querySelector('img[alt="E2E 商品图"]'));
    if (!panel || !sourceNode) return false;
    return sourceNode.getBoundingClientRect().right <= panel.getBoundingClientRect().left - 12;
  });
  if (captureEvidence) {
    await page.screenshot({
      path: join(evidenceDirectory, 'image-mvp-workbench-editor-2026-07-23.png'),
      fullPage: true,
    });
  }
  await generatePanel.getByRole('button', { name: '开始生成' }).click();
  await waitFor(() => api.submitCount === 1 && api.hasRecoverableJob(), 8_000);

  log('refresh-recovery');
  await page.reload({ waitUntil: 'domcontentloaded' });
  api.allowCompletion = true;
  await page.getByAltText('生成 1').waitFor({ timeout: 12_000 });
  if (api.submitCount !== 1) throw new Error(`刷新后重复提交 Fal：${api.submitCount}`);

  log('derive-and-submit-second-job');
  const firstResult = page.getByAltText('生成 1').locator('xpath=..');
  await firstResult.getByRole('button', { name: '继续创作' }).click();
  await page.getByRole('button', { name: '超分' }).click();
  await page.getByRole('dialog', { name: '超分参数' })
    .getByRole('button', { name: '开始生成' }).click();
  await page.getByAltText('超分 1').waitFor({ timeout: 12_000 });

  log('lineage-adoption-review');
  const finalResult = page.getByAltText('超分 1').locator('xpath=..');
  await finalResult.getByRole('button', { name: '采用结果' }).click();
  await finalResult.getByRole('button', { name: '查看结果详情' }).click();
  const inspector = page.getByRole('complementary', { name: '结果详情' });
  await inspector.getByText('E2E 商品图 / v1').waitFor();
  await inspector.getByText('生成 1').waitFor();
  await page.waitForFunction(() => {
    const element = globalThis.document.querySelector('[aria-label="结果详情"]');
    if (!element) return false;
    const styles = globalThis.getComputedStyle(element);
    return styles.opacity === '1' && styles.backgroundColor.includes('0.97');
  });
  const inspectorOwnsTopLayer = await inspector.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const topElement = globalThis.document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return Boolean(topElement && element.contains(topElement));
  });
  if (!inspectorOwnsTopLayer) throw new Error('结果详情被画布节点遮挡');
  if (captureEvidence) {
    await page.screenshot({
      path: join(evidenceDirectory, 'image-mvp-result-lineage-2026-07-23.png'),
      fullPage: true,
    });
  }
  await inspector.getByRole('button', { name: '关闭结果详情' }).click();
  await finalResult.getByRole('button', { name: '提交审核' }).click();

  log('approve-and-export');
  await page.getByRole('button', { name: '审核', exact: true }).click();
  await page.getByRole('button', { name: '通过审核' }).click();
  await page.getByRole('button', { name: '生成生产导出' }).click();
  await page.getByRole('status').filter({ hasText: '已生成 3 个交付文件' }).waitFor({ timeout: 12_000 });

  log('usage-ledger');
  await page.getByRole('button', { name: '用量', exact: true }).click();
  await page.getByText('任务 01 · 生成').waitFor();
  await page.getByText('任务 02 · 超分').waitFor();
  if (api.submitCount !== 2) throw new Error(`任务提交数量异常：${api.submitCount}`);

  process.stdout.write(JSON.stringify({
    status: 'pass',
    project: '图片 MVP E2E',
    falSubmissions: api.submitCount,
    refreshRecovered: true,
    generatedResults: 2,
  }) + '\n');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

function createStatefulApi() {
  let loggedIn = false;
  let revision = 0;
  let statusCalls = 0;
  const snapshots = new Map();
  const projects = [project('project-seed', '默认图片项目')];
  const api = {
    allowCompletion: false,
    submitCount: 0,
    hasRecoverableJob() {
      return Array.from(snapshots.values()).some((snapshot) => (
        snapshot.state.jobs.some((job) => Boolean(job.externalExecution))
      ));
    },
    async handle(route, pathname) {
      const request = route.request();
      const method = request.method();
      const activeProjectId = request.headers()['x-content-studio-project-id'] ?? 'project-seed';

      if (pathname === '/api/auth/session' && method === 'GET') {
        if (!loggedIn) return route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED', message: '请登录' } } });
        return route.fulfill({ status: 200, json: authPayload(projects.map((item) => item.id)) });
      }
      if (pathname === '/api/auth/login' && method === 'POST') {
        loggedIn = true;
        return route.fulfill({ status: 200, json: {
          status: 'authenticated', expiresAt: '2099-01-01T00:00:00.000Z',
          ...authPayload(projects.map((item) => item.id)),
        } });
      }
      if (pathname === '/api/organization/projects' && method === 'GET') {
        return route.fulfill({ status: 200, json: { projects } });
      }
      if (pathname === '/api/organization/projects' && method === 'POST') {
        const input = request.postDataJSON();
        const created = project('project-image-e2e', input.name, input);
        projects.unshift(created);
        return route.fulfill({ status: 201, json: { project: created } });
      }
      if (pathname === '/api/studio/state' && method === 'GET') {
        const snapshot = snapshots.get(activeProjectId);
        return snapshot
          ? route.fulfill({ status: 200, json: snapshot })
          : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: '暂无状态' } } });
      }
      if (pathname === '/api/studio/state' && method === 'PUT') {
        const input = request.postDataJSON();
        revision += 1;
        const snapshot = {
          schemaVersion: 1,
          revision,
          updatedAt: new Date().toISOString(),
          state: input.state,
        };
        snapshots.set(activeProjectId, snapshot);
        return route.fulfill({ status: 200, json: snapshot });
      }
      if (pathname === '/api/assets/images' && method === 'POST') {
        return route.fulfill({ status: 201, json: {
          imageUrl: '/e2e-source.png', contentType: 'image/png', byteLength: sourceImage.byteLength,
        } });
      }
      if (pathname === '/api/fal/jobs' && method === 'POST') {
        api.submitCount += 1;
        return route.fulfill({ status: 202, json: {
          requestId: `fal-e2e-${api.submitCount}`, modelId: 'provider-test-double',
        } });
      }
      if (/^\/api\/fal\/jobs\/[^/]+\/status$/.test(pathname) && method === 'GET') {
        statusCalls += 1;
        const completed = api.allowCompletion;
        return route.fulfill({ status: 200, json: {
          status: completed ? 'completed' : 'running',
          logs: [],
          progress: completed ? 94 : Math.min(88, 30 + statusCalls * 8),
        } });
      }
      if (/^\/api\/fal\/jobs\/[^/]+\/result$/.test(pathname) && method === 'GET') {
        return route.fulfill({ status: 200, json: {
          images: [{ url: '/e2e-result.png', width: 1024, height: 1024 }],
          seed: 42,
          modelId: 'provider-test-double',
          childRequestIds: [`child-${api.submitCount}`],
        } });
      }
      if (/^\/api\/fal\/jobs\/[^/]+$/.test(pathname) && method === 'DELETE') {
        return route.fulfill({ status: 200, json: { canceled: true } });
      }
      return route.fulfill({ status: 404, json: { error: { code: 'E2E_ROUTE_MISSING', message: pathname } } });
    },
  };
  return api;
}

function authPayload(projectIds) {
  return {
    user: {
      id: 'user-e2e-owner', tenantId: 'tenant-e2e', email: 'creator@e2e.test',
      displayName: 'E2E Owner', role: 'owner', projectIds, mfaEnabled: true,
    },
  };
}

function project(id, name, input = {}) {
  return {
    id, tenantId: 'tenant-e2e', name,
    defaultBrand: input.defaultBrand ?? '', defaultSku: input.defaultSku ?? '',
    ownerUserId: 'user-e2e-owner', reviewRequired: input.reviewRequired ?? true,
    status: 'active', createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('E2E_WAIT_TIMEOUT');
}

function mimeType(pathname) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.json': 'application/json; charset=utf-8',
  })[extname(pathname)] ?? 'application/octet-stream';
}

function log(step) {
  process.stdout.write(`[image-mvp-e2e] ${step}\n`);
}
