const { useEffect, useMemo, useRef, useState } = React

const REACTS = [['👏', 'Alkış'], ['✋', 'İtiraz!'], ['🎯', 'Sapladı!'], ['👎', 'Yuh!'], ['🤔', 'Şüpheli']]
const ROLES = { judge: 'Hakim', left: 'Savunma', right: 'Davacı' }
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

function Avatar({ i, cls = 'h-24' }) {
  const src = window.AVATARS[i % window.AVATARS.length]
  return <img src={src} alt="" draggable={false} className={`${cls} w-auto max-w-none select-none`} />
}

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
      state: s => { setSt(s); setOff(s.now - Date.now()) },
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
        ? <Room st={st} off={off} onLeave={leave} mute={mute} toggleMute={toggleMute} />
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
  const winner = st.players.find(p => p.id === st.seats[w])
  const name = (winner || {}).name || ROLES[w]
  const colors = useMemo(() => w === 'left' ? ['#2f9e63', '#c9a24b', '#efe5cf'] : ['#c4313f', '#c9a24b', '#efe5cf'], [w])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75">
      <Confetti colors={colors} />
      <div className="text-center px-4">
        <div className="slam text-[90px] leading-none">🔨</div>
        {winner && <div className="flex justify-center mt-2"><Avatar i={winner.avatar} cls="h-40" /></div>}
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
const fmt = t => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`

function Flag() {
  return (
    <div className="flex flex-col items-center" aria-hidden="true">
      <div className="relative w-14 h-9 bg-[#d3202f] rounded-sm overflow-hidden shadow">
        <div className="absolute left-[10px] top-[6px] w-6 h-6 rounded-full bg-white" />
        <div className="absolute left-[15px] top-[7px] w-5 h-5 rounded-full bg-[#d3202f]" />
        <div className="absolute left-[33px] top-[10px] text-white text-[13px] leading-none">★</div>
      </div>
      <div className="w-1.5 h-12 rounded bg-brass" />
    </div>
  )
}

function Room({ st, off, onLeave, mute, toggleMute }) {
  const me = PID
  const now = useClock(off)
  const [hide, setHide] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pick, setPick] = useState(null)
  const [topicText, setTopicText] = useState('')
  const [myVote, setMyVote] = useState(null)
  const [cool, setCool] = useState(false)
  const [msg, setMsg] = useState('')
  const [dur, setDur] = useState(60)
  const chatEnd = useRef(null)

  const send = (ev, d) => emit(ev, d)
  const byId = Object.fromEntries(st.players.map(p => [p.id, p]))
  const mine = Object.keys(st.seats).find(k => st.seats[k] === me)
  const isJudge = mine === 'judge'
  const isMod = isJudge || st.host === me
  const seated = Object.values(st.seats)
  const spectators = st.players.filter(p => !seated.includes(p.id))
  const SLOTS = 12
  const jurors = spectators.slice(0, SLOTS)
  const gallery = spectators.slice(SLOTS)
  const lobby = st.phase === 'lobby'
  const full = seated.every(Boolean)
  const hearing = st.phase === 'hearing'
  const speaker = hearing ? st.speaker : null
  const base = location.href.split('?')[0].split('#')[0]
  const link = `${base}?oda=${st.code}`

  useEffect(() => { if (st.phase !== 'voting') setMyVote(null) }, [st.phase])
  useEffect(() => { if (chatEnd.current) chatEnd.current.scrollIntoView({ block: 'end' }) }, [st.chat.length])

  const copy = () => { if (navigator.clipboard) navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const react = e => { if (cool) return; send('react', e); setCool(true); setTimeout(() => setCool(false), 2000) }
  const randomTopic = () => emit('randomTopic', null, t => setTopicText(t))

  const person = (role, box, img) => {
    const p = byId[st.seats[role]]
    return (
      <div className={`relative flex justify-center items-start overflow-hidden ${box}`}>
        {p ? <Avatar i={p.avatar} cls={img} /> : <div className="self-end mb-12 text-xs opacity-60">boş koltuk</div>}
      </div>
    )
  }
  const seatBtn = role => {
    const p = byId[st.seats[role]]
    if (!p) return <button disabled={!lobby} onClick={() => send('seat', role)} className={`${ghostBtn} mt-1 text-sm py-1`}>Otur</button>
    if (lobby && p.id === me) return <button onClick={() => send('unseat')} className={`${ghostBtn} mt-1 text-xs py-1`}>Kalk</button>
    return null
  }
  const nameOf = role => {
    const p = byId[st.seats[role]]
    return p ? `${p.name}${p.id === me ? ' (sen)' : ''}` : 'Boş'
  }

  const judgeControls = () => {
    if (!isMod) return null
    if (!isJudge) return st.phase === 'verdict' && <button onClick={() => send('next')} className={`${brassBtn} w-full mt-2`}>Yeni dava (koltukları değiştir)</button>
    return (
      <div className="mt-3 space-y-2">
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
        {hearing && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 text-sm">
              <span className="opacity-80 mr-1">Söz süresi:</span>
              {[30, 60, 90].map(d => (
                <button key={d} onClick={() => setDur(d)} className={`${btn} py-1 px-2 ${dur === d ? 'bg-brass text-ink' : 'bg-black/30 border border-white/20'}`}>{d} sn</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => send('floor', { side: 'left', dur })} className={`${btn} bg-felt border border-green-300/50`}>Söz ver: Savunma</button>
              <button onClick={() => send('floor', { side: 'right', dur })} className={`${btn} bg-oxblood border border-red-300/50`}>Söz ver: Davacı</button>
              <button disabled={!speaker} onClick={() => send('takeFloor')} className={ghostBtn}>Sözü al</button>
              <button disabled={!speaker} onClick={() => send('addTime')} className={ghostBtn}>+15 saniye</button>
              <button onClick={() => send('objection', 'accept')} className={`${btn} bg-felt border border-green-300/50`}>İtiraz kabul</button>
              <button onClick={() => send('objection', 'reject')} className={`${btn} bg-oxblood border border-red-300/50`}>İtiraz red</button>
              <button onClick={() => send('toVote')} className={`${brassBtn} col-span-2`}>Dinlemeyi bitir, oylamaya geç</button>
            </div>
          </div>
        )}
        {st.phase === 'deliberate' && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => send('decide', 'left')} className={`${btn} bg-felt border border-green-300/50`}>{ROLES.left} kazandı</button>
            <button onClick={() => send('decide', 'right')} className={`${btn} bg-oxblood border border-red-300/50`}>{ROLES.right} kazandı</button>
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
    const box = 'rounded-xl bg-ink/75 border border-brass/50 p-4 text-center'
    if (lobby) return (
      <div className={box}>
        <div className="font-slab text-xl text-brass">Lobi</div>
        <p className="mt-2 text-sm opacity-85">{full ? 'Koltuklar dolu. Hakim duruşmayı başlatabilir.' : 'Hakim, Savunma ve Davacı koltukları dolunca Hakim duruşmayı başlatır.'}</p>
        <p className="mt-1 text-xs opacity-60">Sesli oyun: Discord veya yayında konuşun, söz sırasını ve süreyi burası tutar.</p>
      </div>
    )
    if (st.phase === 'topic') return <div className={box}><div className="font-slab text-xl text-brass">Hakim dava konusunu belirliyor…</div></div>
    if (hearing) {
      const left = secs(st.turnEnd, now)
      return (
        <div className={box}>
          {speaker ? (
            <>
              <div className="text-sm opacity-80">Söz hakkı: {ROLES[speaker]} · {nameOf(speaker)}</div>
              <div className={`font-slab text-7xl my-1 ${left <= 10 ? 'text-red-400' : 'text-brass'}`}>{left}</div>
              <div className="text-xs opacity-60">saniye kaldı</div>
            </>
          ) : (
            <>
              <div className="font-slab text-xl text-brass">Söz bekleniyor</div>
              <p className="text-sm mt-2 opacity-85">Hakim söz hakkını verecek.</p>
            </>
          )}
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

  /* --- Salon parçaları --- */
  const desk = role => {
    const left = role === 'left'
    const active = hearing && speaker === role
    const won = st.winner === role
    const live = active ? Math.max(0, Math.floor((Math.min(now, st.turnEnd) - st.floorStart) / 1000)) : 0
    const spoke = ((st.spoke && st.spoke[role]) || 0) + live
    return (
      <div className={`rounded-2xl p-2 ${active ? 'spot' : ''} ${won ? 'ring-4 ring-yellow-300' : ''}`}>
        <div className="h-8 flex justify-center items-end">
          {active && (
            <div className="pop flex items-end gap-1 rounded-full bg-paper text-ink px-3 py-1 text-xs font-bold" aria-label="Konuşuyor">
              {mine === role ? 'Sıra sende, konuş!' : 'Konuşuyor'}
              {[0, 1, 2].map(i => <span key={i} className="w-1 rounded bg-felt animate-pulse" style={{ height: `${6 + i * 3}px`, animationDelay: `${i * 130}ms` }} />)}
            </div>
          )}
        </div>
        {person(role, 'h-36', 'h-56')}
        <div className="tabletop -mt-10 relative z-10 rounded-lg px-2 pt-2 pb-2 text-center">
          <div className={`rounded px-2 py-0.5 font-slab ${left ? 'bg-felt' : 'bg-oxblood'}`}>{ROLES[role]}</div>
          <div className="text-sm font-bold truncate mt-1">{nameOf(role)}</div>
          <div className="text-xs opacity-80">{left ? 'Fikri savunuyor' : 'Fikre karşı çıkıyor'}</div>
          <div className="text-xs mt-0.5">Konuştu: {fmt(spoke)}</div>
          {seatBtn(role)}
        </div>
      </div>
    )
  }

  const juror = (p, cls) => (
    <button key={p.id} disabled={!(isMod && lobby)} onClick={() => setPick(pick === p.id ? null : p.id)} title={p.name}
      className={`relative overflow-hidden rounded-t-xl bg-[#3a2418] border-2 border-[#1c120d] h-[4.75rem] ${cls} ${p.connected ? '' : 'opacity-40'} ${pick === p.id ? 'ring-2 ring-brass' : ''}`}>
      <div className="flex justify-center"><Avatar i={p.avatar} cls="h-28" /></div>
      <div className="absolute inset-x-0 bottom-0 bg-[#5a3522] border-t-2 border-brass/60 text-[11px] truncate px-1 py-0.5">{p.name}{p.id === me && ' (sen)'}</div>
    </button>
  )

  const assignPopup = pick && isMod && lobby && (
    <div className="pop mt-3 text-sm space-y-1">
      <div className="text-center">{byId[pick] && byId[pick].name} için koltuk:</div>
      {Object.keys(ROLES).map(r => (
        <button key={r} onClick={() => { send('assign', { pid: pick, role: r }); setPick(null) }} className={`${ghostBtn} w-full py-1`}>{ROLES[r]}</button>
      ))}
    </div>
  )

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
        <section className="min-w-0 space-y-3">
          <div className="rounded-2xl border-[10px] border-[#3b2519] overflow-hidden shadow-2xl">
            {/* Arka duvar */}
            <div className="wall px-4 pt-3 pb-2 flex items-start justify-between gap-2">
              <Flag />
              <div className="text-center pt-1">
                <div className="text-4xl leading-none">⚖️</div>
                <div className="font-slab text-sm md:text-base tracking-wide text-brass mt-1">ADALET MÜLKÜN TEMELİDİR</div>
              </div>
              <Flag />
            </div>

            <div className="floor p-3">
              <div className="grid md:grid-cols-[200px_1fr] gap-4">
                {/* Jüri locası (solda) */}
                <div className="rail rounded-xl bg-[#2b1a12]/85 border-4 border-[#3b2519] p-2 order-last md:order-first self-start">
                  <div className="font-slab text-lg text-brass text-center">Jüri locası</div>
                  <div className="text-xs text-center opacity-70 mb-2">{spectators.length} kişi</div>
                  <div className="grid grid-cols-4 md:grid-cols-2 gap-x-2 gap-y-2">
                    {Array.from({ length: SLOTS }, (_, i) => jurors[i]).map((p, i) => p
                      ? juror(p, '')
                      : <div key={'e' + i} className="rounded-t-xl border-2 border-dashed border-white/15 h-[4.75rem] grid place-items-center text-[11px] opacity-40">boş</div>)}
                  </div>
                  {assignPopup}
                </div>

                <div className="space-y-5 min-w-0">
                  {/* Hakim kürsüsü */}
                  <div className="max-w-xl mx-auto">
                    <div className="relative mx-auto w-52">
                      <div className="backrest absolute inset-x-2 top-4 bottom-0 rounded-t-[48px]" />
                      {person('judge', 'h-44 pt-4', 'h-64')}
                    </div>
                    <div className="bench-judge -mt-14 relative z-10 rounded-t-xl px-4 pt-3 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="rounded bg-brass text-ink px-3 py-0.5 font-slab text-sm truncate">HAKİM · {nameOf('judge')}</div>
                        <div className="small-wood rounded px-2 py-1 text-lg" title="Tokmak ve altlığı">🔨</div>
                      </div>
                      <div className="text-center">{seatBtn('judge')}</div>
                      {judgeControls()}
                    </div>
                    <div className="mx-auto h-3 w-[96%] bg-[#2b1a12]/80" />
                    <div className="mx-auto h-3 w-full bg-[#2b1a12]/55 rounded-b" />
                    <div className="flex justify-between items-end mt-3 px-1 text-[11px] text-center">
                      <div className="small-wood rounded-md px-3 py-2 opacity-90">Zabıt katibi masası</div>
                      <div className="small-wood rounded-t-3xl rounded-b-md px-3 py-3 opacity-90">Tanık kürsüsü</div>
                    </div>
                  </div>

                  {/* Duruşma alanı */}
                  <div className="grid md:grid-cols-[1fr_minmax(190px,250px)_1fr] gap-3 items-end">
                    {desk('left')}
                    <div className="order-first md:order-none">{center()}</div>
                    {desk('right')}
                  </div>
                </div>
              </div>

              {/* Bölme ve seyirci sıraları */}
              <div className="mt-5">
                <div className="flex gap-2 items-center"><div className="railbar flex-1" /><span className="text-[11px] opacity-70">kapı</span><div className="railbar flex-1" /></div>
                <div className="bg-[#2b1a12]/70 rounded-b-xl p-2">
                  <div className="text-xs text-center opacity-70 mb-2">Seyirci sıraları ({gallery.length})</div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {gallery.map(p => juror(p, 'w-20'))}
                    {!gallery.length && <div className="text-xs opacity-50 py-2">Jüri locası dolunca fazla gelenler buraya oturur.</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {!mine && (
            <div className="rounded-xl bg-ink/70 border border-white/15 p-3">
              <div className="font-semibold mb-2">Tepkiler</div>
              <div className="flex flex-wrap gap-2">
                {REACTS.map(([e, l]) => (
                  <button key={e} disabled={cool} onClick={() => react(e)} className={`${ghostBtn} text-sm`}><span className="text-lg mr-1">{e}</span>{l}</button>
                ))}
              </div>
            </div>
          )}
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
              {st.chat.map(m => <div key={m.id}><span className="inline-block align-middle mr-1 h-6 w-4 overflow-hidden"><Avatar i={m.avatar} cls="h-12" /></span><b>{m.name}:</b> <span className="break-words">{m.text}</span></div>)}
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
