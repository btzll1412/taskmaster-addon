ARG BUILD_FROM
FROM $BUILD_FROM

# Install requirements
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-flask \
    py3-sqlalchemy

# Copy files
COPY requirements.txt /tmp/
RUN pip3 install --no-cache-dir -r /tmp/requirements.txt

# Copy application
WORKDIR /app
COPY run.sh /
COPY app.py /app/
COPY web/ /app/web/

RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
