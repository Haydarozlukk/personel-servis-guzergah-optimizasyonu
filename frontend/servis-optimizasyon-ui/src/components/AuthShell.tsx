import { useEffect, useState } from 'react'
import { App } from '../App'
import {
  approveUser,
  deleteUser,
  getCurrentUser,
  listUsers,
  login,
  logout,
  register,
  type CurrentUser,
} from '../lib/api'

export function AuthShell() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [checking, setChecking] = useState(true)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void getCurrentUser().then(setUser).catch((reason) => setError(reason instanceof Error ? reason.message : 'Oturum kontrol edilemedi.')).finally(() => setChecking(false))
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    const data = new FormData(event.currentTarget)
    try {
      if (mode === 'login') {
        setUser(await login(String(data.get('email')), String(data.get('password'))))
      } else {
        await register(String(data.get('email')), String(data.get('displayName')), String(data.get('password')))
        setMessage('Kullanıcınız oluşturuldu. Admin onayından sonra giriş yapabilirsiniz.')
        setMode('login')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'İşlem tamamlanamadı.')
    }
  }

  if (checking) return <div className="op-auth-page"><div className="op-auth-card">Oturum kontrol ediliyor…</div></div>
  if (user) return <App currentUser={user} onLogout={async () => { await logout(); setUser(null) }} />

  return (
    <main className="op-auth-page">
      <section className="op-auth-card">
        <p className="op-kicker">Personel servis planlama</p>
        <h1>{mode === 'login' ? 'Kullanıcı girişi' : 'Kullanıcı oluştur'}</h1>
        <p className="op-auth-copy">Onaylanmış uzmanlar ortak servis sisteminin tamamına erişebilir.</p>
        <div className="op-auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Giriş</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Kullanıcı oluştur</button>
        </div>
        <form className="op-auth-form" onSubmit={(event) => void submit(event)}>
          {mode === 'register' && <label><span>Ad soyad</span><input name="displayName" required autoComplete="name" /></label>}
          <label><span>E-posta</span><input name="email" type="email" required autoComplete="email" /></label>
          <label><span>Parola</span><input name="password" type="password" minLength={10} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          <button className="op-btn op-btn-primary" type="submit">{mode === 'login' ? 'Giriş yap' : 'Onaya gönder'}</button>
        </form>
        {message && <p className="op-auth-success">{message}</p>}
        {error && <p className="op-error-text">{error}</p>}
      </section>
    </main>
  )
}

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<CurrentUser[]>([])
  const [error, setError] = useState('')

  async function refresh() {
    try { setUsers(await listUsers()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Kullanıcılar alınamadı.') }
  }
  useEffect(() => { void refresh() }, [])

  return (
    <div className="op-admin-layer">
      <section className="op-admin-panel op-scroll">
        <header><div><p className="op-kicker">Yalnızca admin</p><h2>Kullanıcı onayları</h2></div><button className="op-close" onClick={onClose}>×</button></header>
        {users.map((item) => <article className="op-admin-user" key={item.id}>
          <div><strong>{item.displayName}</strong><span>{item.email} · {item.status}</span></div>
          <div>
            {item.status === 'pending' && <button className="op-btn op-btn-primary" onClick={async () => { await approveUser(item.id); await refresh() }}>Onayla</button>}
            {item.role !== 'admin' && <button className="op-btn op-btn-secondary" onClick={async () => { if (confirm(`${item.displayName} kullanıcısı silinsin mi?`)) { await deleteUser(item.id); await refresh() } }}>Sil</button>}
          </div>
        </article>)}
        {error && <p className="op-error-text">{error}</p>}
      </section>
    </div>
  )
}
