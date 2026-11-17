const { useEffect, useMemo, useRef, useState } = React

const REACTS = [['👏', 'Alkış'], ['✋', 'İtiraz!'], ['🎯', 'Sapladı!'], ['👎', 'Yuh!'], ['🤔', 'Şüpheli']]
const ROLES = { judge: 'Hakim', left: 'Savunma', right: 'Yargılayan' }
const PREFIX = 'mahkeme-salonu-'

/* ---------- Ağ katmanı: oda kurucusu sunucu görevi görür (WebRTC / PeerJS) ---------- */
const PID = (() => {
  let p = sessionStorage.pid
  if (!p) { p = Math.random().toString(36).slice(2, 10); sessionStorage.pid = p }
  return p
})()
const net = { mode: null, peer: null, conn: null, host: null, h: {}, acks: {}, n: 0 }
const dispatch = m => {
  if (m.t === 'ack') { const f = net.acks[m.id]; delete net.acks[m.id]; if (f) f(m.r) }
  else if (net.h[m.t]) net.h[m.t](m.d)
}
const emit = (ev, d, cb) => {
  if (net.mode === 'host') return net.host.handle(PID, ev, d, cb)
  if (net.conn && net.conn.open) {
    const id = ++net.n
    if (cb) net.acks[id] = cb
    net.conn.send({ ev, d, id })
  }
}
const newCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.random() * 31 | 0]).join('')

const createRoom = name => new Promise((resolve, reject) => {
  const attempt = n => {
    const code = newCode()
    const peer = new Peer(PREFIX + code)
    peer.on('open', () => {
      const host = new Host(code, PID)
      net.mode = 'host'; net.peer = peer; net.host = host
      host.enter(PID, name, dispatch)
      peer.on('connection', conn => {
        const send = msg => { if (conn.open) conn.send(msg) }
        conn.on('data', m => {
          if (m.ev === 'join') {
            conn.pid = m.d.pid
            const ok = host.enter(m.d.pid, m.d.name, send)
            send({ t: 'ack', id: m.id, r: ok ? { ok: true, code } : { error: 'Oda dolu.' } })
          } else if (conn.pid) host.handle(conn.pid, m.ev, m.d, r => send({ t: 'ack', id: m.id, r }))
        })
        conn.on('close', () => { if (conn.pid) host.disconnect(conn.pid, send) })
      })
      peer.on('disconnected', () => { try { peer.reconnect() } catch (e) { /* yok say */ } })
      resolve(code)
    })
    peer.on('error', e => {
      if (net.mode === 'host') return
      if (e.type === 'unavailable-id' && n < 5) { peer.destroy(); attempt(n + 1) }
      else reject(new Error('Bağlantı sunucusuna ulaşılamadı. İnternetini kontrol edip tekrar dene.'))
    })
  }
  attempt(0)
})

const joinRoom = (name, code) => new Promise((resolve, reject) => {
  const peer = new Peer()
  let finished = false, ok = false
  const fail = msg => { if (finished) return; finished = true; clearTimeout(to); try { peer.destroy() } catch (e) { /* yok say */ } reject(new Error(msg)) }
  const to = setTimeout(() => fail('Odaya bağlanılamadı. Kodu kontrol et; oda sahibinin sayfası açık olmalı.'), 12000)
  peer.on('error', e => fail(e.type === 'peer-unavailable' ? 'Oda bulunamadı. Kodu kontrol et.' : 'Bağlantı hatası: ' + e.type))
  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' })
    conn.on('open', () => {
      const id = ++net.n
      net.acks[id] = r => {
        if (r && r.ok) { ok = finished = true; clearTimeout(to); net.mode = 'guest'; net.peer = peer; net.conn = conn; resolve(code) }
        else fail((r && r.error) || 'Odaya katılınamadı.')
      }
      conn.send({ ev: 'join', d: { name, pid: PID }, id })
    })
    conn.on('data', dispatch)
    conn.on('close', () => { if (ok && net.h.closed) net.h.closed() })
  })
})

const leaveRoom = () => {
  if (net.mode === 'guest') emit('leave')
  try { net.conn && net.conn.close() } catch (e) { /* yok say */ }
  if (net.host) net.host.destroy()
  try { net.peer && net.peer.destroy() } catch (e) { /* yok say */ }
  net.mode = null; net.peer = net.conn = net.host = null
}

/* ---------- Ses (Web Audio, harici dosya yok) ---------- */
let actx = null
let muted = false
const ac = () => actx || (actx = new (window.AudioContext || window.webkitAudioContext)())
function tone(f, d, type = 'sine', v = 0.2, delay = 0, slide) {
  if (muted) return
  const c = ac(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d)
  g.gain.setValueAtTime(v, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + d)
  o.connect(g); g.connect(c.destination)
  o.start(t); o.stop(t + d)
}
const sfx = {
  gavel() { [0, 0.3].forEach(d => { tone(150, 0.28, 'triangle', 0.6, d, 40); tone(1000, 0.05, 'square', 0.15, d) }) },
  bell() { tone(1320, 0.5, 'sine', 0.25); tone(1760, 0.7, 'sine', 0.2, 0.12) },
  reject() { tone(240, 0.3, 'sawtooth', 0.18, 0, 110); tone(170, 0.4, 'sawtooth', 0.18, 0.2, 80) },
  timeup() { [0, 0.25, 0.5].forEach(d => tone(880, 0.18, 'square', 0.14, d)) },
  pop() { tone(600, 0.1, 'sine', 0.14, 0, 900) }
}

/* ---------- Yardımcılar ---------- */
function useClock(off) {
  const [n, setN] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setN(Date.now()), 250); return () => clearInterval(i) }, [])
  return n + off
}
const secs = (t, now) => Math.max(0, Math.ceil((t - now) / 1000))
const btn = 'rounded-lg px-3 py-2 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40 disabled:cursor-not-allowed'
const brassBtn = `${btn} bg-brass text-ink hover:brightness-110`
const ghostBtn = `${btn} bg-black/30 border border-white/20 hover:bg-black/50`

function Confetti({ colors }) {
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 1.2, dur: 2.5 + Math.random() * 2, bg: colors[i % colors.length]
  })), [colors])
  return pieces.map((p, i) => (
    <div key={i} className="confetti" style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: p.bg }} />
  ))
}

/* ---------- Uygulama ---------- */
function App() {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState(0)
  const [args, setArgs] = useState({ left: '', right: '' })
  const [floats, setFloats] = useState([])
  const [slam, setSlam] = useState(false)
  const [obj, setObj] = useState(null)
  const [mute, setMute] = useState(false)

  const join = async (name, code) => {
    setErr(''); setBusy(true)
    try { await joinRoom(name, code); sessionStorage.room = code; sessionStorage.role = 'guest'; localStorage.name = name }
    catch (e) { setErr(e.message); sessionStorage.removeItem('room') }
    setBusy(false)
  }
  const create = async name => {
    setErr(''); setBusy(true)
    try { await createRoom(name); sessionStorage.role = 'host'; sessionStorage.removeItem('room'); localStorage.name = name }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const leave = () => { leaveRoom(); sessionStorage.removeItem('room'); setSt(null) }

  useEffect(() => {
    const unlock = () => { try { ac().resume() } catch (e) { /* yok say */ } }
    window.addEventListener('pointerdown', unlock, { once: true })
    net.h = {
      state: s => { setSt(s); setOff(s.now - Date.now()); setArgs(s.args) },
      arg: a => { if (a.from !== PID) setArgs(p => ({ ...p, [a.side]: a.text })) },
      fx: f => {
        if (f.kind === 'gavel') { sfx.gavel(); setSlam(true); setTimeout(() => setSlam(false), 4500) }
        else if (f.kind === 'objection') {
          f.type === 'accept' ? sfx.bell() : sfx.reject()
          setObj(f.type); setTimeout(() => setObj(null), 1800)
        } else if (f.kind === 'timeup') sfx.timeup()
      },
      reaction: r => {
        sfx.pop()
        setFloats(p => [...p, { ...r, x: 8 + Math.random() * 84 }])
        setTimeout(() => setFloats(p => p.filter(f => f.id !== r.id)), 3200)
      },
      closed: () => {
        leaveRoom(); sessionStorage.removeItem('room'); setSt(null)
        setErr('Oda sahibinin bağlantısı koptu, oda kapandı.')
      }
    }
    const c = sessionStorage.room, n = localStorage.name
    if (sessionStorage.role === 'guest' && c && n) join(n, c)
  }, [])

  const toggleMute = () => { muted = !muted; setMute(muted) }

  return (
    <div className="wood min-h-screen font-sans">
      {st
        ? <Room st={st} args={args} setArgs={setArgs} off={off} onLeave={leave} mute={mute} toggleMute={toggleMute} />
        : <Landing onCreate={create} onJoin={join} err={err} busy={busy} />}

      <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
        {floats.map(f => (
          <div key={f.id} className="float-up absolute bottom-24 text-center" style={{ left: `${f.x}%` }}>
            <div className="text-5xl">{f.emoji}</div>
            <div className="text-xs bg-black/60 rounded px-1.5">{f.name}</div>
          </div>
        ))}
      </div>

      {obj && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
          <div className={`pop font-slab text-3xl md:text-6xl px-8 py-5 rounded-2xl border-4 border-white/80 rotate-[-4deg] ${obj === 'accept' ? 'bg-felt' : 'bg-oxblood'}`}>
            {obj === 'accept' ? 'İTİRAZ KABUL EDİLDİ!' : 'İTİRAZ REDDEDİLDİ!'}
          </div>
        </div>
      )}

      {slam && st && <Slam st={st} />}
    </div>
  )
}

function Slam({ st }) {
  const w = st.winner
  const name = (st.players.find(p => p.id === st.seats[w]) || {}).name || ROLES[w]
  const colors = useMemo(() => w === 'left' ? ['#2f9e63', '#c9a24b', '#efe5cf'] : ['#c4313f', '#c9a24b', '#efe5cf'], [w])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75">
      <Confetti colors={colors} />
      <div className="text-center px-4">
        <div className="slam text-[120px] leading-none">🔨</div>
        <div className="font-slab text-4xl md:text-7xl mt-4 text-brass">DAVA SONUÇLANDI!</div>
        <div className="font-slab text-2xl md:text-4xl mt-3">{ROLES[w]} taraf kazandı</div>
        <div className="text-xl mt-2 opacity-90">{name}</div>
      </div>
    </div>
  )
}

/* ---------- Giriş ekranı ---------- */
function Landing({ onCreate, onJoin, err, busy }) {
  const [name, setName] = useState(localStorage.name || '')
  const [code, setCode] = useState((new URLSearchParams(location.search).get('oda') || '').toUpperCase())
  const ok = name.trim().length > 0 && !busy
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-md bg-ink/80 border-2 border-brass rounded-2xl p-6 shadow-2xl">
        <div className="text-5xl">🔨</div>
        <h1 className="font-slab text-5xl text-brass leading-none mt-3">Mahkeme Salonu</h1>
        <p className="mt-3 opacity-80">Arkadaşlarınla dava aç, tartış. Jüri oy versin, son sözü Hakim söylesin.</p>
        <label className="block mt-6 text-sm font-semibold" htmlFor="ad">Kullanıcı adın</label>
        <input id="ad" value={name} maxLength={16} onChange={e => setName(e.target.value)}
          className="w-full mt-1 rounded-lg bg-paper text-ink px-3 py-2 outline-none focus:ring-2 focus:ring-brass" placeholder="Örn: Avukat Mehmet" />
        <button disabled={!ok} onClick={() => onCreate(name.trim())} className={`${brassBtn} w-full mt-4`}>{busy ? 'Bağlanıyor…' : 'Oda oluştur'}</button>
        <div className="flex items-center gap-2 my-5 opacity-60 text-sm"><div className="h-px bg-white/30 flex-1" />ya da<div className="h-px bg-white/30 flex-1" /></div>
        <label className="block text-sm font-semibold" htmlFor="kod">Oda kodu</label>
        <div className="flex gap-2 mt-1">
          <input id="kod" value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())}
            className="flex-1 min-w-0 rounded-lg bg-paper text-ink px-3 py-2 tracking-widest font-bold outline-none focus:ring-2 focus:ring-brass" placeholder="ABCDE" />
          <button disabled={!ok || code.length < 4} onClick={() => onJoin(name.trim(), code)} className={ghostBtn}>İzleyici olarak katıl</button>
        </div>
        {err && <p role="alert" className="mt-3 text-red-300 font-semibold">{err}</p>}
        <p className="mt-5 text-xs opacity-50">Oda sahibinin sayfası açık kaldığı sürece oda çalışır; sayfayı kapatırsa oda kapanır.</p>
      </div>
    </div>
  )
}

/* ---------- Oda ---------- */
function Room({ st, args, setArgs, off, onLeave, mute, toggleMute }) {
  const me = PID
  const now = useClock(off)
  const [hide, setHide] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pick, setPick] = useState(null)
  const [topicText, setTopicText] = useState('')
  const [myVote, setMyVote] = useState(null)
  const [cool, setCool] = useState(false)
  const [msg, setMsg] = useState('')
  const chatEnd = useRef(null)

  const send = (ev, d) => emit(ev, d)
  const byId = Object.fromEntries(st.players.map(p => [p.id, p]))
  const mine = Object.keys(st.seats).find(k => st.seats[k] === me)
  const isJudge = mine === 'judge'
  const isMod = isJudge || st.host === me
  const seated = Object.values(st.seats)
  const spectators = st.players.filter(p => !seated.includes(p.id))
  const lobby = st.phase === 'lobby'
  const full = seated.every(Boolean)
  const cur = st.phase === 'hearing' ? st.plan[st.turn] : null
  const base = location.href.split('?')[0].split('#')[0]
  const link = `${base}?oda=${st.code}`

  useEffect(() => { if (st.phase !== 'voting') setMyVote(null) }, [st.phase])
  useEffect(() => { if (chatEnd.current) chatEnd.current.scrollIntoView({ block: 'end' }) }, [st.chat.length])

  const copy = () => { if (navigator.clipboard) navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const react = e => { if (cool) return; send('react', e); setCool(true); setTimeout(() => setCool(false), 2000) }
  const randomTopic = () => emit('randomTopic', null, t => setTopicText(t))

  const occupant = role => {
    const p = byId[st.seats[role]]
    if (p) return (
      <div className="flex items-center gap-2">
        <span className="text-3xl">{p.avatar}</span>
        <div className="min-w-0"><div className="font-bold truncate">{p.name}{p.id === me && ' (sen)'}</div>
          {!p.connected && <div className="text-xs opacity-70">bağlantı koptu…</div>}</div>
        {lobby && p.id === me && <button onClick={() => send('unseat')} className={`${ghostBtn} ml-auto text-sm`}>Koltuktan kalk</button>}
      </div>
    )
    return <button disabled={!lobby} onClick={() => send('seat', role)} className={`${ghostBtn} w-full py-3`}>Boş koltuk · Otur</button>
  }

  const argBox = role => {
    const active = cur && cur.side === role
    const canType = active && mine === role && st.mode === 'written'
    if (canType) return (
      <textarea autoFocus value={args[role]} maxLength={1200}
        onChange={e => { setArgs(a => ({ ...a, [role]: e.target.value })); send('arg', e.target.value) }}
        className="w-full h-full min-h-[140px] rounded bg-paper text-ink p-2 text-sm outline-none focus:ring-2 focus:ring-brass" placeholder="Argümanını yaz…" />
    )
    if (args[role]) return <div className="text-sm whitespace-pre-wrap break-words">{args[role]}</div>
    return <div className="text-sm opacity-60">{st.mode === 'voice' ? 'Sesli mod: konuşma sırası ve süre takip ediliyor.' : 'Henüz argüman yok.'}</div>
  }

  const bench = role => {
    const left = role === 'left'
    const active = cur && cur.side === role
    const won = st.winner === role
    return (
      <div className={`rounded-xl border-2 p-3 flex flex-col min-h-[280px] ${left ? 'bg-felt border-green-300/40' : 'bg-oxblood border-red-300/40'} ${active ? 'ring-4 ring-brass' : ''} ${won ? 'ring-4 ring-yellow-300' : ''}`}>
        <div className="font-slab text-xl">{ROLES[role]}</div>
        <div className="text-xs opacity-80 mb-2">{left ? 'Fikri destekliyor' : 'Fikre karşı çıkıyor'}</div>
        {occupant(role)}
        <div className="flex-1 mt-3 rounded bg-black/25 p-2 overflow-auto max-h-64">{argBox(role)}</div>
      </div>
    )
  }

  const judgeControls = () => {
    if (!isMod) return null
    const mode = lobby && (
      <div className="flex gap-2 mt-2">
        {[['written', 'Yazılı mod'], ['voice', 'Sesli mod']].map(([m, l]) => (
          <button key={m} onClick={() => send('mode', m)} className={`${btn} flex-1 text-sm ${st.mode === m ? 'bg-brass text-ink' : 'bg-black/30 border border-white/20'}`}>{l}</button>
        ))}
      </div>
    )
    if (!isJudge) return mode || (st.phase === 'verdict' && <button onClick={() => send('next')} className={`${brassBtn} w-full mt-2`}>Yeni dava (koltukları değiştir)</button>)
    return (
      <div className="mt-3 space-y-2">
        {mode}
        {lobby && <button disabled={!full} onClick={() => send('start')} className={`${brassBtn} w-full`}>Duruşmayı başlat</button>}
        {st.phase === 'topic' && (
          <div className="space-y-2">
            <input value={topicText} maxLength={140} onChange={e => setTopicText(e.target.value)} placeholder="Dava konusunu yaz…"
              className="w-full rounded-lg bg-paper text-ink px-3 py-2 outline-none focus:ring-2 focus:ring-brass" />
            <div className="flex gap-2">
              <button onClick={randomTopic} className={`${ghostBtn} flex-1`}>Rastgele dava çek</button>
              <button disabled={!topicText.trim()} onClick={() => send('topic', topicText)} className={`${brassBtn} flex-1`}>Konuyu onayla</button>
            </div>
          </div>
        )}
        {st.phase === 'hearing' && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => send('objection', 'accept')} className={`${btn} bg-felt border border-green-300/50`}>İtiraz kabul</button>
            <button onClick={() => send('objection', 'reject')} className={`${btn} bg-oxblood border border-red-300/50`}>İtiraz red</button>
            <button onClick={() => send('addTime')} className={ghostBtn}>+15 saniye</button>
            <button onClick={() => send('skip')} className={ghostBtn}>Sırayı geç</button>
            <button onClick={() => send('toVote')} className={`${brassBtn} col-span-2`}>Turu bitir, oylamaya geç</button>
          </div>
        )}
        {st.phase === 'deliberate' && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => send('decide', 'left')} className={`${btn} bg-felt border border-green-300/50`}>Savunma kazandı</button>
            <button onClick={() => send('decide', 'right')} className={`${btn} bg-oxblood border border-red-300/50`}>Yargılayan kazandı</button>
          </div>
        )}
        {st.phase === 'verdict' && <button onClick={() => send('next')} className={`${brassBtn} w-full`}>Yeni dava (koltukları değiştir)</button>}
      </div>
    )
  }

  const bar = (side, n, total) => {
    const pct = total ? Math.round(100 * n / total) : 0
    return (
      <div className="mb-2">
        <div className="flex justify-between text-sm font-semibold"><span>{ROLES[side]}</span><span>%{pct} ({n} oy)</span></div>
        <div className="h-5 rounded bg-black/40 overflow-hidden"><div className={`h-full transition-all duration-700 ${side === 'left' ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} /></div>
      </div>
    )
  }

  const center = () => {
    const box = 'rounded-xl bg-ink/70 border border-brass/50 p-4 text-center'
    if (lobby) return (
      <div className={box}>
        <div className="font-slab text-xl text-brass">Lobi</div>
        <p className="mt-2 text-sm opacity-85">{full ? 'Koltuklar dolu. Hakim duruşmayı başlatabilir.' : 'Üç koltuğa da oyuncu oturunca Hakim duruşmayı başlatır.'}</p>
        <p className="mt-1 text-xs opacity-60">Mod: {st.mode === 'written' ? 'Yazılı' : 'Sesli / yüz yüze'}</p>
      </div>
    )
    if (st.phase === 'topic') return <div className={box}><div className="font-slab text-xl text-brass">Hakim dava konusunu belirliyor…</div></div>
    if (st.phase === 'hearing') {
      const left = secs(st.turnEnd, now)
      return (
        <div className={box}>
          <div className="text-sm opacity-80">{cur.title}</div>
          <div className={`font-slab text-7xl my-1 ${left <= 10 ? 'text-red-400' : 'text-brass'}`}>{left}</div>
          <div className="text-xs opacity-60">saniye · sıra {cur.side === 'left' ? 'Savunma' : 'Yargılayan'}’da</div>
        </div>
      )
    }
    if (st.phase === 'voting') {
      const left = secs(st.voteEnd, now)
      return (
        <div className={box}>
          <div className="font-slab text-xl text-brass">Jüri oylaması · {left}</div>
          <p className="text-sm mt-1">Kim daha ikna ediciydi?</p>
          {!mine ? (
            <div className="grid grid-cols-2 gap-2 mt-3">
              {['left', 'right'].map(s => (
                <button key={s} onClick={() => { setMyVote(s); send('vote', s) }}
                  className={`${btn} ${s === 'left' ? 'bg-felt' : 'bg-oxblood'} ${myVote === s ? 'ring-4 ring-brass' : 'opacity-90'}`}>{ROLES[s]}</button>
              ))}
            </div>
          ) : <p className="text-sm opacity-70 mt-3">Jüri oy veriyor, bekle.</p>}
          <p className="text-xs opacity-60 mt-2">{st.voted}/{st.jury} oy kullanıldı</p>
        </div>
      )
    }
    const t = st.tally || { left: 0, right: 0 }
    const total = t.left + t.right
    return (
      <div className={box}>
        <div className="font-slab text-xl text-brass">{st.phase === 'verdict' ? `Karar: ${ROLES[st.winner]} kazandı` : 'Hakim karar veriyor…'}</div>
        <div className="mt-3 text-left">{bar('left', t.left, total)}{bar('right', t.right, total)}</div>
        {!total && <p className="text-xs opacity-60">Jüriden oy gelmedi.</p>}
      </div>
    )
  }

  const scores = [...st.scores].sort((a, b) => b.points - a.points)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-ink/85 border-b-2 border-brass px-3 py-2 flex flex-wrap items-center gap-3">
        <div className="font-slab text-xl text-brass">Mahkeme Salonu</div>
        <div className="flex-1 min-w-[200px] text-center">
          {st.topic ? <span className="font-slab text-lg md:text-2xl">⚖ {st.topic}</span> : <span className="opacity-60 text-sm">Dava henüz açılmadı</span>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="opacity-70">Oda</span>
          <span className="font-bold tracking-widest bg-black/40 rounded px-2 py-1 min-w-[84px] text-center">{hide ? '•••••' : st.code}</span>
          <button onClick={() => setHide(h => !h)} className={ghostBtn} aria-label="Oda kodunu gizle veya göster" title="Yayıncı modu">{hide ? '🙈' : '👁'}</button>
          <button onClick={copy} className={ghostBtn} aria-label="Davet linkini kopyala" title="Davet linkini kopyala">{copied ? '✓' : '📋'}</button>
          <button onClick={toggleMute} className={ghostBtn} aria-label="Sesi aç veya kapat">{mute ? '🔇' : '🔊'}</button>
          <button onClick={onLeave} className={ghostBtn} aria-label="Odadan çık" title="Odadan çık">🚪</button>
        </div>
      </header>

      <main className="flex-1 grid lg:grid-cols-[1fr_320px] gap-3 p-3">
        <section className="space-y-3 min-w-0">
          <div className="bench-judge rounded-xl p-3 max-w-xl mx-auto">
            <div className="flex items-center gap-2 mb-2"><span className="text-xl">🔨</span><span className="font-slab text-xl text-brass">Hakim</span></div>
            {occupant('judge')}
            {judgeControls()}
          </div>

          <div className="grid md:grid-cols-3 gap-3 items-start">
            {bench('left')}
            <div className="order-first md:order-none">{center()}</div>
            {bench('right')}
          </div>

          <div className="rounded-xl bg-ink/70 border border-white/15 p-3">
            <div className="font-semibold mb-2">İzleyici tribünü ({spectators.length})</div>
            <div className="flex flex-wrap gap-2">
              {spectators.map(p => (
                <button key={p.id} disabled={!(isMod && lobby)} onClick={() => setPick(pick === p.id ? null : p.id)}
                  className={`flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-sm ${p.connected ? '' : 'opacity-40'} ${pick === p.id ? 'ring-2 ring-brass' : ''}`}>
                  <span className="text-lg">{p.avatar}</span>{p.name}{p.id === me && ' (sen)'}
                </button>
              ))}
              {!spectators.length && <span className="text-sm opacity-60">Tribün boş.</span>}
            </div>
            {pick && isMod && lobby && (
              <div className="pop mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span>{byId[pick] && byId[pick].name} için koltuk:</span>
                {Object.keys(ROLES).map(r => (
                  <button key={r} onClick={() => { send('assign', { pid: pick, role: r }); setPick(null) }} className={`${ghostBtn} py-1`}>{ROLES[r]}</button>
                ))}
              </div>
            )}
            {!mine && (
              <div className="flex flex-wrap gap-2 mt-3">
                {REACTS.map(([e, l]) => (
                  <button key={e} disabled={cool} onClick={() => react(e)} className={`${ghostBtn} text-sm`}><span className="text-lg mr-1">{e}</span>{l}</button>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-3 min-w-0">
          <div className="rounded-xl bg-ink/70 border border-brass/40 p-3">
            <div className="font-slab text-lg text-brass mb-2">Skor tablosu</div>
            {scores.length ? scores.map(s => (
              <div key={s.id} className="flex justify-between text-sm py-0.5"><span className="truncate">{s.name}</span><span className="font-bold">{s.points}</span></div>
            )) : <p className="text-sm opacity-60">İlk karardan sonra puanlar burada görünür.</p>}
          </div>
          <div className="rounded-xl bg-ink/70 border border-white/15 p-3 flex flex-col h-[340px] lg:h-[420px]">
            <div className="font-semibold mb-2">Canlı sohbet</div>
            <div className="flex-1 overflow-auto space-y-1 text-sm">
              {st.chat.map(m => <div key={m.id}><span className="mr-1">{m.avatar}</span><b>{m.name}:</b> <span className="break-words">{m.text}</span></div>)}
              <div ref={chatEnd} />
            </div>
            <form className="flex gap-2 mt-2" onSubmit={e => { e.preventDefault(); if (msg.trim()) { send('chat', msg); setMsg('') } }}>
              <input value={msg} maxLength={200} onChange={e => setMsg(e.target.value)} placeholder="Mesaj yaz…"
                className="flex-1 min-w-0 rounded-lg bg-paper text-ink px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brass" />
              <button className={brassBtn} aria-label="Gönder">➤</button>
            </form>
          </div>
        </aside>
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
