# Turbo Racer 🏎️

Game balapan mobil pseudo-3D berbasis web — hindari lalu lintas, kumpulkan jarak sejauh mungkin!

![Turbo Racer](https://github.com/rakasyau/turbo-racer/raw/main/shots/turbo-racer.png)

## Fitur
- 🛣️ Jalan pseudo-3D dengan tikungan & bukit (perspektif ala OutRun)
- 🚗 Mobil AI & truk yang menghindar, 4 lajur
- ❤️ Sistem 3 nyawa — nabrak keras = kehilangan nyawa + efek layar merah
- 📈 Skor jarak tempuh + rekor tersimpan di `localStorage`
- 🔊 Suara mesin WebAudio, beep countdown, suara tabrakan
- 📱 Kontrol sentuh untuk HP + HUD speed/jarak/nyawa
- 🖼️ 100% prosedural — tanpa file gambar eksternal

## Cara main
Buka `index.html` di browser (tidak perlu server). Atau:
```bash
cd turbo-racer
python -m http.server 8080   # lalu buka http://localhost:8080
```

## Kontrol
| Aksi | Keyboard | Sentuh |
|---|---|---|
| Belok | `←` `→` / `A` `D` | Tombol ◀ ▶ |
| Gas | `↑` / `W` | Tombol GAS |
| Rem | `↓` / `S` | Tombol REM |
| Jeda | `P` / `Esc` | — |
| Suara | `M` | — |
| Mulai | `Enter` | Tombol MULAI BALAP |

## Teknis
- Satu halaman: `index.html` + `style.css` + `game.js` (tanpa dependency)
- Rendering canvas 1024×768, fixed timestep 60 FPS
- Algoritma road/perspektif diadaptasi dari [Javascript Racer](https://codeincomplete.com/games/racer/) karya Jake Gordon (MIT License)
- Sprite & background digambar prosedural via Canvas API

## Lisensi
MIT
