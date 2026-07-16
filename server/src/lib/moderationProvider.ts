import { ims } from 'tencentcloud-sdk-nodejs-ims';
import { tms } from 'tencentcloud-sdk-nodejs-tms';
import { env } from '../env';
import { readLocalUpload } from './localUploads';

/**
 * AI 审核 provider：腾讯云内容安全（天御）。TMS 审文本、IMS 审图片，
 * 拦截粗俗/色情/涉政等违规内容。未配置凭证时 getReviewer() 返回 null，
 * 调用方保持 pending 走人工队列。
 */

/** 统一的待审内容：文本片段 + 图片（COS 公网 URL 或 /api/uploads/local/ 路径）。 */
export interface ModerationInput {
  texts: string[];
  images: string[];
}

/** 与 DB 字段 aiVerdict/aiReason/aiConfidence 对应的审核结论。 */
export interface ModerationResult {
  verdict: 'approve' | 'reject' | 'uncertain';
  /** 一句中文说明，驳回理由会展示给提交者。 */
  reason: string;
  /** 0~1 的判断置信度。 */
  confidence: number;
}

export type Reviewer = (input: ModerationInput) => Promise<ModerationResult>;

/** 单条 TMS/IMS 返回归一化后的形状，供 mergeVerdicts 合并（纯函数，便于单测）。 */
export interface PartVerdict {
  source: 'text' | 'image';
  suggestion: 'Pass' | 'Review' | 'Block';
  /** 天御一级标签：Normal/Porn/Abuse/Polity/Ad/Illegal… */
  label: string;
  /** 命中的关键词（文本）或二级标签（图片）。 */
  detail?: string;
  /** 当前标签下的置信度 0~100。 */
  score: number;
}

const LABEL_ZH: Record<string, string> = {
  Normal: '正常',
  Porn: '色情',
  Sexy: '低俗性感',
  Moan: '低俗',
  Abuse: '辱骂',
  Ad: '广告导流',
  Illegal: '违法违规',
  Polity: '涉政',
  Political: '涉政',
  Terror: '暴恐',
  Terrorism: '暴恐',
};

function describe(p: PartVerdict): string {
  const label = LABEL_ZH[p.label] ?? (p.label || '违规');
  const src = p.source === 'text' ? '文本' : '图片';
  return p.detail ? `${src}命中「${label}」：${p.detail}` : `${src}命中「${label}」`;
}

/** 合并多条 TMS/IMS 结果：任一 Block → reject；否则任一 Review → uncertain；全 Pass → approve。 */
export function mergeVerdicts(parts: PartVerdict[]): ModerationResult {
  const block = parts.find((p) => p.suggestion === 'Block');
  if (block) return { verdict: 'reject', reason: describe(block), confidence: block.score / 100 };
  const review = parts.find((p) => p.suggestion === 'Review');
  if (review) return { verdict: 'uncertain', reason: describe(review), confidence: review.score / 100 };
  // Pass 时 Score 是"属于该标签"的置信度：Normal 标签越高越正常，非 Normal 标签取补。
  const confidence = parts.length
    ? Math.min(...parts.map((p) => (p.label === 'Normal' || !p.label ? p.score || 100 : 100 - p.score))) / 100
    : 1;
  return { verdict: 'approve', reason: '未发现违规内容', confidence };
}

/** 凭证每次调用时读 process.env（而非 env.ts 的解析快照），测试可在运行期开关。 */
function credentials(): { secretId: string; secretKey: string } | null {
  const secretId = process.env.TENCENT_MODERATION_SECRET_ID;
  const secretKey = process.env.TENCENT_MODERATION_SECRET_KEY;
  return secretId && secretKey ? { secretId, secretKey } : null;
}

type TmsClient = InstanceType<typeof tms.v20201229.Client>;
type ImsClient = InstanceType<typeof ims.v20201229.Client>;

let tmsClient: TmsClient | null = null;
let imsClient: ImsClient | null = null;

// reqTimeout 单位为秒：10s 超时让后台审核任务有界；失败即保持 pending 走人工。
function clientConfig() {
  const cred = credentials()!;
  return {
    credential: cred,
    region: env.TENCENT_MODERATION_REGION,
    profile: { httpProfile: { reqTimeout: 10 } },
  };
}

function getTms(): TmsClient {
  tmsClient ??= new tms.v20201229.Client(clientConfig());
  return tmsClient;
}

function getIms(): ImsClient {
  imsClient ??= new ims.v20201229.Client(clientConfig());
  return imsClient;
}

async function moderateText(content: string): Promise<PartVerdict> {
  const res = await getTms().TextModeration({
    Content: Buffer.from(content, 'utf8').toString('base64'),
    ...(env.TENCENT_TMS_BIZTYPE ? { BizType: env.TENCENT_TMS_BIZTYPE } : {}),
  });
  return {
    source: 'text',
    suggestion: (res.Suggestion as PartVerdict['suggestion']) ?? 'Review',
    label: res.Label ?? '',
    detail: res.Keywords?.length ? res.Keywords.join('、') : undefined,
    score: res.Score ?? 0,
  };
}

const LOCAL_URL_PREFIX = '/api/uploads/local/';

/** COS 公网 URL 用 FileUrl 让天御自取；本地盘回落时读文件转 base64。 */
async function imageSource(url: string): Promise<{ FileUrl: string } | { FileContent: string }> {
  if (url.startsWith(LOCAL_URL_PREFIX)) {
    const buf = await readLocalUpload(url.slice(LOCAL_URL_PREFIX.length));
    return { FileContent: buf.toString('base64') };
  }
  return { FileUrl: url };
}

async function moderateImage(url: string): Promise<PartVerdict> {
  const res = await getIms().ImageModeration({
    ...(await imageSource(url)),
    ...(env.TENCENT_IMS_BIZTYPE ? { BizType: env.TENCENT_IMS_BIZTYPE } : {}),
  });
  return {
    source: 'image',
    suggestion: (res.Suggestion as PartVerdict['suggestion']) ?? 'Review',
    label: res.Label ?? '',
    detail: res.SubLabel || undefined,
    score: res.Score ?? 0,
  };
}

// 每次 IMS 调用只审 1 张图（评价最多 9 图并发送审，演示规模远低于默认限频）。
const tencentReviewer: Reviewer = async (input) => {
  const texts = input.texts.map((t) => t.trim()).filter(Boolean);
  const tasks: Promise<PartVerdict>[] = [];
  if (texts.length) tasks.push(moderateText(texts.join('\n')));
  tasks.push(...input.images.map(moderateImage));
  return mergeVerdicts(await Promise.all(tasks));
};

/** 测试钩子：注入假 reviewer（非 null 时绕过凭证检查）。 */
let injectedReviewer: Reviewer | null = null;

export function __setReviewer(fn: Reviewer | null): void {
  injectedReviewer = fn;
}

/** 未配置凭证时返回 null：调用方保持 pending，交由人工审核。 */
export function getReviewer(): Reviewer | null {
  if (injectedReviewer) return injectedReviewer;
  return credentials() ? tencentReviewer : null;
}

/**
 * 同步文本审核（注册用户名等阻塞路径用）：未配置凭证/超时/报错返回 null，
 * 调用方 fail-open 放行——绝不因审核不可用阻塞注册。
 */
export async function moderateTextSync(
  text: string,
  timeoutMs = 3000,
): Promise<ModerationResult | null> {
  const reviewer = getReviewer();
  if (!reviewer) return null;
  try {
    return await Promise.race([
      reviewer({ texts: [text], images: [] }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}
