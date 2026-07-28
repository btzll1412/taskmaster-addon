ARG BUILD_FROM=python:3.11-alpine
FROM $BUILD_FROM

# Python dependencies
COPY requirements.txt /tmp/
RUN pip3 install --no-cache-dir -r /tmp/requirements.txt

# Application (frontend is pre-built into web/dist)
WORKDIR /app
COPY run.sh /
COPY app.py /app/
COPY backend/ /app/backend/
COPY web/dist/ /app/web/dist/

RUN chmod a+x /run.sh

EXPOSE 8099

CMD [ "/run.sh" ]
