# BPA Report Tool — kendi makinende calistirilabilir surum.
#
# NEDEN VAR: barindirilan surumde kullanicinin Client Secret'i bizim proxy'mizden
# TRANSIT GECER (Palo Alto uc noktalari tarayicidan dogrudan cagrilmaya izin
# vermiyor — CORS kapali). Bunu kabul etmeyen kurumlar icin bu imaj proxy'yi
# KENDI MAKINELERINDE calistirir; credential hicbir zaman uctan uca disari cikmaz.
#
# Uygulama mantigi ayni: web/lib/*.js hem burada hem Cloudflare'de ayni dosyalardir.
# Fark yalnizca proxy'nin nerede kostugu.

FROM python:3.12-slim

# Bagimlilik YOK — serve.py yalnizca standart kutuphane kullanir.
# Bu bilincli bir tercih: guvenlik hassasiyeti yuksek bir ortamda calisacak
# imajin bagimlilik zinciri olmamasi denetimi kolaylastirir.

WORKDIR /app

COPY serve.py /app/serve.py
COPY web/     /app/web/

# Statik kok dogrudan uygulama olsun: "/" -> index.html
ENV DOCROOT=/app/web \
    PORT=8080 \
    BIND=0.0.0.0 \
    PYTHONUNBUFFERED=1

# Root olarak calistirma
RUN useradd --system --uid 10001 --no-create-home bpa \
 && chown -R bpa:bpa /app
USER bpa

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python3 -c "import urllib.request,sys; \
      sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/', timeout=3).status==200 else 1)"

CMD ["python3", "/app/serve.py"]
