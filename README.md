# Mahkeme Salonu (GitHub Pages sürümü)

Sunucusuz çalışır: oda kurucusunun tarayıcısı oyun sunucusu olur, diğer oyuncular WebRTC (PeerJS) ile ona bağlanır.
Derleme / npm gerekmez.

## GitHub Pages'te yayınlama
1. Bu klasördeki dosyaları (`index.html`, `app.jsx`, `host.js`) reponun **ana dizinine** yükle.
2. Repo → Settings → Pages → Source: **Deploy from a branch**, Branch: `main`, Folder: `/ (root)` → Save.
3. 1-2 dakika sonra `https://KULLANICI.github.io/REPO/` adresinde yayında olur.

## Notlar
- Oda sahibi sayfayı kapatırsa veya yenilerse oda kapanır. Diğer oyuncular yenilerse odaya geri döner.
- Bağlantı için ücretsiz PeerJS bulut aracısı kullanılır; bazı kurumsal ağlar WebRTC'yi engelleyebilir.
- Yerelde denemek için `app.jsx` dosya olarak yüklendiğinden `index.html`'i çift tıklamak yetmez: klasörde `python -m http.server 8000` çalıştırıp `http://localhost:8000` aç.
