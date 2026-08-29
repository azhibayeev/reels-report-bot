#!/usr/bin/env python3
"""Builds the Qurany Instagram carousel (1080x1350, 4:5) as PNG slides.

Renders deterministic HTML/CSS through headless Chrome at 2x, then downscales
with Lanczos. Text, logo and the app screenshot are never re-drawn by a model.
"""
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "ig-carousel")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

GREEN = "#065B3C"          # sampled from the logo
INK = "#1A1A1A"
TINT = "#E4EDE9"           # green at low opacity, flattened on white
GREY = "#ECEFEE"

LOGO = f"file://{ROOT}/presentation/assets/qurany-logo-mark.png"
SHOT = f"file://{ROOT}/presentation/assets/qurany-app-home.jpg"
FONTS = "/Users/alanalmassuly/Library/Fonts"

CSS = f"""
@font-face {{ font-family:'Mont'; src:local('Montserrat Bold'),
  url('file://{FONTS}/Montserrat-Bold.ttf'); font-weight:700; font-style:normal; }}
@font-face {{ font-family:'Mont'; src:local('Montserrat Medium'),
  url('file://{FONTS}/Montserrat-Medium.ttf'); font-weight:500; font-style:normal; }}

* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ width:1080px; height:1350px; }}
body {{ background:#FFF; font-family:'Mont'; overflow:hidden;
  -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }}
.canvas {{ position:relative; width:1080px; height:1350px; background:#FFF; }}

/* --- cover ---------------------------------------------------------- */
.cover-logo {{ position:absolute; top:150px; left:493px; width:95px; height:104px; }}
.headline {{ position:absolute; top:308px; left:110px; width:860px; text-align:center;
  font-weight:700; font-size:56px; line-height:70px; letter-spacing:-1px; color:{GREEN}; }}

/* --- feature slides ------------------------------------------------- */
.mark {{ position:absolute; top:110px; left:110px; width:51px; height:56px; }}
.copy {{ position:absolute; top:232px; left:110px; width:860px; height:292px;
  display:flex; align-items:center; }}
.copy > span {{ display:block; width:100%;
  font-weight:700; font-size:46px; line-height:60px; letter-spacing:-0.7px;
  color:{INK}; text-indent:-50px; padding-left:50px; }}
.copy .arw {{ color:{GREEN}; }}
.copy em {{ font-style:normal; color:{GREEN}; }}
.art {{ position:absolute; left:0; top:0; width:1080px; height:1350px; }}

/* --- phone mockup --------------------------------------------------- */
.phone {{ position:absolute; left:378.7px; top:539px; width:323px; height:681px;
  background:{INK}; border-radius:44px; padding:9px; transform:rotate(-6deg);
  box-shadow: 0 6px 14px rgba(26,26,26,.10), 0 22px 40px rgba(26,26,26,.13),
              0 36px 74px rgba(6,91,60,.10); }}
.phone .screen {{ width:305px; height:663px; border-radius:36px; overflow:hidden;
  background:#F2F2F4; }}
.phone .screen img {{ display:block; width:305px; height:663px; }}
"""


def ring_dasharray(total_ticks, filled_ticks, dash_ratio=0.72):
    """Ticked ring dasharray on a pathLength=100 circle."""
    step = 100.0 / total_ticks
    dash = step * dash_ratio
    gap = step - dash
    head = f"{dash:.3f} {gap:.3f} " * filled_ticks
    tail = 100.0 - filled_ticks * step
    return (head + f"0 {tail:.3f}").strip()


def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def person(cx, cy, color, r=34):
    """Small person glyph sized to fit an avatar circle of radius r."""
    k = r / 34.0
    return (
        f'<circle cx="{cx:.1f}" cy="{cy - 7 * k:.1f}" r="{8.5 * k:.1f}" fill="{color}"/>'
        f'<path d="M {cx - 14 * k:.1f} {cy + 15 * k:.1f} '
        f'a {14 * k:.1f} {14 * k:.1f} 0 0 1 {28 * k:.1f} 0 z" fill="{color}"/>'
    )


def mushaf(cx, cy, w=104, h=136):
    """Flat mushaf glyph for the centre of the khatam ring."""
    x, y = cx - w / 2, cy - h / 2
    return (
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" rx="15" fill="{GREEN}"/>'
        f'<rect x="{x + 16:.1f}" y="{y:.1f}" width="4" height="{h}" fill="#FFF" opacity=".30"/>'
        f'<rect x="{x + w - 20:.1f}" y="{y + 13:.1f}" width="12" height="{h - 26:.1f}" rx="6" '
        f'fill="#FFF" opacity=".92"/>'
        f'<path d="M {cx - 8:.1f} {y:.1f} h 22 v 50 l -11 -9 l -11 9 z" fill="#FFF" opacity=".92"/>'
    )


def art_khatam():
    """Shared khatam: a segmented progress ring circled by participants."""
    cx, cy, r = 540, 920, 225
    solid, dashed = (-90, 54, 198), (-18, 126)
    p = [f'<svg class="art" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">']
    p.append(f'<g transform="rotate(-90 {cx} {cy})">')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{TINT}" '
             f'stroke-width="30" pathLength="100" stroke-dasharray="{ring_dasharray(30, 30)}"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{GREEN}" '
             f'stroke-width="30" stroke-linecap="butt" pathLength="100" '
             f'stroke-dasharray="{ring_dasharray(30, 19)}"/>')
    p.append('</g>')
    for deg in solid:
        x, y = polar(cx, cy, r, deg)
        p.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="45" fill="#FFF"/>')
        p.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="38" fill="{GREEN}"/>')
        p.append(person(x, y, "#FFFFFF", 38))
    for deg in dashed:
        x, y = polar(cx, cy, r, deg)
        p.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="45" fill="#FFF"/>')
        p.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="36" fill="#FFF" stroke="{GREEN}" '
                 f'stroke-width="3.5" stroke-dasharray="10 8" stroke-linecap="round"/>')
        p.append(person(x, y, GREEN, 38))
    p.append(mushaf(cx, cy))
    p.append('</svg>')
    return "".join(p)


PHONE_X, PHONE_Y, PHONE_W, PHONE_H = 350, 560, 380, 660


def phone_outline():
    return (f'<rect x="{PHONE_X}" y="{PHONE_Y}" width="{PHONE_W}" height="{PHONE_H}" rx="54" '
            f'fill="#FFF" stroke="{GREEN}" stroke-width="3"/>')


def padlock(cx, cy, s, color, body_fill=None):
    """Closed padlock: shackle arc + body. s = overall scale in px (body width)."""
    bw, bh = s, s * 0.78
    bx, by = cx - bw / 2, cy - bh / 2 + s * 0.16
    sr = s * 0.29
    sw = max(3.0, s * 0.13)
    fill = body_fill or color
    return (
        f'<path d="M {cx - sr:.1f} {by:.1f} v {-sr * 0.55:.1f} '
        f'a {sr:.1f} {sr:.1f} 0 0 1 {2 * sr:.1f} 0 v {sr * 0.55:.1f}" '
        f'fill="none" stroke="{color}" stroke-width="{sw:.1f}" stroke-linecap="round"/>'
        f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" height="{bh:.1f}" '
        f'rx="{s * 0.17:.1f}" fill="{fill}"/>'
    )


def art_locked():
    """Other apps greyed out behind a lock."""
    p = [f'<svg class="art" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">',
         phone_outline()]
    cx = PHONE_X + PHONE_W / 2
    # status bar
    p.append(f'<rect x="{PHONE_X + 34}" y="{PHONE_Y + 30}" width="50" height="13" rx="6.5" fill="{GREY}"/>')
    for i, w in enumerate((16, 16, 24)):
        p.append(f'<rect x="{PHONE_X + PHONE_W - 34 - w - i * 24:.1f}" y="{PHONE_Y + 30}" '
                 f'width="{w}" height="13" rx="6.5" fill="{GREY}"/>')
    # home-screen app grid
    tile, gap = 84, 30
    grid = 3 * tile + 2 * gap
    gx = PHONE_X + (PHONE_W - grid) / 2
    gy = PHONE_Y + 96
    for row in range(3):
        for col in range(3):
            p.append(f'<rect x="{gx + col * (tile + gap):.1f}" y="{gy + row * (tile + gap):.1f}" '
                     f'width="{tile}" height="{tile}" rx="24" fill="{GREY}"/>')
    # dock
    dy = PHONE_Y + PHONE_H - 138
    p.append(f'<rect x="{PHONE_X + 30}" y="{dy}" width="{PHONE_W - 60}" height="104" rx="32" '
             f'fill="#F5F7F6"/>')
    for i in range(4):
        p.append(f'<rect x="{PHONE_X + 45 + i * 78:.1f}" y="{dy + 22}" width="56" height="56" '
                 f'rx="17" fill="{GREY}"/>')
    p.append(f'<rect x="{cx - 64}" y="{PHONE_Y + PHONE_H - 26}" width="128" height="10" rx="5" '
             f'fill="{GREY}"/>')
    cy = gy + grid / 2
    p.append(f'<circle cx="{cx}" cy="{cy}" r="108" fill="#FFF"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="92" fill="{GREEN}"/>')
    p.append(padlock(cx, cy, 74, "#FFFFFF"))
    p.append('</svg>')
    return "".join(p)


def art_lockscreen():
    """Lock screen with the daily ayat card."""
    cx = PHONE_X + PHONE_W / 2
    p = [f'<svg class="art" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">',
         phone_outline()]
    p.append(padlock(cx, PHONE_Y + 86, 30, GREEN))
    p.append(f'<text x="{cx}" y="{PHONE_Y + 226}" text-anchor="middle" font-family="Mont" '
             f'font-weight="700" font-size="92" letter-spacing="-2" fill="{INK}">07:41</text>')
    p.append(f'<rect x="{cx - 60}" y="{PHONE_Y + 258}" width="120" height="12" rx="6" fill="{GREY}"/>')
    card_x, card_y, card_w, card_h = PHONE_X + 30, PHONE_Y + 344, PHONE_W - 60, 196
    p.append(f'<rect x="{card_x}" y="{card_y}" width="{card_w}" height="{card_h}" rx="30" fill="{GREEN}"/>')
    p.append(f'<rect x="{card_x + 30}" y="{card_y + 30}" width="34" height="34" rx="10" '
             f'fill="#FFF" opacity=".95"/>')
    p.append(f'<rect x="{card_x + 76}" y="{card_y + 39}" width="96" height="14" rx="7" '
             f'fill="#FFF" opacity=".55"/>')
    for i, (w, op) in enumerate(((254, .95), (226, .8), (148, .55))):
        p.append(f'<rect x="{card_x + 30}" y="{card_y + 94 + i * 30}" width="{w}" height="13" '
                 f'rx="6.5" fill="#FFF" opacity="{op}"/>')
    p.append(f'<rect x="{cx - 64}" y="{PHONE_Y + PHONE_H - 50}" width="128" height="10" rx="5" '
             f'fill="{GREY}"/>')
    p.append('</svg>')
    return "".join(p)


ARROW = '<span class="arw">&#8594;</span>&nbsp;'

SLIDES = [
    ("01-cover", f"""
      <img class="cover-logo" src="{LOGO}">
      <div class="headline">Qurany &#8212; aplikasi untuk<br>membaca Al-Qur&#39;an.</div>
      <div class="phone"><div class="screen"><img src="{SHOT}"></div></div>
    """),
    ("02-khatam", f"""
      <img class="mark" src="{LOGO}">
      <div class="copy"><span>{ARROW}<em>Khatam bersama:</em> keluarga, teman &#8212; atau gabung
        grup terbuka dengan orang yang belum kamu kenal.</span></div>
      {art_khatam()}
    """),
    ("03-terkunci", f"""
      <img class="mark" src="{LOGO}">
      <div class="copy"><span>{ARROW}Aplikasi lain <em>terkunci</em> sampai surahmu hari ini selesai.</span></div>
      {art_locked()}
    """),
    ("04-layar-kunci", f"""
      <img class="mark" src="{LOGO}">
      <div class="copy"><span>{ARROW}Ayat harian di <em>layar kunci</em>.</span></div>
      {art_lockscreen()}
    """),
]

PAGE = "<!doctype html><html><head><meta charset='utf-8'><style>%s</style></head>" \
       "<body><div class='canvas'>%s</div></body></html>"


def main():
    from PIL import Image
    for name, body in SLIDES:
        html = os.path.join(OUT, f"{name}.html")
        with open(html, "w") as fh:
            fh.write(PAGE % (CSS, body))
        raw = os.path.join(OUT, f".{name}@2x.png")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--allow-file-access-from-files", "--force-device-scale-factor=2",
                        "--window-size=1080,1350", f"--screenshot={raw}", html],
                       check=True, capture_output=True)
        png = os.path.join(OUT, f"{name}.png")
        Image.open(raw).convert("RGB").resize((1080, 1350), Image.LANCZOS).save(png)
        os.remove(raw)
        print("wrote", os.path.relpath(png, ROOT))


if __name__ == "__main__":
    sys.exit(main())
