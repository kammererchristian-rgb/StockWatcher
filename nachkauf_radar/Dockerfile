ARG BUILD_FROM
FROM ${BUILD_FROM}

# Node für den Dienst, Python + curl_cffi für Yahoo-Abrufe mit Chrome-Verbindungssignatur
RUN apk add --no-cache nodejs tzdata python3 py3-pip \
 && pip3 install --no-cache-dir --break-system-packages --only-binary=:all: "curl_cffi==0.14.0" \
 && python3 -c "import curl_cffi; print('curl_cffi', curl_cffi.__version__)"

WORKDIR /app
COPY app/ /app/
RUN rm -rf /app/.data

ENV PORT=8099 DATA_DIR=/data
CMD [ "node", "/app/server.js" ]
