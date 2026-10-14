# Gera o ícone do app NutriBot com o Caju e a Lia (dupla_feliz.png) sobre um fundo lilás em degradê.
# Saída: res/mipmap-anydpi-v26/ic_launcher.xml (+ _round), mipmap-*/ic_launcher_foreground.png, ic_launcher_background.png,
# ic_launcher_monochrome.png (silhueta, Android 13 "ícones temáticos"), e os legados ic_launcher.png / ic_launcher_round.png.
# Uso: python gerar_icone.py <pasta res do app>
import sys, os
from PIL import Image, ImageDraw, ImageFilter

RES = sys.argv[1]
FONTE = os.path.join(RES, "drawable-nodpi", "dupla_feliz.png")
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
ADAPT_DP = 108   # canvas do ícone adaptativo
LEGADO_DP = 48   # ícone legado
PETS_DP = 56     # altura dos mascotes dentro do canvas de 108 dp (cabe no círculo seguro de 66 dp)


def fundo(px):
    """Degradê radial lilás (claro no centro, mais forte nas bordas) com um brilho suave em cima."""
    im = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    base = Image.new("RGBA", (px, px), (229, 220, 255, 255))   # Lilas E5DCFF
    centro = Image.new("RGBA", (px, px), (247, 245, 255, 255))  # Lavanda F7F5FF
    mask = Image.new("L", (px, px), 0)
    d = ImageDraw.Draw(mask)
    r = int(px * 0.62)
    d.ellipse((px // 2 - r, int(px * 0.42) - r, px // 2 + r, int(px * 0.42) + r), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(px * 0.18))
    im = Image.composite(centro, base, mask)
    return im


def pets(px):
    """Os mascotes centralizados, um pouco abaixo do centro, com sombra suave."""
    src = Image.open(FONTE).convert("RGBA")
    alt = int(px * PETS_DP / ADAPT_DP)
    larg = int(src.width * alt / src.height)
    p = src.resize((larg, alt), Image.LANCZOS)
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    x = (px - larg) // 2
    y = (px - alt) // 2 + int(px * 0.02)
    sombra = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    a = p.split()[3].point(lambda v: int(v * 0.28))
    sombra.paste((90, 60, 160, 255), (x, y + int(px * 0.025)), a)
    sombra = sombra.filter(ImageFilter.GaussianBlur(px * 0.02))
    canvas.alpha_composite(sombra)
    canvas.alpha_composite(p, (x, y))
    return canvas


def monocromo(px):
    """Silhueta dos mascotes (alpha vira preto) para o ícone temático do Android 13+."""
    src = Image.open(FONTE).convert("RGBA")
    alt = int(px * PETS_DP / ADAPT_DP)
    larg = int(src.width * alt / src.height)
    p = src.resize((larg, alt), Image.LANCZOS)
    a = p.split()[3].point(lambda v: 255 if v > 90 else 0)
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    canvas.paste((0, 0, 0, 255), ((px - larg) // 2, (px - alt) // 2 + int(px * 0.02)), a)
    return canvas


def legado(px, redondo):
    """Fundo + mascotes recortados num quadrado arredondado (ou círculo), para Android < 8."""
    escala = ADAPT_DP / LEGADO_DP
    grande = int(px * escala)
    f = fundo(grande)
    f.alpha_composite(pets(grande))
    # o ícone legado mostra só a parte central (72 de 108 dp), como a máscara do adaptativo
    corte = int(grande * (72 / 108))
    o = (grande - corte) // 2
    f = f.crop((o, o, o + corte, o + corte)).resize((px, px), Image.LANCZOS)
    mask = Image.new("L", (px, px), 0)
    d = ImageDraw.Draw(mask)
    if redondo:
        d.ellipse((0, 0, px - 1, px - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, px - 1, px - 1), radius=int(px * 0.22), fill=255)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(f, (0, 0), mask)
    return out


for nome, mult in DENS.items():
    pasta = os.path.join(RES, f"mipmap-{nome}")
    os.makedirs(pasta, exist_ok=True)
    px = int(ADAPT_DP * mult)
    fundo(px).save(os.path.join(pasta, "ic_launcher_background.png"), optimize=True)
    pets(px).save(os.path.join(pasta, "ic_launcher_foreground.png"), optimize=True)
    monocromo(px).save(os.path.join(pasta, "ic_launcher_monochrome.png"), optimize=True)
    lp = int(LEGADO_DP * mult)
    legado(lp, False).save(os.path.join(pasta, "ic_launcher.png"), optimize=True)
    legado(lp, True).save(os.path.join(pasta, "ic_launcher_round.png"), optimize=True)

xml = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
"""
pasta = os.path.join(RES, "mipmap-anydpi-v26")
os.makedirs(pasta, exist_ok=True)
for n in ("ic_launcher.xml", "ic_launcher_round.xml"):
    with open(os.path.join(pasta, n), "w", encoding="utf-8", newline="\n") as f:
        f.write(xml)

# prévia: como o launcher mostra (círculo e quadrado arredondado), em 192 px
prev = Image.new("RGBA", (432, 216), (255, 255, 255, 255))
prev.paste(legado(192, True), (12, 12), legado(192, True))
prev.paste(legado(192, False), (228, 12), legado(192, False))
prev.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "previa.png"))
print("ok")
