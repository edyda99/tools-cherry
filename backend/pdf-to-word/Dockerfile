# Lambda container image for PDF -> Word conversion (arm64 / Graviton).
#
# Stage 1 builds tesseract from source: stencil_ocr.py needs the binary and
# AL2023's repos simply don't carry it ("No package matches 'tesseract'").
# Versions are pinned so the image rebuilds byte-comparably.
FROM public.ecr.aws/lambda/python:3.12-arm64 AS tesseract-build

RUN dnf install -y gcc gcc-c++ make autoconf automake libtool pkgconfig \
        libpng-devel libjpeg-turbo-devel libtiff-devel zlib-devel tar gzip \
    && dnf clean all

ARG LEPTONICA_VERSION=1.84.1
ARG TESSERACT_VERSION=5.3.4

# sources are vendored in vendor/ (fetched on the host): the build VM's network
# is unreliable behind the VPN, and a hermetic build beats a flaky wget anyway
COPY vendor/leptonica-${LEPTONICA_VERSION}.tar.gz vendor/tesseract-${TESSERACT_VERSION}.tar.gz /build/
WORKDIR /build

RUN tar xzf "leptonica-${LEPTONICA_VERSION}.tar.gz" \
    && cd "leptonica-${LEPTONICA_VERSION}" \
    && ./configure --prefix=/opt/tesseract --disable-static \
    && make -j"$(nproc)" && make install

RUN tar xzf "tesseract-${TESSERACT_VERSION}.tar.gz" \
    && cd "tesseract-${TESSERACT_VERSION}" \
    && ./autogen.sh \
    && PKG_CONFIG_PATH=/opt/tesseract/lib/pkgconfig ./configure \
        --prefix=/opt/tesseract --disable-static --disable-doc \
    && make -j"$(nproc)" && make install

# the same eng model the local verification ran with (vendored)
COPY vendor/eng.traineddata /opt/tesseract/share/tessdata/eng.traineddata

# ---------------------------------------------------------------------------
FROM public.ecr.aws/lambda/python:3.12-arm64

# opencv (pulled in by pdf2docx) needs libGL; libjpeg/libtiff back tesseract.
RUN dnf install -y mesa-libGL libjpeg-turbo libtiff libpng && dnf clean all

COPY --from=tesseract-build /opt/tesseract /opt/tesseract
ENV PATH="/opt/tesseract/bin:${PATH}" \
    LD_LIBRARY_PATH="/opt/tesseract/lib" \
    TESSDATA_PREFIX="/opt/tesseract/share/tessdata"

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY lambda_function.py stencil_ocr.py ${LAMBDA_TASK_ROOT}/

CMD [ "lambda_function.handler" ]
