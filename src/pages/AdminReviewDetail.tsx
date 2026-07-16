import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  ModerationItemDetailDto,
  ModerationRestaurantDetailDto,
  ModerationUserReviewDetailDto,
} from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { assetUrl } from '../lib/assetUrl';
import { AI_VERDICT_BADGE, STATUS_BADGE } from '../lib/reviewBadges';

type Detail = ModerationRestaurantDetailDto | ModerationItemDetailDto | ModerationUserReviewDetailDto;

interface Props {
  targetType: 'restaurant' | 'menuItem' | 'review';
}

/** 路由参数 :id 对店铺/菜品是 restaurantId，对评价是 reviewId。 */
function fetchPathFor(targetType: Props['targetType'], id: string, itemId?: string): string {
  if (targetType === 'review') return `/admin/reviews/${id}`;
  return targetType === 'restaurant' ? `/admin/restaurants/${id}` : `/admin/restaurants/${id}/items/${itemId}`;
}

export default function AdminReviewDetail({ targetType }: Props) {
  const { id, itemId } = useParams<{ id: string; itemId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const { data, loading, error } = useApi<Detail>(fetchPathFor(targetType, id!, itemId));

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 'default' key = 直接打开的深链，没有可回退的历史，只能显式跳列表
  const goBack = () =>
    location.key === 'default' ? navigate('/admin/review', { replace: true }) : navigate(-1);

  const review = async (decision: 'approved' | 'rejected', reason?: string) => {
    const reviewPath =
      targetType === 'review'
        ? `/admin/reviews/${id}/review`
        : targetType === 'restaurant'
          ? `/admin/restaurants/${id}/review`
          : `/admin/restaurants/${id}/items/${itemId}/review`;
    setSubmitting(true);
    try {
      await api.post(reviewPath, { decision, ...(reason ? { reason } : {}) });
      goBack();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '操作失败，请稍后重试');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
        <div className="px-4 pt-10 space-y-3">
          <div className="bg-white dark:bg-gray-800 rounded-2xl h-40 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10 flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-gray-400 dark:text-gray-500">{error ?? '该内容不存在或已变更'}</p>
        <button className="text-orange-500 text-sm" onClick={goBack}>
          返回列表
        </button>
      </div>
    );
  }

  const badge = STATUS_BADGE[data.reviewStatus];
  const emoji =
    data.targetType === 'restaurant' ? data.restaurant.emoji : data.targetType === 'menuItem' ? data.item.emoji : '💬';
  const name =
    data.targetType === 'restaurant'
      ? data.restaurant.name
      : data.targetType === 'menuItem'
        ? data.item.name
        : `${data.review.username} 的评价`;

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-28">
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
        <button
          className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
          onClick={goBack}
        >
          ←
        </button>
        <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg truncate">
          {emoji} {name}
        </h1>
      </div>

      {message && (
        <p className="text-center text-xs text-orange-500 py-2 bg-orange-50 dark:bg-orange-500/10">{message}</p>
      )}

      <div className="px-4 pt-4 space-y-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 space-y-2">
          <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
            {badge.label}
          </span>

          {data.targetType === 'restaurant' ? (
            <>
              <p className="text-sm text-gray-900 dark:text-gray-100">品类：{data.restaurant.category}</p>
              {data.restaurant.tags.length > 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  标签：{data.restaurant.tags.join(' / ')}
                </p>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                色值：
                <span
                  className="inline-block w-4 h-4 rounded-full border border-gray-200 dark:border-gray-700"
                  style={{ backgroundColor: data.restaurant.bgColor }}
                />
                {data.restaurant.bgColor}
              </div>
              {data.restaurant.bannerImage && (
                <img
                  src={assetUrl(data.restaurant.bannerImage)}
                  alt="横幅"
                  className="w-full h-32 object-cover rounded-xl"
                />
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                配送费 ¥{data.restaurant.deliveryFee} · 起送 ¥{data.restaurant.minOrder} · 约
                {data.restaurant.deliveryTime}分钟
              </p>
              {data.restaurant.menuCategories.length > 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  菜单分类：{data.restaurant.menuCategories.join(' / ')}
                </p>
              )}
            </>
          ) : data.targetType === 'review' ? (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400">所属店铺：{data.restaurantName}</p>
              <p className="text-sm text-orange-500">
                {'★'.repeat(data.review.rating)}
                <span className="text-gray-300 dark:text-gray-600">{'★'.repeat(5 - data.review.rating)}</span>
                <span className="text-gray-500 dark:text-gray-400 ml-1">{data.review.rating}星</span>
              </p>
              {data.review.content && (
                <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{data.review.content}</p>
              )}
              {data.review.photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {data.review.photos.map((photo) => (
                    <img
                      key={photo}
                      src={assetUrl(photo)}
                      alt="评价图片"
                      className="w-full aspect-square object-cover rounded-xl"
                    />
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500">
                发布时间:{new Date(data.review.createdAt).toLocaleString('zh-CN')}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400">所属店铺：{data.restaurantName}</p>
              {data.item.description && (
                <p className="text-sm text-gray-900 dark:text-gray-100">{data.item.description}</p>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                ¥{data.item.price} · {data.item.calories}kcal · {data.item.menuCategory}
                {data.item.popular ? ' · 人气' : ''}
              </p>
              {data.item.image && (
                <img
                  src={assetUrl(data.item.image)}
                  alt={data.item.name}
                  className="w-32 h-32 object-cover rounded-xl"
                />
              )}
              {data.item.optionGroups?.map((group) => (
                <div key={group.id} className="text-sm text-gray-500 dark:text-gray-400">
                  {group.name}（{group.selectionType === 'single' ? '单选' : '多选'}）：
                  {group.options.map((o) => `${o.name}${o.priceDelta ? `+¥${o.priceDelta}` : ''}`).join('、')}
                </div>
              ))}
            </>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500">
            发布者：{data.ownerUsername ?? '平台'}
            {data.reviewedBy && ` · 审核人：${data.reviewedBy === 'ai' ? 'AI' : data.reviewedBy}`}
          </p>
          {data.reviewedAt && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              审核时间：{new Date(data.reviewedAt).toLocaleString('zh-CN')}
            </p>
          )}
          {data.reviewStatus === 'rejected' && data.rejectReason && (
            <p className="text-red-500 text-xs">驳回原因：{data.rejectReason}</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 space-y-2">
          <p className="font-bold text-sm text-gray-900 dark:text-gray-100">🤖 AI 审核建议</p>
          {data.aiVerdict ? (
            <>
              <span
                className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${AI_VERDICT_BADGE[data.aiVerdict].className}`}
              >
                {AI_VERDICT_BADGE[data.aiVerdict].label}
                {data.aiConfidence != null && ` · ${Math.round(data.aiConfidence * 100)}%`}
              </span>
              <p className="text-sm text-gray-500 dark:text-gray-400">{data.aiReason}</p>
            </>
          ) : (
            <span className="inline-block text-xs px-2 py-0.5 rounded-full font-medium text-gray-500 bg-gray-100 dark:bg-gray-700">
              AI 审核：未接入
            </span>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 app-container bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 p-4">
        {rejecting ? (
          <div className="space-y-2">
            <input
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-400 text-sm"
              placeholder="填写驳回原因（将展示给发布者）"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-2.5 rounded-xl text-sm"
                onClick={() => {
                  setRejecting(false);
                  setRejectReason('');
                }}
              >
                取消
              </button>
              <button
                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                disabled={submitting || !rejectReason.trim()}
                onClick={() => review('rejected', rejectReason.trim())}
              >
                {submitting ? '提交中…' : '确认驳回'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {data.reviewStatus !== 'rejected' && (
              <button
                className="flex-1 border border-red-200 dark:border-red-500/30 text-red-500 py-2.5 rounded-xl text-sm disabled:opacity-50"
                disabled={submitting}
                onClick={() => {
                  setRejecting(true);
                  setRejectReason('');
                }}
              >
                驳回
              </button>
            )}
            {data.reviewStatus !== 'approved' && (
              <button
                className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                disabled={submitting}
                onClick={() => review('approved')}
              >
                {submitting ? '提交中…' : '通过'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
