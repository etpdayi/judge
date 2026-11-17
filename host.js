/* Oyun mantığı: eski Node sunucusunun tarayıcı sürümü. Oda kurucusunun tarayıcısında çalışır. */
(typeof window !== 'undefined' ? window : globalThis).Host = (() => {
  const TOPICS = [
    'Kedi mi daha iyi evcil hayvandır, köpek mi?', 'Ananasın pizzaya konması suç olmalı mı?',
    'Sabah insanı olmak bir yetenek mi, işkence mi?', 'Hafta sonu 3 gün olmalı mı?',
    'Çay mı üstündür, kahve mi?', 'Kış mı daha güzel, yaz mı?',
    'Mesaja 3 saat sonra cevap vermek saygısızlık mıdır?', 'Çorbaya ekmek banılır mı?',
    'Tatil için deniz mi daha iyi, dağ mı?', 'Evde terlikle gezmek zorunlu olmalı mı?',
    'Sesli mesaj atmak medeni bir davranış mıdır?', 'Karpuz peynirle yenir mi?',
    'Işınlanma mı daha iyi, uçma yeteneği mi?', 'Her gün aynı yemeği yemek mutluluk mu, hapis mi?',
    'Dizinin son bölümünü önce izlemek suç mu?', 'Her toplantı aslında bir e-posta olabilirdi.',
    'Ekran görüntüsü atmak mahremiyet ihlali midir?', 'Lahmacun dürüm yapılır mı?',
    'Hiç gülmeyen biri komik birinden daha mı güvenilirdir?', 'Alarmı 5 dakika ileri almak bir sanat mıdır?',
    'Yastığın soğuk tarafı ücretsiz bir lüks müdür?', 'Kankaya borç verilmemeli mi?',
    'Gece 3’te yemek yemek temel bir hak mıdır?', 'Dünyayı kediler yönetseydi daha mı iyi olurdu?',
    'Mutluluk parayla satın alınabilir mi?', 'Telefonsuz bir hafta ödül mü, ceza mı?',
    'Patates kızartması mı, patates püresi mi?', 'Balkonda çay içmek en iyi sosyal aktivitedir.',
    'Zaman yolculuğu mümkün olsa geçmişe mi gidilmeli, geleceğe mi?',
    'Kahvaltı günün en önemli öğünü mü, en gereksiz masrafı mı?', 'Pazartesi resmi tatil olmalı mı?',
    'Robotlar bulaşıkları yıkarsa insan daha mutlu olur mu?', '“Bir tur daha” demek bağımlılık mı, azim mi?',
    'Bir kıyafeti sadece bir kez giymek israf mıdır?'
  ]
  const AV_COUNT = 16
  const EMOJIS = ['👏', '✋', '🎯', '👎', '🤔']
  const now = () => Date.now()
  const rid = () => Math.random().toString(36).slice(2, 10)
  const clean = (t, n) => String(t ?? '').trim().slice(0, n)
  const seatedIds = r => Object.values(r.seats).filter(Boolean)

  class Host {
    constructor(code, hostPid) {
      this.r = {
        code, host: hostPid, players: {}, seats: { judge: null, left: null, right: null }, phase: 'lobby',
        topic: '', speaker: null, floorStart: 0, spoke: { left: 0, right: 0 }, turnEnd: 0, voteEnd: 0, votes: {}, winner: null,
        scores: {}, chat: [], react: {}
      }
      this.iv = setInterval(() => this.tick(), 500)
    }
    destroy() { clearInterval(this.iv); Object.values(this.r.players).forEach(p => clearTimeout(p.t)) }

    jury() { const r = this.r; return Object.values(r.players).filter(p => p.connected && !seatedIds(r).includes(p.id)) }
    pub() {
      const r = this.r
      const done = r.phase === 'deliberate' || r.phase === 'verdict'
      const t = { left: 0, right: 0 }
      Object.values(r.votes).forEach(v => t[v]++)
      return {
        code: r.code, host: r.host, seats: r.seats, phase: r.phase, topic: r.topic,
        speaker: r.speaker, floorStart: r.floorStart, spoke: r.spoke, turnEnd: r.turnEnd, voteEnd: r.voteEnd,
        voted: Object.keys(r.votes).length, jury: this.jury().length, tally: done ? t : null, winner: r.winner,
        players: Object.values(r.players).map(({ id, name, avatar, connected }) => ({ id, name, avatar, connected })),
        scores: Object.values(r.scores), chat: r.chat, now: now()
      }
    }
    all(msg) { Object.values(this.r.players).forEach(p => { if (p.connected && p.send) { try { p.send(msg) } catch (e) { /* yok say */ } } }) }
    push() { this.all({ t: 'state', d: this.pub() }) }
    fx(d) { this.all({ t: 'fx', d }) }

    enter(pid, name, send) {
      const r = this.r
      let p = r.players[pid]
      if (!p && Object.keys(r.players).length >= 40) return false
      if (!p) {
        const used = Object.values(r.players).map(x => x.avatar)
        const open = Array.from({ length: AV_COUNT }, (_, i) => i).filter(i => !used.includes(i))
        const pool = open.length ? open : Array.from({ length: AV_COUNT }, (_, i) => i)
        p = r.players[pid] = { id: pid, avatar: pool[Math.random() * pool.length | 0] }
      }
      p.name = clean(name, 16) || 'Misafir'
      p.connected = true; p.send = send; clearTimeout(p.t)
      this.push()
      return true
    }
    disconnect(pid, send) {
      const p = this.r.players[pid]
      if (!p || p.send !== send) return
      p.connected = false
      p.t = setTimeout(() => this.drop(pid), 30000)
      this.push()
    }
    drop(pid) {
      const r = this.r
      if (pid === r.host) return
      delete r.players[pid]
      for (const k in r.seats) if (r.seats[k] === pid) r.seats[k] = null
      if (Object.values(r.seats).some(v => !v) && !['lobby', 'verdict'].includes(r.phase)) r.phase = 'lobby'
      this.push()
    }
    award(pid, n) {
      const r = this.r
      if (!pid || !r.players[pid]) return
      const s = r.scores[pid] || { id: pid, points: 0 }
      r.scores[pid] = { ...s, name: r.players[pid].name, points: s.points + n }
    }
    stopFloor() {
      const r = this.r
      if (!r.speaker) return
      const el = Math.max(0, Math.min(now(), r.turnEnd) - r.floorStart)
      r.spoke[r.speaker] += Math.round(el / 1000)
      r.speaker = null
    }
    startVoting() {
      const r = this.r
      this.stopFloor()
      r.phase = 'voting'; r.votes = {}; r.voteEnd = now() + 15000
      if (!this.jury().length) r.phase = 'deliberate'
    }
    tick() {
      const r = this.r
      if (r.phase === 'hearing' && r.speaker && now() >= r.turnEnd) { this.fx({ kind: 'timeup' }); this.stopFloor(); this.push() }
      else if (r.phase === 'voting' && (now() >= r.voteEnd || Object.keys(r.votes).length >= this.jury().length)) { r.phase = 'deliberate'; this.push() }
    }

    handle(pid, ev, d, cb) {
      const r = this.r, p = r.players[pid]
      if (!p) return
      const isJ = r.seats.judge === pid, isM = isJ || r.host === pid
      const free = () => { for (const k in r.seats) if (r.seats[k] === pid) r.seats[k] = null }
      switch (ev) {
        case 'randomTopic': cb && cb(TOPICS[Math.random() * TOPICS.length | 0]); return
        case 'leave': this.drop(pid); return
        case 'react':
          if (!EMOJIS.includes(d) || seatedIds(r).includes(pid) || now() - (r.react[pid] || 0) < 2000) return
          r.react[pid] = now()
          this.all({ t: 'reaction', d: { id: rid(), emoji: d, name: p.name } }); return
        case 'seat':
          if (r.phase !== 'lobby' || !(d in r.seats) || (r.seats[d] && r.seats[d] !== pid)) return
          free(); r.seats[d] = pid; break
        case 'unseat': if (r.phase === 'lobby') free(); break
        case 'assign':
          if (!isM || r.phase !== 'lobby' || !d || !(d.role in r.seats) || !r.players[d.pid]) return
          for (const k in r.seats) if (r.seats[k] === d.pid) r.seats[k] = null
          r.seats[d.role] = d.pid; break
        case 'start': if (isJ && r.phase === 'lobby' && seatedIds(r).length === 3) { r.phase = 'topic'; r.topic = '' } break
        case 'topic': {
          const t = clean(d, 140)
          if (!isJ || r.phase !== 'topic' || !t) return
          r.topic = t; r.phase = 'hearing'; r.speaker = null; r.spoke = { left: 0, right: 0 }; r.winner = null; break
        }
        case 'floor': {
          if (!isJ || r.phase !== 'hearing' || !d || (d.side !== 'left' && d.side !== 'right')) return
          const dur = Math.min(180, Math.max(10, Number(d.dur) || 60))
          this.stopFloor()
          r.speaker = d.side; r.floorStart = now(); r.turnEnd = now() + dur * 1000; break
        }
        case 'takeFloor': if (isJ && r.phase === 'hearing') this.stopFloor(); break
        case 'addTime': if (isJ && r.phase === 'hearing' && r.speaker) r.turnEnd += 15000; break
        case 'toVote': if (isJ && r.phase === 'hearing') this.startVoting(); break
        case 'objection':
          if (isJ && r.phase === 'hearing') this.fx({ kind: 'objection', type: d === 'accept' ? 'accept' : 'reject' })
          return
        case 'vote':
          if (r.phase === 'voting' && (d === 'left' || d === 'right') && !seatedIds(r).includes(pid)) r.votes[pid] = d
          break
        case 'decide':
          if (!isJ || r.phase !== 'deliberate' || (d !== 'left' && d !== 'right')) return
          r.winner = d; r.phase = 'verdict'
          this.award(r.seats[d], 3); this.award(r.seats.judge, 1)
          for (const [vp, v] of Object.entries(r.votes)) if (v === d) this.award(vp, 1)
          this.fx({ kind: 'gavel' }); break
        case 'next': {
          if (!isM || r.phase !== 'verdict') return
          const q = r.seats
          r.seats = { judge: q.left, left: q.right, right: q.judge }
          r.phase = 'lobby'; r.topic = ''; r.winner = null; r.votes = {}; break
        }
        case 'chat': {
          const text = clean(d, 200); if (!text) return
          r.chat.push({ id: rid(), name: p.name, avatar: p.avatar, text }); r.chat = r.chat.slice(-60); break
        }
        default: return
      }
      this.push()
    }
  }
  return Host
})()
