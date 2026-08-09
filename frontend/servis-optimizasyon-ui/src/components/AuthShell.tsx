import { useEffect, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { App } from '../App'
import {
  adminAddUser,
  approveUser,
  deleteUser,
  getCurrentUser,
  listUsers,
  login,
  logout,
  type CurrentUser,
} from '../lib/api'

export function AuthShell() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'planner' | 'admin'>('planner')

  useEffect(() => {
    void getCurrentUser()
      .then((u) => {
        setUser(u)
        if (u?.role === 'admin') {
          setActiveTab('admin')
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Oturum kontrol edilemedi.'))
      .finally(() => setChecking(false))
  }, [])

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const data = new FormData(event.currentTarget)
    try {
      const loggedUser = await login(String(data.get('email')), String(data.get('password')))
      setUser(loggedUser)
      if (loggedUser.role === 'admin') {
        setActiveTab('admin')
      } else {
        setActiveTab('planner')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Giriş başarısız. Lütfen bilgilerinizi kontrol edin.')
    }
  }

  async function handleLogout() {
    await logout()
    setUser(null)
    setActiveTab('planner')
  }

  if (checking) {
    return (
      <div className="op-auth-page">
        <div className="op-auth-card">Oturum kontrol ediliyor…</div>
      </div>
    )
  }

  if (user) {
    return (
      <div className="op-app-container">
        {user.role === 'admin' && (
          <header className="op-admin-top-nav">
            <div className="op-admin-nav-brand">
              <strong>Personel Servis Optimizasyonu</strong>
              <span className="op-badge-admin">Admin Yetkisi</span>
            </div>
            <nav className="op-admin-nav-tabs">
              <button
                type="button"
                className={`op-nav-tab ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => setActiveTab('admin')}
              >
                👥 Admin Paneli (Kullanıcı Yönetimi)
              </button>
              <button
                type="button"
                className={`op-nav-tab ${activeTab === 'planner' ? 'active' : ''}`}
                onClick={() => setActiveTab('planner')}
              >
                🗺️ Servis Planlama Ekranı
              </button>
            </nav>
            <div className="op-admin-nav-user">
              <span>{user.displayName} ({user.email})</span>
              <button type="button" className="op-btn op-btn-secondary op-btn-small" onClick={() => void handleLogout()}>
                Çıkış Yap
              </button>
            </div>
          </header>
        )}

        {user.role === 'admin' && activeTab === 'admin' ? (
          <AdminPanel currentUser={user} />
        ) : (
          <App onLogout={handleLogout} />
        )}
      </div>
    )
  }

  return (
    <main className="op-login-page">
      {/* Background Leaflet Map */}
      <div className="op-login-map-bg">
        <MapContainer
          center={[39.9334, 32.8597]}
          zoom={12}
          zoomControl={false}
          scrollWheelZoom={false}
          dragging={false}
          doubleClickZoom={false}
          preferCanvas
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </MapContainer>
      </div>

      {/* Floating Login Window on Left Side */}
      <aside className="op-login-sidebar">
        <div className="op-login-card-content">
          <div className="op-login-brand">
            <span className="op-login-badge">Servis Planlama Portalı</span>
            <h1>Personel Servis Optimizasyonu</h1>
            <p className="op-login-subtitle">
              Sisteme erişmek için e-posta ve parolanızla giriş yapın.
            </p>
          </div>

          <form className="op-auth-form" onSubmit={(event) => void handleLogin(event)}>
            <label>
              <span>E-posta Adresi</span>
              <input name="email" type="email" required autoComplete="email" placeholder="ornek@kurum.com" />
            </label>
            <label>
              <span>Parola</span>
              <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
            </label>
            <button className="op-btn op-btn-primary op-auth-submit" style={{ marginTop: '.4rem' }} type="submit">
              Giriş Yap
            </button>
          </form>

          {error && <div className="op-admin-alert error">{error}</div>}
        </div>
      </aside>
    </main>
  )
}

export function AdminPanel({ currentUser }: { currentUser: CurrentUser }) {
  const [users, setUsers] = useState<CurrentUser[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function refresh() {
    try {
      setUsers(await listUsers())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Kullanıcılar alınamadı.')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleAddUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    const displayName = String(data.get('displayName') ?? '').trim()
    const password = String(data.get('password') ?? '')
    const role = String(data.get('role') ?? 'expert')

    try {
      const created = await adminAddUser(email, displayName, password, role)
      setSuccess(`"${created.displayName}" (${created.email}) kullanıcısı başarıyla eklendi!`)
      form.reset()
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Kullanıcı eklenemedi.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteUser(userToDelete: CurrentUser) {
    if (userToDelete.id === currentUser.id) {
      alert('Kendi hesabınızı silemezsiniz.')
      return
    }
    if (confirm(`"${userToDelete.displayName}" (${userToDelete.email}) kullanıcısını silmek istediğinize emin misiniz?`)) {
      try {
        await deleteUser(userToDelete.id)
        setSuccess(`"${userToDelete.displayName}" kullanıcısı silindi.`)
        await refresh()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Kullanıcı silinemedi.')
      }
    }
  }

  return (
    <main className="op-admin-panel-page">
      <div className="op-admin-container">
        <div className="op-admin-page-header">
          <div>
            <p className="op-kicker">Yalnızca Admin Yetkisi</p>
            <h2>Admin Paneli — Kullanıcı Yönetimi</h2>
            <p className="op-admin-subtitle">Sisteme yeni kullanıcı ekleyebilir veya mevcut kullanıcıları çıkarabilirsiniz.</p>
          </div>
        </div>

        {success && <div className="op-admin-alert success">{success}</div>}
        {error && <div className="op-admin-alert error">{error}</div>}

        <div className="op-admin-grid">
          {/* Card 1: Add User */}
          <section className="op-admin-card">
            <h3>+ Yeni Kullanıcı Ekle</h3>
            <form className="op-admin-form" onSubmit={(e) => void handleAddUser(e)}>
              <label>
                <span>Ad Soyad</span>
                <input name="displayName" required placeholder="Ahmet Yılmaz" autoComplete="off" />
              </label>
              <label>
                <span>E-posta</span>
                <input name="email" type="email" required placeholder="ahmet@kurum.com" autoComplete="off" />
              </label>
              <label>
                <span>Parola (en az 10 karakter)</span>
                <input name="password" type="password" minLength={10} required placeholder="••••••••••" autoComplete="off" />
              </label>
              <label>
                <span>Kullanıcı Rolü</span>
                <select name="role" defaultValue="expert">
                  <option value="expert">Uzman (Planlama Yetkili)</option>
                  <option value="admin">Yönetici (Admin)</option>
                </select>
              </label>
              <button className="op-btn op-btn-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Ekleniyor…' : '+ Kullanıcı Oluştur'}
              </button>
            </form>
          </section>

          {/* Card 2: User List */}
          <section className="op-admin-card">
            <h3>Sistem Kullanıcıları ({users.length})</h3>
            <div className="op-admin-user-list">
              {users.map((item) => (
                <div className="op-admin-user-item" key={item.id}>
                  <div className="op-admin-user-info">
                    <strong>{item.displayName}</strong>
                    <span className="op-admin-user-email">{item.email}</span>
                    <span className="op-admin-user-tags">
                      <span className={`op-tag role-${item.role}`}>{item.role === 'admin' ? 'Yönetici' : 'Uzman'}</span>
                      <span className={`op-tag status-${item.status}`}>{item.status === 'approved' ? 'Onaylı' : item.status}</span>
                    </span>
                  </div>
                  <div className="op-admin-user-actions">
                    {item.status === 'pending' && (
                      <button
                        type="button"
                        className="op-btn op-btn-primary op-btn-small"
                        onClick={async () => {
                          await approveUser(item.id)
                          await refresh()
                        }}
                      >
                        Onayla
                      </button>
                    )}
                    {item.id !== currentUser.id && (
                      <button
                        type="button"
                        className="op-btn op-btn-secondary op-btn-small danger"
                        onClick={() => void handleDeleteUser(item)}
                      >
                        Sil / Çıkar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
