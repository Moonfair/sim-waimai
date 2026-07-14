import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CaptchaChallenge } from '@sim-waimai/shared';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

interface Props {
  mode: 'login' | 'register';
}

export default function AuthForm({ mode }: Props) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') ?? '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === 'login';
  const title = isLogin ? '登录' : '注册';

  const refreshCaptcha = () => {
    setCaptchaAnswer('');
    api
      .get<CaptchaChallenge>('/auth/captcha')
      .then(setCaptcha)
      .catch(() => setCaptcha(null));
  };

  useEffect(() => {
    if (!isLogin) refreshCaptcha();
  }, [isLogin]);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!isLogin && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(username.trim(), password);
      } else {
        if (!captcha) throw new Error('验证码加载失败，请重试');
        await register(username.trim(), password, captcha.token, Number(captchaAnswer));
      }
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后重试');
      if (!isLogin) refreshCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm';

  return (
    <div className="app-container min-h-screen">
      <div className="bg-orange-500 pt-10 pb-8 px-4 relative">
        <button
          className="absolute top-10 left-4 w-9 h-9 bg-white/20 rounded-full flex items-center justify-center text-white"
          onClick={() => navigate(-1)}
          aria-label="返回"
        >
          ←
        </button>
        <div className="text-center">
          <div className="text-5xl">🥡</div>
          <h1 className="text-white text-2xl font-black mt-2">吃了嘛外卖</h1>
          <p className="text-orange-100 text-xs mt-1">{title}后开启省钱省卡路里之旅</p>
        </div>
      </div>

      <form className="px-6 mt-4" onSubmit={handleSubmit}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-3">
          <h2 className="text-gray-800 dark:text-gray-100 font-bold text-lg">{title}</h2>
          <input
            className={inputClass}
            placeholder="用户名（3-20个字符）"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className={inputClass}
            type="password"
            placeholder="密码（至少6位）"
            value={password}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
          {!isLogin && (
            <input
              className={inputClass}
              type="password"
              placeholder="确认密码"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          {!isLogin && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                验证：{captcha ? `${captcha.question} =` : '加载中…'}
              </span>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="请输入结果"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-red-500 text-xs px-1">{error}</p>}
          <button
            type="submit"
            disabled={
              submitting || !username || !password || (!isLogin && (!captcha || !captchaAnswer))
            }
            className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {submitting ? `${title}中…` : title}
          </button>
        </div>

        <p className="text-center text-sm text-gray-400 dark:text-gray-500 mt-4">
          {isLogin ? (
            <>
              还没有账号？
              <Link className="text-orange-500 font-medium" to={`/register?redirect=${encodeURIComponent(redirect)}`}>
                去注册
              </Link>
            </>
          ) : (
            <>
              已有账号？
              <Link className="text-orange-500 font-medium" to={`/login?redirect=${encodeURIComponent(redirect)}`}>
                去登录
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
