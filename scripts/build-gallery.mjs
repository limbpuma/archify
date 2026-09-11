#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySiteAssets } from './copy-site-assets.mjs';
import { DIAGRAM_TYPE_LABELS, diagramTypeCopyReplacements } from './site-copy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const skillRoot = path.join(repoRoot, 'archify');
const outputRoot = path.resolve(process.argv[2] || path.join(repoRoot, 'docs'));
const artifactsRoot = path.join(outputRoot, 'gallery', 'artifacts');
const sourcesRoot = path.join(outputRoot, 'gallery', 'sources');
const templatePath = path.join(__dirname, 'gallery-template.html');
const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));

const CASES = [
  {
    id: 'agent-tool-call',
    type: 'workflow',
    input: 'agent-tool-call.workflow.json',
    output: 'agent-tool-call.workflow.html',
    focus: 'planner',
    view: 'happy-path',
    accent: '#67e8f9',
    featured: true,
    titleEn: 'Agent Tool Call',
    titleZh: '智能体工具调用',
    descriptionEn: 'Four consolidated lanes trace a policy-aware agent loop across user interaction, agent runtime, policy and recovery, and tool execution with evidence.',
    descriptionZh: '四条整合泳道呈现策略感知的智能体闭环：用户交互、智能体运行时、策略与恢复，以及带证据的工具执行。',
  },
  {
    id: 'deployment-ownership',
    type: 'architecture',
    input: 'production-deployment.architecture.json',
    output: 'production-deployment.architecture.html',
    focus: 'gateway',
    view: 'request-boundary',
    accent: '#38bdf8',
    titleEn: 'Production Deployment Ownership',
    titleZh: '生产部署与归属',
    descriptionEn: 'Regions, private networks, workload owners, state, cross-region replication, audit evidence, and named boundary crossings.',
    descriptionZh: '展示区域、私有网络、工作负载归属、状态、跨区复制、审计证据和明确的边界穿越。',
  },
  {
    id: 'cache-miss',
    type: 'sequence',
    input: 'cache-miss-request.sequence.json',
    output: 'cache-miss.sequence.html',
    focus: 'redis',
    view: 'cache-fallback',
    accent: '#c4b5fd',
    titleEn: 'Cache Miss Request',
    titleZh: '缓存未命中请求',
    descriptionEn: 'A time-ordered request path covering authentication, cache fallback, persistence, return traffic, and async tracing.',
    descriptionZh: '按时间展开鉴权、缓存回退、持久化、返回流量与异步追踪。',
  },
  {
    id: 'delivery-workflow',
    type: 'workflow',
    input: 'release-delivery.workflow.json',
    output: 'release-delivery.workflow.html',
    focus: 'approval',
    view: 'approval-to-production',
    accent: '#34d399',
    titleEn: 'Release Delivery Workflow',
    titleZh: '研发交付流程',
    descriptionEn: 'A change moves through reproducible build, blocking gates, human approval, canary verification, communication, and rollback.',
    descriptionZh: '一次变更依次经过可复现构建、阻断检查、人工审批、金丝雀验证、沟通和回滚。',
  },
  {
    id: 'incident-runbook',
    type: 'workflow',
    input: 'incident-response.workflow.json',
    output: 'incident-response.workflow.html',
    focus: 'triage',
    view: 'mitigate-and-verify',
    accent: '#fb7185',
    titleEn: 'Incident Response Runbook',
    titleZh: '事故处置 Runbook',
    descriptionEn: 'Detection, incident command, mitigation, stakeholder communication, escalation, rollback, and recovery evidence.',
    descriptionZh: '覆盖发现、事故指挥、缓解、干系人沟通、升级、回滚和恢复证据。',
  },
  {
    id: 'product-analytics',
    type: 'dataflow',
    input: 'product-analytics.dataflow.json',
    output: 'product-analytics.dataflow.html',
    focus: 'consent',
    view: 'consent-boundary',
    accent: '#f6c453',
    titleEn: 'Product Analytics',
    titleZh: '产品分析数据流',
    descriptionEn: 'Events move through consent, streaming, PII isolation, warehouse sync, and governed downstream consumers.',
    descriptionZh: '事件依次经过用户同意、流处理、PII 隔离、数仓同步和受治理的下游消费者。',
  },
  {
    id: 'async-roundtrip',
    type: 'sequence',
    input: 'async-job-roundtrip.sequence.json',
    output: 'async-job-roundtrip.sequence.html',
    focus: 'queue',
    view: 'work-and-retry',
    accent: '#a78bfa',
    titleEn: 'Async Job Roundtrip',
    titleZh: '异步任务往返链路',
    descriptionEn: 'A fast acknowledgement leads into durable queueing, background work, retry, final-state storage, webhook, and polling fallback.',
    descriptionZh: '快速确认后进入持久队列、后台处理、重试、终态存储、Webhook 和轮询回退。',
  },
  {
    id: 'event-stream',
    type: 'dataflow',
    input: 'event-stream.dataflow.json',
    output: 'event-stream.dataflow.html',
    focus: 'orders',
    view: 'order-transit',
    accent: '#fbbf24',
    titleEn: 'Order Event-stream Topology',
    titleZh: '订单事件流拓扑',
    descriptionEn: 'Named producers, partitioned topics, consumer groups, idempotent state, dead letters, operator ownership, and controlled replay.',
    descriptionZh: '展示命名生产者、分区 Topic、消费者组、幂等状态、死信、负责人和受控重放。',
  },
  {
    id: 'agent-run',
    type: 'lifecycle',
    input: 'agent-run.lifecycle.json',
    output: 'agent-run.lifecycle.html',
    focus: 'approval',
    view: 'main-lifecycle',
    accent: '#fb7185',
    titleEn: 'Agent Run Lifecycle',
    titleZh: '智能体运行生命周期',
    descriptionEn: 'Planning, execution, review, human approval, retry, cancellation, and terminal outcomes in one state model.',
    descriptionZh: '用一套状态模型表达规划、执行、复核、人工审批、重试、取消和终态。',
  },
  {
    id: 'deployment-lifecycle',
    type: 'lifecycle',
    input: 'deployment-release.lifecycle.json',
    output: 'deployment-release.lifecycle.html',
    focus: 'live',
    view: 'rollback-outcomes',
    accent: '#f472b6',
    titleEn: 'Deployment Release Lifecycle',
    titleZh: '部署发布生命周期',
    descriptionEn: 'The deployment object moves through build, verification, approval, promotion, health pause, rollback, and explicit terminal outcomes.',
    descriptionZh: '部署对象经过构建、验证、审批、晋级、健康暂停、回滚和明确终态。',
  },
  {
    id: 'web-app',
    type: 'architecture',
    input: 'web-app.architecture.json',
    output: 'web-app.architecture.html',
    focus: 'api',
    view: 'request-path',
    accent: '#6ee7b7',
    titleEn: 'Three-tier Web App',
    titleZh: '三层 Web 应用',
    descriptionEn: 'A classic AWS web stack with edge delivery, authentication, API services, cache, persistence, and background work.',
    descriptionZh: '经典 AWS Web 栈：边缘分发、鉴权、API 服务、缓存、持久化与后台任务。',
  },
  {
    id: 'order-call',
    type: 'flowchart',
    input: 'order-call.flowchart.json',
    output: 'order-call.flowchart.html',
    focus: 'quote',
    view: 'happy-path',
    accent: '#2dd4bf',
    titleEn: 'Phone Order Program Flowchart',
    titleZh: '电话下单程序流程图',
    descriptionEn: 'A DIN 66001 program flowchart of an AI phone agent: announcement, menu, quote loop, idempotent order placement, retry, and three labelled exits.',
    descriptionZh: 'DIN 66001 程序流程图：AI 电话代理的宣告、菜单、报价循环、幂等下单、重试与三个带标注的出口。',
  },
  {
    id: 'order-call-struktogramm',
    type: 'struktogramm',
    input: 'order-call.struktogramm.json',
    output: 'order-call.struktogramm.html',
    focus: 'announce',
    view: 'advise',
    accent: '#14b8a6',
    titleEn: 'Phone Order Struktogramm',
    titleZh: '电话下单结构图',
    descriptionEn: 'A Nassi-Shneiderman diagram (DIN 66261) of the same AI phone agent algorithm: nested boxes, branched if/case, looped until, and explicit exits without arrows.',
    descriptionZh: '同一段 AI 电话代理算法的 Nassi-Shneiderman 结构图（DIN 66261）：嵌套方框、if 与 case 分支、until 循环和显式退出，全程没有箭头。',
  },
  {
    id: 'order-domain',
    type: 'uml-class',
    input: 'order-domain.uml-class.json',
    output: 'order-domain.uml-class.html',
    focus: 'order',
    view: 'ordering',
    accent: '#7c3aed',
    titleEn: 'Phone Order Domain Model',
    titleZh: '电话下单领域模型',
    descriptionEn: 'A UML 2.5 class diagram of the AI phone agent ordering domain: customers, orders, line items, products, categories, fulfillment, delivery, pickup, payment, and the Payable interface.',
    descriptionZh: 'AI 电话代理下单领域的 UML 2.5 类图：客户、订单、订单行、商品、品类、履约、配送、自提、支付，以及 Payable 接口。',
  },
  {
    id: 'order-chen',
    type: 'erd',
    input: 'order-chen.erd.json',
    output: 'erd-order-chen.html',
    focus: 'customer',
    view: 'customers',
    accent: '#0ea5e9',
    titleEn: 'Phone Order ER Model (Chen)',
    titleZh: '电话下单 ER 模型（Chen 记法）',
    descriptionEn: 'A Chen entity-relationship diagram: rectangles for Customer and Order, diamonds for places/contains/refers-to, attribute ellipses with key / derived / multivalued variants, and (min,max) cardinalities at the entity ends.',
    descriptionZh: 'Chen 实体关系图：Customer 与 Order 用矩形，places / contains / refers-to 用菱形，属性椭圆标注 key / derived / multivalued，实体端写出 (min,max) 基数。',
  },
  {
    id: 'order-crowsfoot',
    type: 'erd',
    input: 'order-crowsfoot.erd.json',
    output: 'erd-order-crowsfoot.html',
    focus: 'customer',
    view: 'orders',
    accent: '#0284c7',
    titleEn: 'Phone Order Data Model (Crow\'s Foot)',
    titleZh: '电话下单数据模型（Krähenfuß 记法）',
    descriptionEn: 'An IE crow\'s-foot entity-relationship diagram: Customer, Order, OrderLine, Product and Category boxes list their attributes inline with PK / FK badges; lines carry one / zero-many cardinality glyphs and turn dashed when the relationship is non-identifying.',
    descriptionZh: 'IE Krähenfuß 实体关系图：Customer / Order / OrderLine / Product / Category 用方框列出属性并标注 PK / FK，连线两端带 one / zero-many 基数符号，非标识联系画虚线。',
  },
  {
    id: 'phone-ordering-usecase',
    type: 'usecase',
    input: 'phone-ordering.usecase.json',
    output: 'phone-ordering.usecase.html',
    focus: 'place_order',
    view: 'customer',
    accent: '#6366f1',
    titleEn: 'Phone Ordering Use Cases',
    titleZh: '电话下单用例图',
    descriptionEn: 'A UML use case diagram (Anwendungsfalldiagramm): primary customer and staff actors, secondary payment provider, three include flows, an optional voucher extension, and a repeat-order generalization.',
    descriptionZh: 'UML 用例图（Anwendungsfalldiagramm）：主要参与者客户与店员，次要参与者支付服务，三个 include 子流程，可选的 voucher extend，以及 repeat-order 的泛化关系。',
  },
  {
    id: 'network-plan',
    type: 'netzplan',
    input: 'rollout.netzplan.json',
    output: 'netzplan-rollout.html',
    focus: 'requirements',
    view: 'critical',
    accent: '#4f46e5',
    titleEn: 'Phone Order Rollout Network Plan',
    titleZh: '电话下单上线网络计划',
    descriptionEn: 'An activity-on-node network plan (DIN 69900 / CPM) for the AI phone agent rollout: the renderer computes FAZ/FEZ/SAZ/SEZ and the total and free float, then highlights the critical path from requirements through API v1, telephony and testing to go-live.',
    descriptionZh: 'AI 电话代理上线的单代号网络计划（DIN 69900 / CPM）：渲染器计算 FAZ/FEZ/SAZ/SEZ、总时差与自由时差，并高亮从需求、API v1、电话集成、测试到上线的关键路径。',
  },
  {
    id: 'phone-order',
    type: 'activity',
    input: 'phone-order.activity.json',
    output: 'phone-order.activity.html',
    focus: 'is_open',
    view: 'advise',
    accent: '#0e7490',
    titleEn: 'Phone Order Activity',
    titleZh: '电话下单活动图',
    descriptionEn: 'A UML activity diagram of one phone order with vertical swimlanes for customer, AI agent and kitchen: opening check, quote loop, parallel confirmation and kitchen work, and two explicit terminal states.',
    descriptionZh: '一段电话下单的 UML 活动图：用垂直泳道区分顾客、AI 代理和厨房，包含营业检查、报价循环、确认短信与厨房并行工作，以及两个明确的终态。',
  },
  {
    id: 'phone-order',
    type: 'epk',
    input: 'phone-order.epk.json',
    output: 'epk-phone-order.html',
    focus: 'take_order',
    view: 'intake',
    accent: '#f97316',
    titleEn: 'Phone Order Process Chain',
    titleZh: '电话下单事件驱动过程链',
    descriptionEn: 'An extended event-driven process chain (eEPK) of one phone order: events, functions, an XOR payment decision, an AND split for fulfilment, and organisational units and information objects attached to functions.',
    descriptionZh: '一张电话下单的扩展事件驱动过程链（eEPK）：事件、功能、支付 XOR 决策、履约 AND 分裂，以及挂在功能上的组织单元和信息对象。',
  },
];

const SHAPES = {
  architecture: ['components', 'connections'],
  workflow: ['nodes', 'edges'],
  sequence: ['participants', 'messages'],
  dataflow: ['nodes', 'flows'],
  lifecycle: ['states', 'transitions'],
  flowchart: ['nodes', 'edges'],
  struktogramm: ['blocks', null],
  'uml-class': ['classes', 'relations'],
  erd: ['nodes', 'relations'],
  usecase: ['nodes', 'relations'],
  netzplan: ['activities', 'dependencies'],
  activity: ['nodes', 'edges'],
  epk: ['nodes', 'edges'],
};

// Print-depth type hues shared with the site palette (guide page uses the same map).
const TYPE_ACCENTS = {
  architecture: '#0891b2',
  workflow: '#047857',
  sequence: '#6d28d9',
  dataflow: '#b45309',
  lifecycle: '#be123c',
  flowchart: '#0d9488',
  struktogramm: '#0f766e',
  'uml-class': '#7c3aed',
  erd: '#0ea5e9',
  usecase: '#4f46e5',
  netzplan: '#4f46e5',
  activity: '#0e7490',
  epk: '#ea580c',
};

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function formatBytes(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function renderCard(entry, index) {
  const classes = `showcase-card${entry.featured ? ' is-featured' : ''}`;
  const mode = entry.animation === 'trace' ? `${entry.visualPreset} + trace` : entry.visualPreset;
  const artifact = `gallery/artifacts/${entry.output}`;
  const source = `gallery/sources/${entry.input}`;
  const focusedArtifact = entry.view
    ? `${artifact}?present=1&play=1#view=${encodeURIComponent(entry.view)}`
    : `${artifact}#focus=${encodeURIComponent(entry.focus)}`;
  const exploreEn = entry.view ? 'Play named chapter ↗' : 'Explore focus ↗';
  const exploreZh = entry.view ? '播放命名章节 ↗' : '探索聚焦路径 ↗';
  const engineeringProof = entry.engineeringProfile
    ? `\n              <div class="engineering-proof" aria-label="Engineering profile validation"><span>Engineering profile</span><strong>${esc(entry.engineeringProfile.replaceAll('-', ' ').toUpperCase())} · PASS</strong></div>`
    : '';
  return `          <article class="${classes}" id="proof-${esc(entry.id)}" data-proof-id="${esc(entry.id)}" data-type="${esc(entry.type)}" style="--accent:${esc(TYPE_ACCENTS[entry.type] || entry.accent)}">
            <header class="card-header">
              <div class="card-index">${String(index + 1).padStart(2, '0')}</div>
              <div class="card-title-wrap">
                <div class="card-kicker">${esc(DIAGRAM_TYPE_LABELS.en[entry.type])} / ${entry.nodeCount} nodes${entry.viewCount ? ` / ${entry.viewCount} views · play` : ''}</div>
                <h3 class="card-title" data-en="${esc(entry.titleEn)}" data-zh="${esc(entry.titleZh)}">${esc(entry.titleEn)}</h3>
              </div>
              <div class="card-mode">${esc(mode)}</div>
            </header>
            <div class="preview-shell">
              <div class="live-flag">Live artifact</div>
              <iframe src="${esc(artifact)}?embed=1&amp;theme=dark" data-src-base="${esc(artifact)}" title="${esc(entry.titleEn)} live Archify preview" loading="${entry.featured ? 'eager' : 'lazy'}"></iframe>
            </div>
            <div class="card-body">
              <p class="card-description" data-en="${esc(entry.descriptionEn)}" data-zh="${esc(entry.descriptionZh)}">${esc(entry.descriptionEn)}</p>${engineeringProof}
              <div class="receipt" aria-label="Validation receipt">
                <div class="receipt-cell"><span class="receipt-label">Artifact</span><span class="receipt-value ok">${entry.checksPassed}/${entry.checkCount} pass</span></div>
                <div class="receipt-cell"><span class="receipt-label">Composition</span><span class="receipt-value ${entry.composition.status === 'pass' ? 'ok' : ''}" title="${entry.composition.metrics.properCrossings} crossings · ${entry.composition.metrics.containerBorderRuns} border runs · ${entry.composition.metrics.microSegmentCount} micro segments · ${entry.composition.metrics.shortInteriorSegmentCount} cramped turns">${esc(entry.composition.profile.toUpperCase())} · ${esc(entry.composition.status.toUpperCase())}</span></div>
                <div class="receipt-cell"><span class="receipt-label">Graph</span><span class="receipt-value">${entry.nodeCount}N · ${entry.edgeCount}E</span></div>
                <div class="receipt-cell"><span class="receipt-label">SHA-256</span><span class="receipt-value" title="${esc(entry.artifactSha256)}">${esc(entry.artifactSha256.slice(0, 12))}</span></div>
              </div>
              <div class="card-actions">
                <a class="card-link primary" href="${esc(focusedArtifact)}" target="_blank" rel="noopener" data-en="${esc(exploreEn)}" data-zh="${esc(exploreZh)}">${esc(exploreEn)}</a>
                <a class="card-link" href="${esc(artifact)}" target="_blank" rel="noopener" data-en="Full artifact" data-zh="完整成品">Full artifact</a>
                <a class="card-link" href="${esc(source)}" target="_blank" rel="noopener">JSON IR</a>
                <a class="card-link create-link" href="start.html?type=${esc(entry.type)}&amp;source=gallery" data-en="Create this type" data-zh="按此类型开始">Create this type</a>
              </div>
            </div>
          </article>`;
}

fs.rmSync(artifactsRoot, { recursive: true, force: true });
fs.rmSync(sourcesRoot, { recursive: true, force: true });
fs.mkdirSync(artifactsRoot, { recursive: true });
fs.mkdirSync(sourcesRoot, { recursive: true });

const entries = [];
for (const item of CASES) {
  const inputPath = path.join(skillRoot, 'examples', item.input);
  const sourceBuffer = fs.readFileSync(inputPath);
  const source = JSON.parse(sourceBuffer.toString('utf8'));
  const artifactPath = path.join(artifactsRoot, item.output);
  const sourcePath = path.join(sourcesRoot, item.input);

  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers', item.type, `render-${item.type}.mjs`),
    inputPath,
    artifactPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.copyFileSync(inputPath, sourcePath);

  const checkOutput = execFileSync(process.execPath, [
    path.join(skillRoot, 'scripts', 'check-render-output.mjs'),
    artifactPath,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const validation = JSON.parse(checkOutput);
  const artifactBuffer = fs.readFileSync(artifactPath);
  const [nodeKey, edgeKey] = SHAPES[item.type];
  const checksPassed = validation.checks.filter((check) => check.ok).length;

  entries.push({
    ...item,
    title: source.meta.title,
    subtitle: source.meta.subtitle || '',
    schemaVersion: source.schema_version,
    visualPreset: source.meta.visual_preset || 'classic',
    animation: source.meta.animation || 'static',
    engineeringProfile: source.meta.engineering_profile || null,
    viewCount: Array.isArray(source.meta.views) ? source.meta.views.length : 0,
    viewIds: Array.isArray(source.meta.views) ? source.meta.views.map((view) => view.id) : [],
    nodeCount: Array.isArray(source[nodeKey]) ? source[nodeKey].length : 0,
    edgeCount: Array.isArray(source[edgeKey]) ? source[edgeKey].length : 0,
    artifactBytes: artifactBuffer.byteLength,
    sourceBytes: sourceBuffer.byteLength,
    artifactSha256: digest(artifactBuffer),
    sourceSha256: digest(sourceBuffer),
    checkCount: validation.checks.length,
    checksPassed,
    checks: validation.checks.map((check) => ({ name: check.name, ok: check.ok })),
    composition: validation.composition,
  });
}

const manifest = {
  schemaVersion: 1,
  generator: 'scripts/build-gallery.mjs',
  archifyVersion: packageJson.version,
  entryCount: entries.length,
  checkCount: entries.reduce((sum, entry) => sum + entry.checkCount, 0),
  entries: entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    subtitle: entry.subtitle,
    input: `gallery/sources/${entry.input}`,
    artifact: `gallery/artifacts/${entry.output}`,
    focus: entry.focus,
    view: entry.view || null,
    viewCount: entry.viewCount,
    viewIds: entry.viewIds,
    guidedPlayback: entry.viewCount > 0,
    schemaVersion: entry.schemaVersion,
    visualPreset: entry.visualPreset,
    animation: entry.animation,
    engineeringProfile: entry.engineeringProfile,
    nodeCount: entry.nodeCount,
    edgeCount: entry.edgeCount,
    artifactBytes: entry.artifactBytes,
    artifactSha256: entry.artifactSha256,
    sourceBytes: entry.sourceBytes,
    sourceSha256: entry.sourceSha256,
    checks: entry.checks,
    composition: entry.composition,
  })),
};

const manifestJson = JSON.stringify(manifest, null, 2);
fs.writeFileSync(path.join(outputRoot, 'gallery', 'manifest.json'), `${manifestJson}\n`);

const replacements = {
  ...diagramTypeCopyReplacements(),
  '[[ARCHIFY_VERSION]]': packageJson.version,
  '[[ENTRY_COUNT]]': String(manifest.entryCount),
  '[[CHECK_COUNT]]': String(manifest.checkCount),
  '[[GALLERY_CARDS]]': entries.map(renderCard).join('\n'),
  '[[MANIFEST_JSON]]': manifestJson.replace(/<\/script/gi, '<\\/script'),
};

let html = fs.readFileSync(templatePath, 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) {
  html = html.split(placeholder).join(value);
}
if (/\[\[[A-Z0-9_]+\]\]/.test(html)) {
  throw new Error('Gallery template contains unresolved placeholders');
}
const galleryPath = path.join(outputRoot, 'gallery.html');
copySiteAssets(galleryPath);
fs.writeFileSync(galleryPath, html);

console.log(`gallery ${manifest.entryCount} artifacts / ${manifest.checkCount} checks`);
console.log(path.join(outputRoot, 'gallery.html'));
