import { useEffect, useState } from 'react'
import { AuthApiError, loginStudent, normalizeAuthRetryAfterSeconds, registerStudent, resetStudentPassword, sendVerificationCode } from '../../api/auth-client'
import { AuthActions, AuthCard, AuthField, AuthForm, AuthMessage, AuthPhoneField, useResendCountdown, validCode, validPassword, validPhone } from '../auth/AuthForm'

export type AccountAccessMode = 'login' | 'register' | 'reset'

const PASSWORD_LENGTH_ERROR = '密码长度须为8—72个字节。'
const PASSWORD_LENGTH_HELP = '密码长度须为8—72个字节；中文及部分特殊字符可能占用多个字节，建议使用英文字母、数字和符号。'

export function AccountAccessPanel({ initialMode = 'login', onAuthenticated }: {
  initialMode?: AccountAccessMode
  onAuthenticated: (registered?: boolean) => void | Promise<void>
}) {
  const [mode, setMode] = useState<AccountAccessMode>(initialMode)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const countdown = useResendCountdown()
  const retryCountdown = useResendCountdown()

  const handleError = (caught: unknown, fallback: string) => {
    if (caught instanceof AuthApiError && ['RATE_LIMITED', 'VERIFICATION_RATE_LIMITED', 'LOGIN_RATE_LIMITED'].includes(caught.code)) {
      const seconds = caught.retryAfterSeconds ?? normalizeAuthRetryAfterSeconds(undefined)
      retryCountdown.start(seconds)
      setError(`请求较为集中，请在${seconds}秒后重试。`)
      return
    }
    setError(caught instanceof Error ? caught.message : fallback)
  }

  useEffect(() => { setMode(initialMode); setStep(1); setError(''); setMessage('') }, [initialMode])
  const switchMode = (next: AccountAccessMode) => { setMode(next); setStep(1); setCode(''); setPassword(''); setConfirmation(''); setError(''); setMessage('') }
  const sendCode = async (purpose: 'register' | 'reset_password') => {
    if (pending) return
    if (!validPhone(phone)) { setError('请输入有效的中国大陆手机号'); return }
    setPending(true); setError(''); setMessage('')
    try {
      await sendVerificationCode(phone, purpose)
      setMessage('验证码请求已受理。')
      countdown.start(); setStep(2)
    }
    catch (caught) { handleError(caught, '验证码发送失败，请稍后重试') }
    finally { setPending(false) }
  }
  const login = async () => {
    if (!validPhone(phone)) { setError('请输入有效的中国大陆手机号'); return }
    if (!validPassword(password)) { setError(PASSWORD_LENGTH_ERROR); return }
    setPending(true); setError('')
    try { await loginStudent(phone, password) }
    catch (caught) { handleError(caught, '登录失败，请稍后重试'); setPending(false); return }
    setMessage('登录成功，正在加载个人中心。')
    try { await onAuthenticated() }
    catch { setError('登录成功，个人中心暂时无法加载。请稍后刷新页面。') }
    finally { setPending(false) }
  }
  const createAccount = async () => {
    if (!validCode(code)) { setError('请输入6位数字验证码'); return }
    if (!validPassword(password)) { setError(PASSWORD_LENGTH_ERROR); return }
    if (password !== confirmation) { setError('两次输入的密码不一致'); return }
    setPending(true); setError('')
    try { await registerStudent(phone, code, password) }
    catch (caught) { handleError(caught, '注册失败，请稍后重试'); setPending(false); return }
    setMessage('账号已创建，请完善基础信息。')
    try { await onAuthenticated(true) }
    catch { setError('账号已创建，基础信息暂时无法加载。请稍后登录个人中心继续填写。') }
    finally { setPending(false) }
  }
  const resetPassword = async () => {
    if (!validCode(code)) { setError('请输入6位数字验证码'); return }
    if (!validPassword(password)) { setError(PASSWORD_LENGTH_ERROR); return }
    if (password !== confirmation) { setError('两次输入的密码不一致'); return }
    setPending(true); setError('')
    try { await resetStudentPassword(phone, code, password); setMessage('密码已重置，请使用新密码登录。'); setMode('login'); setStep(1); setPassword(''); setConfirmation(''); setCode('') }
    catch (caught) { handleError(caught, '密码重置失败，请稍后重试') }
    finally { setPending(false) }
  }

  const title = mode === 'login' ? '登录个人中心' : mode === 'register' ? '注册账号' : '重置密码'
  return <AuthCard title={title}>
    <div className="account-access-switch" role="tablist" aria-label="账号操作">
      <button aria-selected={mode === 'login'} onClick={() => switchMode('login')} role="tab" type="button">登录</button>
      <button aria-selected={mode === 'register'} onClick={() => switchMode('register')} role="tab" type="button">注册账号</button>
      <button aria-selected={mode === 'reset'} onClick={() => switchMode('reset')} role="tab" type="button">忘记密码</button>
    </div>
    <AuthForm onSubmit={(event) => {
      event.preventDefault()
      if (mode === 'login') void login()
      else if (step === 1) void sendCode(mode === 'register' ? 'register' : 'reset_password')
      else if (step === 2 && mode === 'register') { if (validCode(code)) { setError(''); setStep(3) } else setError('请输入6位数字验证码') }
      else if (mode === 'register') void createAccount()
      else void resetPassword()
    }}>
      <AuthPhoneField autoComplete="tel" disabled={mode !== 'login' && step > 1} inputMode="tel" value={phone.replace(/^\+86/u, '')} onChange={(event) => setPhone(event.target.value.replace(/\D/gu, '').slice(0, 11))} />
      {mode === 'login' ? <>
        <AuthField label="密码" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <AuthActions><button disabled={pending || retryCountdown.seconds > 0} type="submit">{retryCountdown.seconds > 0 ? `请稍后重试（${retryCountdown.seconds}秒）` : pending ? '正在登录' : '登录'}</button></AuthActions>
      </> : null}
      {mode !== 'login' && step === 1 ? <AuthActions><button disabled={pending || retryCountdown.seconds > 0} type="submit">{retryCountdown.seconds > 0 ? `请稍后重试（${retryCountdown.seconds}秒）` : pending ? '正在发送' : '获取验证码'}</button></AuthActions> : null}
      {mode !== 'login' && step >= 2 ? <>
        <AuthField label="验证码" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
        {mode === 'register' && step === 2 ? <AuthActions><button disabled={pending || countdown.seconds > 0} onClick={() => void sendCode('register')} type="button">{countdown.seconds > 0 ? `重新发送（${countdown.seconds}秒）` : '重新发送'}</button><button type="submit">下一步</button></AuthActions> : null}
        {mode === 'reset' || step === 3 ? <>
          <AuthField label={mode === 'reset' ? '新密码' : '设置密码'} autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <AuthField label={mode === 'reset' ? '确认新密码' : '确认密码'} autoComplete="new-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          <p className="auth-help">{PASSWORD_LENGTH_HELP}</p>
          <AuthActions><button disabled={pending || retryCountdown.seconds > 0 || (mode === 'reset' && countdown.seconds > 0)} onClick={mode === 'reset' ? () => void sendCode('reset_password') : () => setStep(2)} type="button">{retryCountdown.seconds > 0 ? `请稍后重试（${retryCountdown.seconds}秒）` : mode === 'reset' && countdown.seconds > 0 ? `重新发送（${countdown.seconds}秒）` : mode === 'reset' ? '重新发送' : '返回'}</button><button disabled={pending || retryCountdown.seconds > 0} type="submit">{retryCountdown.seconds > 0 ? `请稍后重试（${retryCountdown.seconds}秒）` : mode === 'register' ? '创建账号并完善基础信息' : '重置密码'}</button></AuthActions>
        </> : null}
      </> : null}
      {error ? <AuthMessage kind="error">{error}</AuthMessage> : null}
      {message ? <AuthMessage kind="status">{message}</AuthMessage> : null}
    </AuthForm>
  </AuthCard>
}

